// Player-to-player messages have their own private endpoints, outside room chat.
(() => {
  let user = null,
    peer = null,
    revision = 0,
    sending = false,
    minimized = false;
  let retry = null,
    pollBusy = false,
    inboxBusy = false,
    rows = [];
  const windowEl = document.createElement('section');
  windowEl.className = 'dm-window';
  windowEl.hidden = true;
  windowEl.setAttribute('role', 'dialog');
  windowEl.setAttribute('aria-label', 'Private messages');
  windowEl.innerHTML =
    '<div class="dm-heading"><h2>Private messages</h2><button type="button" data-minimize aria-expanded="true">Minimize</button><button type="button" data-close>Close</button></div><div class="dm-content"><button type="button" data-inbox>Conversations</button><div class="dm-inbox"></div><ol class="dm-messages" aria-label="Conversation"></ol><p class="dm-status" role="status"></p><form novalidate><label>Message<input maxlength="500" autocomplete="off" required></label><div class="dm-actions"><span data-counter>0/500</span><button type="submit">Send</button></div></form><p class="dm-retention">Private messages expire after 24 hours. They are separate from IC/OOC logs.</p><button type="button" data-block hidden>Block player</button></div>';
  const launch = document.createElement('button');
  launch.className = 'dm-launch';
  launch.type = 'button';
  launch.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v12H9l-5 4V4z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><span class="notification-count" hidden></span>';
  launch.setAttribute('aria-label', 'Private messages');
  launch.title = 'Private messages';
  const dock = document.createElement('aside');
  dock.className = 'dm-dock';
  dock.hidden = true;
  dock.setAttribute('aria-label', 'Private message dock');
  dock.append(launch);
  launch.hidden = true;
  launch.setAttribute('aria-haspopup', 'dialog');
  document.body.append(windowEl, dock);

  const $ = (s) => windowEl.querySelector(s),
    input = $('input'),
    form = $('form'),
    status = $('.dm-status');

  const message = (e) =>
    e?.code === 'PGRST202'
      ? 'Private messaging needs the prepared database update.'
      : e?.message || 'Could not connect. Try again.';

  const incoming = new Map();
  let readThrough = {},
    notificationBusy = false,
    cursor = null;

  function saveRead() {
    try {
      sessionStorage.setItem('apsu-dm-read:' + user.id, JSON.stringify(readThrough));
    } catch {}
  }

  function unreadCount(id) {
    return [...incoming.values()].filter(
      (m) => (!id || m.sender === id) && m.created_at > (readThrough[m.sender] || ''),
    ).length;
  }

  function countBadge() {
    const count = unreadCount(),
      badge = launch.querySelector('.notification-count');
    badge.textContent = count > 99 ? '99+' : count;
    badge.hidden = !count;
    launch.setAttribute('aria-label', 'Private messages' + (count ? ', ' + count + ' unread' : ''));
    document.querySelectorAll('[data-dm-peer]').forEach((b) => {
      const n = unreadCount(b.dataset.dmPeer),
        badge = b.querySelector('.notification-count');

      if (badge) {
        badge.textContent = n;
        badge.hidden = !n;
      }
    });
  }

  function markRead() {
    if (!user || !peer || windowEl.hidden || minimized || document.hidden) return;

    const list = $('.dm-messages');

    if (list.scrollHeight - list.scrollTop - list.clientHeight > 60) return;

    const newest = rows
      .filter((m) => m.sender === peer.id)
      .map((m) => m.created_at)
      .sort()
      .at(-1);

    if (newest && newest > (readThrough[peer.id] || '')) {
      readThrough[peer.id] = newest;
      saveRead();
      countBadge();
    }
  }

  $('.dm-messages').addEventListener('scroll', markRead);
  document.addEventListener('visibilitychange', markRead);

  async function notifications() {
    if (!user || notificationBusy || document.hidden) return;

    const id = user.id;
    notificationBusy = true;
    const cutoff = new Date(Date.now() - 86400000).toISOString();

    try {
      let offset = 0;

      while (user?.id === id) {
        const { data, error } = await supabaseClient
          .from('direct_messages')
          .select('id,sender,created_at')
          .eq('recipient', id)
          .gte('created_at', cursor || cutoff)
          .order('created_at')
          .order('id')
          .range(offset, offset + 499);

        if (error || user?.id !== id) return;
        for (const m of data || []) incoming.set(m.id, m);
        if (!data || data.length < 500) break;

        offset += data.length;
      }
      for (const [key, m] of incoming) if (m.created_at <= cutoff) incoming.delete(key);

      cursor =
        [...incoming.values()]
          .map((m) => m.created_at)
          .sort()
          .at(-1) || cutoff;
      markRead();
      countBadge();
    } finally {
      notificationBusy = false;
    }
  }

  function expand() {
    minimized = false;
    windowEl.classList.remove('dm-minimized');
    $('[data-minimize]').textContent = 'Minimize';
    $('[data-minimize]').setAttribute('aria-expanded', 'true');
  }

  function close() {
    revision++;
    windowEl.hidden = true;
    peer = null;
    rows = [];
    input.value = '';
    retry = null;
    launch.focus();
  }

  $('[data-close]').onclick = close;
  windowEl.onkeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };
  $('[data-minimize]').onclick = () => {
    minimized = !minimized;
    windowEl.classList.toggle('dm-minimized', minimized);
    $('[data-minimize]').textContent = minimized ? 'Restore' : 'Minimize';
    $('[data-minimize]').setAttribute('aria-expanded', String(!minimized));
  };

  function render() {
    const list = $('.dm-messages'),
      bottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    list.replaceChildren();
    for (const m of rows) {
      if (Date.parse(m.created_at) <= Date.now() - 86400000) continue;

      const li = document.createElement('li'),
        who = document.createElement('strong'),
        body = document.createElement('p'),
        time = document.createElement('time');
      li.className = m.sender === user?.id ? 'dm-own' : '';
      who.textContent = m.sender === user?.id ? 'You' : peer?.name || 'Player';
      body.textContent = m.body;
      time.dateTime = m.created_at;
      time.textContent = new Date(m.created_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      li.append(who, time, body);
      list.append(li);
    }
    if (bottom) list.scrollTop = list.scrollHeight;

    markRead();
  }

  async function refresh() {
    if (!peer || windowEl.hidden || minimized || pollBusy || document.hidden) return;

    const version = revision,
      id = peer.id;
    pollBusy = true;
    try {
      const { data, error } = await supabaseClient.rpc('dm_thread', { p_peer: id });

      if (version !== revision) return;
      if (error) throw error;

      peer.name = data.name;
      peer.blocked = data.blocked;
      peer.canSend = data.can_send;
      $('h2').textContent = data.name;
      rows = data.messages || [];
      render();
      $('[data-block]').hidden = false;
      $('[data-block]').textContent = data.blocked ? 'Unblock player' : 'Block player';
      input.disabled = sending || !data.can_send;
      $('button[type=submit]').disabled = sending || !data.can_send;
      if (!data.can_send) status.textContent = 'Messaging is unavailable for this conversation.';
    } catch (e) {
      if (version === revision) status.textContent = message(e);
    } finally {
      pollBusy = false;
    }
  }

  async function open(id) {
    if (!user || !id || id === user.id) return;

    document.querySelectorAll('dialog[open]').forEach((d) => {
      if (d.id === 'profile-dialog') d.close();
    });
    revision++;
    peer = { id, name: 'Player', canSend: false };
    retry = null;
    rows = [];
    input.value = '';
    $('[data-counter]').textContent = '0/500';
    windowEl.hidden = false;
    expand();
    $('.dm-inbox').hidden = true;
    $('.dm-messages').hidden = false;
    form.hidden = false;
    $('[data-block]').hidden = true;
    input.disabled = true;
    $('button[type=submit]').disabled = true;
    status.textContent = 'Loading conversation…';
    $('h2').textContent = 'Private messages';
    render();
    await refresh();
    if (peer?.id === id && peer.canSend) {
      status.textContent = '';
      input.focus();
    }
  }

  async function inbox() {
    if (!user || inboxBusy) return;

    revision++;
    peer = null;
    retry = null;
    rows = [];
    windowEl.hidden = false;
    expand();
    $('h2').textContent = 'Private messages';
    form.hidden = true;
    $('.dm-messages').hidden = true;
    $('.dm-inbox').hidden = false;
    $('[data-block]').hidden = true;
    const version = revision;
    status.textContent = 'Loading conversations…';
    if (inboxBusy) return;

    inboxBusy = true;
    try {
      const { data, error } = await supabaseClient.rpc('dm_inbox');

      if (version !== revision) return;
      if (error) throw error;

      const list = $('.dm-inbox');
      list.replaceChildren();
      for (const item of data || []) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = item.name;
        b.dataset.dmPeer = item.peer;
        const badge = document.createElement('span');
        badge.className = 'notification-count';
        b.append(badge);
        b.onclick = () => open(item.peer);
        list.append(b);
      }

      countBadge();
      status.textContent = data?.length
        ? ''
        : 'No recent conversations. Open a player’s profile to message them.';
    } catch (e) {
      if (version === revision) status.textContent = message(e);
    } finally {
      inboxBusy = false;
    }
  }

  launch.onclick = inbox;
  $('[data-inbox]').onclick = inbox;
  input.oninput = () => {
    $('[data-counter]').textContent = Array.from(input.value).length + '/500';
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const body = input.value.trim();

    if (sending || !peer?.canSend || !body) return;
    if (Array.from(body).length > 500 || /[\r\n]/.test(body)) {
      status.textContent = 'Use 1–500 characters on one line.';
      return;
    }

    const id = peer.id,
      version = revision;

    if (!retry || retry.peer !== id || retry.body !== body)
      retry = { id: crypto.randomUUID(), peer: id, body };

    const attempt = retry;
    sending = true;
    input.disabled = true;
    $('button[type=submit]').disabled = true;
    input.value = '';
    $('[data-counter]').textContent = '0/500';
    status.textContent = 'Sending…';
    try {
      const { error } = await supabaseClient.rpc('send_dm', {
        p_id: attempt.id,
        p_peer: id,
        p_body: body,
      });

      if (error) throw error;
      if (version !== revision) return;

      retry = null;
      status.textContent = '';
      await refresh();
    } catch (e) {
      if (version === revision) {
        if (!input.value) input.value = body;

        $('[data-counter]').textContent = Array.from(input.value).length + '/500';
        status.textContent = message(e) + ' Your message is kept for retry.';
      }
    } finally {
      sending = false;
      if (version === revision) {
        input.disabled = !peer?.canSend;
        $('button[type=submit]').disabled = !peer?.canSend;
        input.focus();
      }
    }
  };
  $('[data-block]').onclick = async () => {
    if (!peer) return;

    const id = peer.id,
      version = revision;
    $('[data-block]').disabled = true;
    try {
      const { error } = await supabaseClient.rpc('set_dm_block', {
        p_peer: id,
        p_blocked: !peer.blocked,
      });

      if (error) throw error;
      if (version === revision) {
        status.textContent = '';
        await refresh();
      }
    } catch (e) {
      if (version === revision) status.textContent = message(e);
    } finally {
      $('[data-block]').disabled = false;
    }
  };

  function bind(container, id) {
    let button = container.querySelector('[data-dm-profile]');

    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.dmProfile = '';
      button.textContent = 'Message player';
      const closeForm = container.querySelector('form[method=dialog]');
      closeForm ? closeForm.before(button) : container.append(button);
    }

    button.hidden = !id || id === user?.id;
    button.onclick = () => open(id);
  }

  let authVersion = 0;

  function account(next) {
    if (user?.id !== next?.id) {
      close();
      incoming.clear();
      cursor = null;
      readThrough = {};
      try {
        readThrough = JSON.parse(sessionStorage.getItem('apsu-dm-read:' + next?.id)) || {};
      } catch {}
    }

    user = next;
    launch.hidden = !user;
    dock.hidden = !user;
    countBadge();
    notifications().catch(() => {});
  }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    authVersion++;
    account(session?.user);
  });
  const authRequest = authVersion;
  supabaseClient.auth
    .getSession()
    .then(({ data }) => {
      if (authRequest === authVersion) account(data.session?.user);
    })
    .catch(() => {});
  const timer = setInterval(() => {
    refresh();
    notifications().catch(() => {});
  }, 5000);
  window.addEventListener('pagehide', () => clearInterval(timer));
  window.APSUMessages = { open, bind };
})();
