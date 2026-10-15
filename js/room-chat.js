// Supabase records who was present. The room view only shows this visit's messages.
function createRoomChat(client) {
  const el = (id) => document.getElementById(id);

  const list = el('chat-messages'),
    form = el('chat-form'),
    input = el('chat-input');
  const send = el('chat-send'),
    connection = el('chat-connection');
  const status = {
    set textContent(text) {
      if (text && text !== 'Sending…') addSystem(text);
    },
  };
  let current = null,
    visit = null,
    channel = null,
    generation = 0,
    heartbeat = null;
  let sending = false,
    messages = new Map();
  let mode = 'ic';
  const unread = { ic: new Set(), ooc: new Set() };
  const mentionComposer = window.APSUAttention?.composer(input, {
    client,
    context: () => current,
    isOOC: () => mode === 'ooc',
  });

  function attentionCounts() {
    for (const kind of ['ic', 'ooc']) {
      const button = el('chat-' + kind);
      let badge = button.querySelector?.('.notification-count');

      if (!badge && unread[kind].size) {
        badge = document.createElement('span');
        badge.className = 'notification-count';
        button.append(badge);
      }
      if (badge) {
        badge.hidden = !unread[kind].size;
        badge.textContent = unread[kind].size;
        badge.setAttribute('aria-label', unread[kind].size + ' unread mentions');
      }
    }
  }

  const reading = (kind) =>
    mode === kind &&
    !document.hidden &&
    !document.querySelector?.('dialog[open]') &&
    (!list.getBoundingClientRect ||
      (list.getBoundingClientRect().bottom > 0 &&
        list.getBoundingClientRect().top < window.innerHeight)) &&
    list.scrollHeight - list.scrollTop - list.clientHeight < 60;

  function markRead() {
    if (reading(mode)) {
      unread[mode].clear();
      attentionCounts();
    }
  }

  list.addEventListener('scroll', markRead);
  window.addEventListener('scroll', markRead);
  window.addEventListener('focus', markRead);
  document.addEventListener?.('visibilitychange', markRead);
  const outbox = new Map(),
    imageCache = new Map();
  let lastSendAt = 0,
    typingAt = 0,
    typingTimer;
  const attachments =
    window.APSUChatImages && el('chat-image-input')
      ? window.APSUChatImages.composer(el('chat-image-input'), el('chat-image-preview'), (text) =>
          addSystem(text),
        )
      : null;

  const rank = () => Number(document.getElementById('admin-panel-link')?.dataset?.rank || 0);

  el('chat-commands')?.addEventListener('click', () => window.APSUCommands.open(rank()));

  function typing(active) {
    if (!visit) return;
    if (active && Date.now() - typingAt < 3000) return;

    typingAt = active ? Date.now() : 0;
    Promise.resolve(client.rpc('set_chat_typing', { p_visit: visit, p_typing: active })).catch(
      () => {},
    );
  }

  input.addEventListener('input', () => {
    if (mode === 'ic' && input.value.trim()) {
      typing(true);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => typing(false), 5000);
    } else typing(false);
  });
  input.addEventListener('blur', () => typing(false));

  function accept(message) {
    const optimistic = messages.get(message.id);
    const kind = message.chat_kind === 'ooc' ? 'ooc' : 'ic';
    const addressed =
      kind === 'ooc'
        ? window.APSUAttention?.mentioned(message.body, current?.playerName, current?.name)
        : ['whisper', 'directed'].includes(message.message_type) &&
          message.recipient_character === current?.id;

    if (!optimistic && addressed && message.character_id !== current?.id && !reading(kind)) {
      unread[kind].add(message.id);
      attentionCounts();
    }

    messages.set(message.id, message);
    outbox.delete(message.id);
    if (optimistic?.localImages) imageCache.set(message.id, optimistic.localImages);
    if (message.image_count && !imageCache.has(message.id)) {
      imageCache.set(message.id, []);
      client
        .from('room_message_images')
        .select('data_url,position')
        .eq('message_id', message.id)
        .order('position')
        .then(({ data, error }) => {
          if (!error && data) {
            imageCache.set(
              message.id,
              data.map((i) => i.data_url),
            );
            render();
          } else imageCache.delete(message.id);
        });
    }
  }

  let connected = false,
    retryTimer = null,
    retryDelay = 2000,
    recovering = false;

  const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

  function connectionState(state, text) {
    connected = state === 'connected';
    if (connected) Promise.resolve().then(pump);

    connection.textContent = text;
    connection.setAttribute('data-state', state);
    send.disabled = !connected;
    // Keep the draft editable while offline. Nothing is sent automatically.
    input.disabled = !current;
  }

  function scheduleReconnect() {
    if (!current || retryTimer || offline()) return;

    retryTimer = setTimeout(() => {
      retryTimer = null;
      reconnect();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30000);
  }

  function connectionLost() {
    connectionState(
      offline() ? 'offline' : 'reconnecting',
      offline() ? 'Offline · your draft is kept' : 'Reconnecting… · your draft is kept',
    );
    scheduleReconnect();
  }

  async function reconnect() {
    if (!current || recovering || offline()) return;

    recovering = true;
    const version = generation;

    try {
      if (visit) {
        const result = await client.rpc('touch_chat', { p_visit: visit, p_leave: false });

        if (version !== generation) return;
        if (result.error) throw result.error;
        if (result.data) {
          // Realtime resubscribes itself. HTTP catch-up also recovers missed events.
          await catchUp(version, visit);
          if (version !== generation) return;

          connectionState('connected', 'Connected');
          retryDelay = 2000;

          return;
        }
      }

      await showRoom({ ...current }, true);
    } catch {
      if (version === generation) connectionLost();
    } finally {
      recovering = false;
    }
  }

  window.addEventListener('offline', () => {
    if (current) connectionLost();
  });
  window.addEventListener('online', () => {
    if (current) reconnect();
  });
  const drafts = { ic: '', ooc: '' };

  function selectMode(next) {
    unread[next].clear();
    attentionCounts();
    mentionComposer?.close();
    if (next === mode) return;

    drafts[mode] = input.value;
    typing(false);
    el('chat-download-ic').hidden = next !== 'ic';
    el('chat-download-ooc').hidden = next !== 'ooc';
    mode = next;
    input.value = drafts[mode];
    updateCounter();
    status.textContent = '';
    el('chat-ic').setAttribute('aria-pressed', String(mode === 'ic'));
    el('chat-ooc').setAttribute('aria-pressed', String(mode === 'ooc'));
    el('chat-scope').textContent =
      mode === 'ic' ? 'This room · in character' : 'This world · out of character';
    render();
  }

  el('chat-ic').addEventListener('click', () => selectMode('ic'));
  el('chat-ooc').addEventListener('click', () => selectMode('ooc'));
  let lastSystemText = '',
    lastSystemTime = 0;
  // Local notices never go through the shared chat-send endpoints.

  function addSystem(text, scope = 'local') {
    if (!current || !text) return;
    if (text === lastSystemText && Date.now() - lastSystemTime < 5000) return;

    lastSystemText = text;
    lastSystemTime = Date.now();
    const id = 'local-system:' + crypto.randomUUID();
    messages.set(id, {
      id,
      chat_kind: 'system',
      scope,
      character_name: scope === 'world' ? 'System · World' : 'System · Local',
      body: text,
      created_at: new Date().toISOString(),
    });
    render();
  }

  function updateCounter() {
    el('chat-counter').textContent = Array.from(input.value).length + '/500';
  }

  input.addEventListener('input', updateCounter);
  const lifetime = 24 * 60 * 60 * 1000;

  const key = (c) => [c.playerId, c.worldId, c.id, c.location].join(':');

  function render() {
    const bottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    list.replaceChildren();
    for (const [id, message] of messages) {
      if (Date.parse(message.created_at) <= Date.now() - lifetime) {
        messages.delete(id);
        imageCache.delete(id);
      }
    }
    for (const message of [...messages.values()]
      .filter((m) => m.chat_kind === 'system' || (m.chat_kind || 'ic') === mode)
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
      const row = document.createElement('li'),
        author = document.createElement('strong');
      const time = document.createElement('time'),
        body = document.createElement('p');

      if (
        message.chat_kind === 'system' ||
        ['whisper_notice', 'movement', 'item_show'].includes(message.message_type)
      )
        row.className = 'system-message';

      author.textContent =
        message.chat_kind === 'ooc'
          ? message.character_name +
            ' (' +
            (message.played_character_name || 'Unknown character') +
            ')'
          : (message.sender_number && !['movement', 'whisper_notice'].includes(message.message_type)
              ? '[' + message.sender_number + '] '
              : '') + message.character_name;
      if (message.message_type === 'whisper') {
        row.className = 'whisper-message';
        const whisperLabel =
          message.character_id === current.id
            ? 'You whisper to ' +
              (message.recipient_number ? '[' + message.recipient_number + '] ' : '') +
              (message.recipient_name || 'another character') +
              ':'
            : author.textContent + ' whispers to you:';
        const marker = document.createElement('span');
        marker.className = 'whisper-marker';
        marker.textContent = '[!] ';
        const label = document.createElement('span');
        label.textContent = whisperLabel;
        author.textContent = '';
        author.append(marker, label);
      }
      if (message.message_type === 'shout') {
        author.textContent += ' shouts';
        if (message.room_id !== current.location)
          author.textContent += ' (from ' + (message.source_room_name || 'another room') + ')';
      }
      if (message.message_type === 'item_show') author.textContent = 'System';
      if (message.message_type === 'directed') {
        author.textContent += ' (to ' + (message.recipient_name || 'another character') + ')';
        if (message.recipient_character === current.id) {
          const marker = document.createElement('span');
          marker.className = 'directed-marker';
          marker.textContent = '[!] ';
          const label = document.createElement('span');
          label.textContent = author.textContent;
          author.textContent = '';
          author.append(marker, label);
        }
      }
      if (['action', 'description', 'possessive'].includes(message.message_type))
        row.className = 'action-message';

      time.dateTime = message.created_at;
      time.textContent = new Date(message.created_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      time.title = new Date(message.created_at).toLocaleString();
      body.textContent =
        message.message_type === 'possessive'
          ? message.character_name + '’s ' + message.body
          : message.message_type === 'action'
            ? message.character_name + ' ' + message.body
            : message.message_type === 'description'
              ? message.body + ' (' + message.character_name + ')'
              : message.body;
      if (
        ![
          'whisper',
          'action',
          'description',
          'possessive',
          'movement',
          'whisper_notice',
          'item_show',
        ].includes(message.message_type) &&
        message.chat_kind !== 'system'
      )
        author.append(document.createTextNode(': '));
      if (['action', 'description', 'possessive'].includes(message.message_type))
        author.hidden = true;
      if (
        message.chat_kind === 'ooc' &&
        window.APSUAttention?.mentioned(message.body, current.playerName, current.name)
      )
        row.classList.add('mention-message');

      row.append(author, time, body);
      if (message.item_preview) {
        const preview = document.createElement('div');
        preview.className = 'item-shown';
        const label = document.createElement('span');
        label.textContent = message.item_preview.name;
        preview.append(APSUItems.visual(message.item_preview, client), label);
        row.append(preview);
      }

      const images = message.localImages || imageCache.get(message.id);

      if (images?.length) window.APSUChatImages.view(row, images);

      const attempt = outbox.get(message.id);

      if (attempt) {
        const delivery = document.createElement('small');
        delivery.className = 'message-delivery';
        delivery.textContent =
          attempt.state === 'failed'
            ? attempt.error
            : attempt.state === 'uncertain'
              ? 'Delivery unconfirmed'
              : 'Sending…';
        row.append(delivery);
        if (['failed', 'uncertain'].includes(attempt.state)) {
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.textContent = 'Retry';
          retry.onclick = () => {
            if (attempt.version !== generation || attempt.visit !== visit)
              return addSystem(
                'This visit ended. Copy the message to send it in your current room.',
              );

            attempt.state = 'queued';
            pump();
            render();
          };
          row.append(retry);
        }
      }

      list.appendChild(row);
    }

    el('chat-history-status').textContent = 'Your chat logs expire after 24 hours.';
    if (bottom) list.scrollTop = list.scrollHeight;
  }

  async function catchUp(version, visitId) {
    // Fetch only messages addressed to this visit, including missed network updates.
    let offset = 0;

    while (version === generation) {
      const { data, error } = await client
        .from('room_messages')
        .select('*')
        .contains('visit_ids', [visitId])
        .order('created_at')
        .order('id')
        .range(offset, offset + 499);

      if (version !== generation) return;
      if (error) {
        throw error;
      }
      for (const m of data) accept(m);

      render();
      if (data.length < 500) break;

      offset += data.length;
    }
  }

  function release() {
    clearTimeout(typingTimer);
    clearTimeout(retryTimer);
    retryTimer = null;
    connected = false;
    clearInterval(heartbeat);
    heartbeat = null;
    if (channel) client.removeChannel(channel);

    channel = null;
    const cleanup = visit
      ? Promise.resolve(client.rpc('touch_chat', { p_visit: visit, p_leave: true })).catch(() => {})
      : Promise.resolve();
    visit = null;

    return cleanup;
  }

  async function showRoom(character, force = false) {
    if (!force && current && key(current) === key(character)) return;

    const sameRoom = current && key(current) === key(character);
    const savedDraft = input.value;
    release();
    const version = ++generation;
    const sameWorld =
      current && current.playerId === character.playerId && current.worldId === character.worldId;

    for (const [id, m] of messages)
      if (!sameRoom && (!sameWorld || !['ooc', 'system'].includes(m.chat_kind)))
        messages.delete(id);
    if (!sameWorld) {
      unread.ic.clear();
      unread.ooc.clear();
      attentionCounts();
    } else if (!sameRoom) {
      unread.ic.clear();
      attentionCounts();
    }

    mentionComposer?.close();
    current = { ...character };
    input.value = sameRoom ? savedDraft : '';
    if (!sameRoom) {
      drafts.ic = '';
      drafts.ooc = '';
    }

    updateCounter();
    input.disabled = true;
    send.disabled = true;
    status.textContent = '';
    connectionState('reconnecting', 'Connecting…');
    render();
    const visitId = crypto.randomUUID();
    let error;

    try {
      ({ error } = await client.rpc('enter_chat', {
        p_visit: visitId,
        p_character: character.id,
        p_room: character.location,
      }));
    } catch (failure) {
      error = failure;
    }
    if (version !== generation) {
      if (!error) await client.rpc('touch_chat', { p_visit: visitId, p_leave: true });

      return;
    }
    if (error) {
      connectionLost();
      return;
    }

    visit = visitId;
    channel = client
      .channel('room-chat:' + visitId)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'room_messages',
          filter: 'world_id=eq.' + character.worldId,
        },
        (payload) => {
          const m = payload.new;

          if (
            version !== generation ||
            m.world_id !== character.worldId ||
            !m.visit_ids.includes(visitId)
          )
            return;

          accept(m);
          render();
        },
      )
      .subscribe((state) => {
        if (version !== generation) return;
        if (state === 'SUBSCRIBED') {
          connectionState('connected', 'Connected');
          retryDelay = 2000;
          catchUp(version, visitId).catch(() => {
            if (version === generation) connectionLost();
          });
        } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(state)) {
          connectionLost();
        }
      });
    heartbeat = setInterval(() => {
      render();
      reconnect();
    }, 20000);
  }

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;

    event.preventDefault();
    if (!event.repeat && !send.disabled) form.requestSubmit();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!visit || !connected || offline() || attachments?.busy()) return;

    const body = input.value.trim(),
      images = attachments?.get() || [];

    if ((!body && !images.length) || Array.from(body).length > 500 || /[\r\n]/.test(body))
      return addSystem('Use up to 500 characters on one line, or attach an image.');

    let command;

    try {
      command = window.APSUCommands.parse(body);
    } catch (e) {
      return addSystem(e.message);
    }
    if (command?.kind === 'command_list') {
      input.value = '';
      updateCounter();
      window.APSUCommands.open(rank());

      return;
    }
    if (command?.kind === 'admins') {
      input.value = '';
      updateCounter();
      const version = generation;
      client
        .rpc('online_world_admins', { p_world: current.worldId })
        .then(({ data, error }) => {
          if (version !== generation) return;
          if (error)
            return addSystem(
              'Could not load online admins. This feature may need the prepared database update.',
            );

          addSystem(
            data?.length
              ? 'Admins online: ' +
                  data
                    .map((a) => a.name + ' (' + a.role.replace('Server Owner', 'World Owner') + ')')
                    .join(', ')
              : 'No admins are currently online in this world.',
          );
        })
        .catch(() => {
          if (version === generation) addSystem('Could not load online admins. Try again.');
        });

      return;
    }
    if (command && !command.moderation && mode !== 'ic')
      return addSystem('Use roleplay commands in the In-Character tab.');
    if (command && images.length) return addSystem('Send images as an ordinary IC or OOC message.');

    const id = crypto.randomUUID(),
      attempt = {
        id,
        body,
        images,
        command,
        mode,
        visit,
        version: generation,
        character: { ...current },
        state: 'queued',
      };
    const target = command?.target
      ? document.querySelector?.('[data-chat-number="' + command.target + '"]')
      : null;
    outbox.set(id, attempt);
    if (!command?.moderation && command?.kind !== 'sneak')
      messages.set(id, {
        id,
        character_id: current.id,
        character_name: mode === 'ooc' ? current.playerName || 'You' : current.name,
        played_character_name: current.name,
        body: command?.body || body,
        chat_kind: mode,
        message_type: command?.kind || 'chat',
        recipient_name:
          target?.dataset.characterName || (command?.target ? '[' + command.target + ']' : null),
        recipient_number: command?.target,
        created_at: new Date().toISOString(),
        localImages: images,
      });
    // Clear synchronously: the next draft must never append to the message being sent.

    input.value = '';
    drafts[mode] = '';
    attachments?.clear();
    updateCounter();
    typing(false);
    render();
    list.scrollTop = list.scrollHeight;
    pump();
  });

  async function pump() {
    if (sending || !connected || offline()) return;

    const attempt = [...outbox.values()].find(
      (a) => a.state === 'queued' && a.version === generation,
    );

    if (!attempt) return;

    sending = true;
    attempt.state = 'sending';
    render();
    try {
      // Pace queued sends without delaying the local echo or next draft.
      const wait = Math.max(0, 1100 - (Date.now() - lastSendAt));

      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      if (attempt.version !== generation) {
        attempt.state = 'failed';
        attempt.error = 'Visit ended before sending.';
        return;
      }

      const command = attempt.command;
      const endpoint =
        command?.kind === 'sneak'
          ? 'sneak_character'
          : command?.moderation
            ? 'world_command'
            : command
              ? command.kind === 'whisper'
                ? 'send_room_whisper'
                : 'send_room_command'
              : 'send_chat_message';
      const args = { p_id: attempt.id, p_visit: attempt.visit };

      if (command?.kind !== 'sneak') args.p_body = command ? command.body : attempt.body;
      if (command?.target) args.p_target = command.target;
      if (command && !['whisper', 'sneak'].includes(command.kind)) args.p_kind = command.kind;
      if (!command) {
        args.p_kind = attempt.mode;
        args.p_images = attempt.images;
      }

      lastSendAt = Date.now();
      const { error } = await window.APSUDatabase.call(client, endpoint, args);

      if (error) throw error;
      if (attempt.version !== generation) return;
      if (command?.moderation || command?.kind === 'sneak') {
        outbox.delete(attempt.id);
        addSystem(
          command.kind === 'sneak'
            ? 'Sneaking for 30 seconds. You remain visible in room lists.'
            : command.kind === 'help'
              ? 'Help request sent to this world’s admins.'
              : command.kind === 'report'
                ? 'Report submitted to this world’s admins.'
                : 'Command completed.',
        );
      } else {
        const { data, error: readError } = await client
          .from('room_messages')
          .select('*')
          .eq('id', attempt.id);

        if (attempt.version !== generation) return;
        if (readError) throw readError;
        for (const m of data || []) accept(m);
        // The RPC succeeded; a realtime echo may already have confirmed it.

        outbox.delete(attempt.id);
      }
    } catch (error) {
      if (attempt.version !== generation) return;
      if (!outbox.has(attempt.id)) return; // Realtime receipt is proof of delivery.

      attempt.state = ['P0001', '23514', 'PGRST202', '42501'].includes(error.code)
        ? 'failed'
        : 'uncertain';
      attempt.error = error.message || 'Could not send.';
      addSystem(
        attempt.state === 'failed'
          ? attempt.error
          : 'Could not confirm delivery. Use Retry on the message; it will not send a duplicate.',
      );
      if (attempt.state === 'uncertain') connectionLost();
    } finally {
      sending = false;
      render();
      pump();
    }
  }

  el('chat-refresh').addEventListener('click', () => {
    if (current) reconnect();
  });

  async function downloadLogs(kind) {
    const button = el('chat-download-' + kind);

    if (button.disabled) return;
    if (!current) return;

    const version = generation,
      worldId = current.worldId,
      rows = [];
    button.disabled = true;
    try {
      for (let offset = 0; ; offset += 500) {
        // Include sent AND received messages. RLS checks witnessed visits, not authorship.
        const { data, error } = await client
          .from('room_messages')
          .select(
            'id,room_id,character_name,played_character_name,body,created_at,chat_kind,message_type,sender_number,recipient_name,recipient_number,image_count,source_room_name,item_preview',
          )
          .eq('world_id', worldId)
          .eq('chat_kind', kind)
          .order('created_at')
          .order('id')
          .range(offset, offset + 499);

        if (error) throw error;
        if (version !== generation) return;

        rows.push(...data);
        if (data.length < 500) break;
      }
      if (!rows.length) {
        status.textContent = 'No unexpired ' + kind.toUpperCase() + ' chat logs to download.';
        return;
      }

      const lines = rows.map(
        (m) =>
          `[${m.created_at}] [${m.chat_kind === 'ooc' ? 'OOC · World' : 'IC · ' + m.room_id}] ${m.sender_number ? '[' + m.sender_number + '] ' : ''}${m.character_name}${m.message_type === 'whisper' ? ' whispers to ' + (m.recipient_number ? '[' + m.recipient_number + '] ' : '') + (m.recipient_name || 'you') : ''}${m.message_type === 'directed' ? ' (to ' + (m.recipient_name || 'another character') + ')' : ''}${m.message_type === 'shout' ? ' shouts (from ' + (m.source_room_name || m.room_id) + ')' : ''}${m.message_type === 'possessive' ? ' [/my]' : ''}${m.message_type === 'action' ? ' [/me]' : m.message_type === 'description' ? ' [/do]' : ''}${m.chat_kind === 'ooc' ? ' (' + (m.played_character_name || 'Unknown character') + ')' : ''}: ${m.body}`,
      );
      const text = lines.join('\n');
      let content = text,
        type = 'text/plain;charset=utf-8',
        extension = 'txt';

      if (rows.some((m) => m.image_count || m.item_preview?.image_path)) {
        const escape = (value) =>
          String(value).replace(
            /[&<>"]/g,
            (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
          );

        const sections = [];

        for (const [index, m] of rows.entries()) {
          let section = '<article><p>' + escape(lines[index]) + '</p>';

          if (m.image_count) {
            const result = await client
              .from('room_message_images')
              .select('data_url,position')
              .eq('message_id', m.id)
              .order('position');

            if (result.error) throw result.error;
            for (const image of result.data || [])
              section +=
                '<img alt="Chat attachment" style="max-width:100%;max-height:700px" src="' +
                escape(image.data_url) +
                '">';
          }
          if (m.item_preview?.image_path) {
            const { data: file, error } = await client.storage
              .from('item-images')
              .download(m.item_preview.image_path);

            if (error) throw error;

            const dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            });

            if (!/^data:image\/(png|jpeg|webp);base64,/i.test(dataUrl))
              throw Error('Unsupported item image');

            section +=
              '<img style="max-width:100%;max-height:700px" alt="' +
              escape(m.item_preview.name || 'Shown item') +
              '" src="' +
              escape(dataUrl) +
              '">';
          }

          sections.push(section + '</article>');
        }

        content =
          '<!doctype html><meta charset="utf-8"><title>APSU ' +
          kind.toUpperCase() +
          ' chat log</title><h1>' +
          kind.toUpperCase() +
          ' chat log</h1>' +
          sections.join('');
        type = 'text/html;charset=utf-8';
        extension = 'html';
      }
      if (version !== generation) return;

      const url = URL.createObjectURL(new Blob([content], { type }));
      const link = document.createElement('a');
      link.href = url;
      link.download =
        'apsu-' + kind + '-chat-' + new Date().toISOString().slice(0, 10) + '.' + extension;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (mode === kind)
        status.textContent =
          kind.toUpperCase() + ' chat log downloaded. This copy will not expire.';
    } catch {
      if (version === generation) status.textContent = 'Could not download chat logs. Try again.';
    } finally {
      button.disabled = false;
    }
  }

  el('chat-download-ic').addEventListener('click', () => downloadLogs('ic'));
  el('chat-download-ooc').addEventListener('click', () => downloadLogs('ooc'));

  function stop() {
    const cleanup = release();
    generation++;
    current = null;
    messages.clear();
    outbox.clear();
    imageCache.clear();
    attachments?.clear();
    drafts.ic = '';
    drafts.ooc = '';
    input.value = '';
    updateCounter();
    input.disabled = true;
    send.disabled = true;
    list.replaceChildren();

    return cleanup;
  }

  let resumeCharacter = null;
  window.addEventListener('pagehide', (event) => {
    resumeCharacter = event.persisted && current ? { ...current } : null;
    stop();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && resumeCharacter) showRoom(resumeCharacter);

    resumeCharacter = null;
  });

  return { showRoom, stop, addSystem };
}
