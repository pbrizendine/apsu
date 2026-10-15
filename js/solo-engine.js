// Pure local world rules. AI dialogue never owns inventory, movement, or door state.
(() => {
  const rooms = Object.freeze({
    lobby: {
      name: 'Hotel lobby',
      mapX: 0,
      mapY: 0,
      description: 'Rain brushes the tall windows beside a deserted reception desk.',
      exits: ['office'],
    },
    office: {
      name: 'Maintenance office',
      mapX: 0,
      mapY: 1,
      description: 'A workbench faces the archive door. A faded label reads: HOTEL RECORDINGS.',
      exits: ['lobby', 'archive'],
    },
    archive: {
      name: 'Recording archive',
      mapX: 1,
      mapY: 1,
      description:
        'Shelves of old recordings line the walls. A brass-latched case bears the initials E. R.',
      exits: ['office'],
    },
  });

  const id = () => crypto.randomUUID();

  const check = (ok, message = 'This save is invalid or belongs to a newer version.') => {
    if (!ok) throw Error(message);
  };

  const string = (s, max) => typeof s === 'string' && s.length <= max;

  function message(s, who, text) {
    s.messages.push({ id: id(), who, text, at: new Date().toISOString() });
  }

  function create(name, description = '') {
    check(
      string(name, 60) && name.trim() && string(description, 1000),
      'Enter a character name of up to 60 characters.',
    );
    const s = {
      format: 'apsu-solo',
      version: 2,
      id: id(),
      revision: 0,
      title: 'The Vesper Recording',
      updatedAt: new Date().toISOString(),
      player: { name: name.trim(), description, room: 'lobby' },
      elias: { room: 'lobby', following: false, memory: '' },
      items: Array.from({ length: 3 }, () => ({
        id: id(),
        kind: 'lockpick',
        capacity: 100,
        owner: 'elias',
      })),
      recordingRoom: 'archive',
      doorLocked: true,
      inventory: [],
      pickGifts: 0,
      recording: 'archive',
      completed: false,
      activePick: null,
      messages: [],
      usage: { input: 0, output: 0, calls: 0 },
    };
    message(
      s,
      'Story',
      'Hotel Vesper, 1987. Help Elias recover his late brother’s recording from the archive. Story actions work without AI; connect your own key for conversation.',
    );
    message(
      s,
      'Elias',
      'I left a recording in the archive. The key is missing, but I have a pick. Would you help me with the door?',
    );

    return s;
  }

  function validate(value) {
    check(
      value &&
        typeof value === 'object' &&
        value.format === 'apsu-solo' &&
        [1, 2].includes(value.version),
    );
    // Rebuild the schema: imported properties can never add executable content or credentials.
    const s = {};

    for (const k of [
      'format',
      'version',
      'id',
      'revision',
      'title',
      'updatedAt',
      'doorLocked',
      'pickGifts',
      'recording',
      'completed',
      'activePick',
    ])
      s[k] = value[k];

    s.version = 2;
    check(string(s.id, 80) && /^[\w-]+$/.test(s.id) && s.id.length > 0);
    check(Number.isSafeInteger(s.revision) && s.revision >= 0 && string(s.title, 100));
    check(string(s.updatedAt, 40) && Number.isFinite(Date.parse(s.updatedAt)));
    check(typeof s.doorLocked === 'boolean' && typeof s.completed === 'boolean');
    check(Number.isSafeInteger(s.pickGifts) && s.pickGifts >= 0 && s.pickGifts <= 10000);
    check(['archive', 'player', 'elias', 'deleted'].includes(s.recording));
    check(s.completed === (s.recording === 'elias'));
    const p = value.player,
      e = value.elias;
    check(
      p &&
        string(p.name, 60) &&
        p.name.trim() &&
        string(p.description, 1000) &&
        Object.hasOwn(rooms, p.room),
    );
    check(
      e &&
        Object.hasOwn(rooms, e.room) &&
        typeof e.following === 'boolean' &&
        string(e.memory, 2500),
    );
    s.player = { name: p.name, description: p.description, room: p.room };
    s.elias = { room: e.room, following: e.following, memory: e.memory };
    check(!e.following || e.room === p.room);
    check(Array.isArray(value.inventory) && value.inventory.length <= 10000);
    s.inventory = value.inventory.map((i) => {
      check(i && string(i.id, 80) && /^[\w-]+$/.test(i.id) && [0, 50, 100].includes(i.capacity));
      return { id: i.id, capacity: i.capacity };
    });
    s.recordingRoom = value.recordingRoom || 'archive';
    check(Object.hasOwn(rooms, s.recordingRoom));
    // Old saves gain a finite remaining NPC stock once, then retain actual item instances.
    const items =
      value.items ??
      Array.from({ length: Math.max(0, 3 - s.pickGifts) }, (_, n) => ({
        id: 'elias-spare-' + n,
        kind: 'lockpick',
        capacity: 100,
        owner: 'elias',
      }));
    check(Array.isArray(items) && items.length <= 10000);
    s.items = items.map((i) => {
      check(i && string(i.id, 80) && /^[\w-]+$/.test(i.id) && i.id !== 'recording');
      check(['player', 'elias', ...Object.keys(rooms)].includes(i.owner));
      check(['lockpick', 'prop'].includes(i.kind));
      if (i.kind === 'lockpick') {
        check(i.owner !== 'player' && [0, 50, 100].includes(i.capacity));
        return { id: i.id, kind: i.kind, capacity: i.capacity, owner: i.owner };
      }

      check(string(i.name, 80) && i.name.trim() && string(i.description, 500));

      return { id: i.id, kind: i.kind, name: i.name, description: i.description, owner: i.owner };
    });
    const ids = [...s.inventory, ...s.items].map((i) => i.id);
    check(new Set(ids).size === ids.length);
    check(new Set(s.inventory.map((i) => i.id)).size === s.inventory.length);
    check(s.inventory.filter((i) => i.capacity > 0).length <= 3);
    check(
      s.activePick === null || s.inventory.some((i) => i.id === s.activePick && i.capacity > 0),
    );
    check(s.activePick === null || (s.doorLocked && p.room === 'office'));
    check(Array.isArray(value.messages) && value.messages.length <= 20000);
    s.messages = value.messages.map((m) => {
      check(
        m &&
          string(m.id, 80) &&
          ['Player', 'Elias', 'Story'].includes(m.who) &&
          string(m.text, 200000) &&
          string(m.at, 40) &&
          Number.isFinite(Date.parse(m.at)),
      );
      return { id: m.id, who: m.who, text: m.text, at: m.at };
    });
    const u = value.usage;
    check(u && ['input', 'output', 'calls'].every((k) => Number.isSafeInteger(u[k]) && u[k] >= 0));
    s.usage = { input: u.input, output: u.output, calls: u.calls };
    check(
      new TextEncoder().encode(JSON.stringify(s)).length < 9000000,
      'This world has reached the prototype save limit. Download a backup.',
    );

    return s;
  }

  function act(original, action, value) {
    const s = validate(original),
      together = s.player.room === s.elias.room;

    if (action === 'notice') {
      check(string(value, 1000));
      message(s, 'Story', value);
    } else if (action === 'narrate') {
      check(string(value, 200000) && /^\/(me|my|do)\s+\S/i.test(value), 'Invalid Command');
      message(s, 'Player', value);
    } else if (action === 'emote') {
      check(string(value, 496) && value.trim(), 'Write an action after /me.');
      message(s, 'Player', '/me ' + value.trim());
    } else if (action === 'give-pick') {
      check(together && s.doorLocked && !s.completed, 'Elias cannot offer a pick here.');
      check(!s.inventory.some((i) => i.capacity > 0), 'You already have a working lockpick.');
      const spare = s.items.find(
        (i) => i.owner === 'elias' && i.kind === 'lockpick' && i.capacity > 0,
      );
      check(spare, 'Elias has no working lockpicks left.');
      s.items = s.items.filter((i) => i.id !== spare.id);
      s.inventory.push({ id: spare.id, capacity: spare.capacity });
      s.pickGifts++;
      s.elias.following = true;
      if (value !== 'ai')
        message(
          s,
          'Elias',
          s.pickGifts === 1
            ? 'Take this pick. The archive is through the maintenance office. I’ll come with you.'
            : 'Here is another pick. Take your time with the lock.',
        );

      message(s, 'Story', 'Elias gives you a lockpick and agrees to follow.');
    } else if (action === 'add-prop') {
      check(
        string(value?.name, 80) && value.name.trim() && string(value.description, 500),
        'Enter a prop name and description.',
      );
      check(
        !/lock\s*pick|recording|key/i.test(value.name),
        'Use the existing world item for that object.',
      );
      s.items.push({
        id: id(),
        kind: 'prop',
        owner: 'player',
        name: value.name.trim(),
        description: value.description,
      });
      message(
        s,
        'Story',
        'Added roleplay prop: ' + value.name.trim() + '. This has no scripted abilities.',
      );
    } else if (action === 'inventory') {
      const { ids, verb, target } = value || {};
      check(
        ['give', 'drop', 'delete', 'pickup', 'show'].includes(verb) &&
          Array.isArray(ids) &&
          ids.length > 0 &&
          ids.length <= 100 &&
          new Set(ids).size === ids.length,
        'Invalid inventory action.',
      );
      check(!s.activePick, 'Finish or cancel the lock first.');
      if (['give', 'show'].includes(verb))
        check(target === 'elias' && together, 'Choose a character in this room.');
      for (const itemId of ids) {
        const source = verb === 'pickup' ? s.player.room : 'player';
        const item = inventory(s, source).find((i) => i.id === itemId);
        check(item, 'You do not own that item, or it is no longer here.');
        if (verb === 'show') continue;

        const owner =
          verb === 'give'
            ? 'elias'
            : verb === 'drop'
              ? s.player.room
              : verb === 'pickup'
                ? 'player'
                : 'deleted';

        if (itemId === 'recording') {
          s.recording = Object.hasOwn(rooms, owner) ? 'archive' : owner;
          if (Object.hasOwn(rooms, owner)) s.recordingRoom = owner;

          s.completed = owner === 'elias';
        } else {
          s.inventory = s.inventory.filter((i) => i.id !== itemId);
          const stored = s.items.find((i) => i.id === itemId);
          s.items = s.items.filter((i) => i.id !== itemId);
          if (owner !== 'deleted') {
            if (item.kind === 'lockpick' && owner === 'player')
              s.inventory.push({ id: item.id, capacity: item.capacity });
            else
              s.items.push(
                stored
                  ? { ...stored, owner }
                  : { id: item.id, kind: 'lockpick', capacity: item.capacity, owner },
              );
          }
        }
      }

      check(
        s.inventory.filter((i) => i.capacity > 0).length <= 3,
        'You can carry at most three working lockpicks.',
      );
      message(
        s,
        'Story',
        verb === 'give'
          ? 'Item given to Elias.'
          : verb === 'show'
            ? 'You show Elias the item; it remains yours.'
            : verb === 'drop'
              ? 'Item dropped.'
              : verb === 'delete'
                ? 'Item deleted.'
                : 'Item picked up.',
      );
    } else if (action === 'move') {
      check(s.activePick === null, 'Finish or cancel the lock first.');
      const quiet = typeof value === 'object' && value?.quiet === true;
      value = typeof value === 'object' ? value.room : value;
      check(rooms[s.player.room].exits.includes(value), 'That room is not adjacent.');
      check(!(value === 'archive' && s.doorLocked), 'The door is locked.');
      s.player.room = value;
      if (s.elias.following) s.elias.room = value;
      if (!quiet)
        message(
          s,
          'Story',
          `You enter ${rooms[value].name}${s.elias.following ? ' with Elias' : ''}.`,
        );
    } else if (action === 'take-recording') {
      check(
        s.player.room === s.recordingRoom && s.recording === 'archive',
        'The recording is not here.',
      );
      s.recording = 'player';
      message(s, 'Story', 'You pick up the recording case.');
    } else if (action === 'give-recording') {
      check(together && s.recording === 'player', 'You must have the recording and be with Elias.');
      s.recording = 'elias';
      s.completed = true;
      message(s, 'Elias', 'That’s his handwriting. I thought I’d never see this again. Thank you.');
      message(
        s,
        'Story',
        'Objective complete: you recovered the recording and gave it to Elias. You can keep talking or download your save.',
      );
    } else if (['insert', 'damage', 'break', 'unlock'].includes(action)) {
      check(s.player.room === 'office' && s.doorLocked, 'This lock is not available.');
      const pick = s.inventory.find((i) => i.id === value && i.capacity > 0);
      check(pick, 'This lockpick cannot be used.');
      if (action === 'insert') {
        check(s.activePick === null || s.activePick === value);
        s.activePick = value;
      } else {
        check(s.activePick === value, 'Insert the lockpick first.');
        if (action === 'damage') pick.capacity = 50;
        if (action === 'break') {
          pick.capacity = 0;
          s.activePick = null;
          message(s, 'Story', 'The lockpick broke.');
        }
        if (action === 'unlock') {
          s.doorLocked = false;
          s.activePick = null;
          message(s, 'Story', 'The door is unlocked.');
        }
      }
    } else if (action === 'cancel') {
      if (s.activePick) {
        s.inventory.find((i) => i.id === s.activePick).capacity = 0;
        s.activePick = null;
        message(s, 'Story', 'The inserted lockpick broke when the attempt ended.');
      }
    } else throw Error('Unknown solo action.');

    return validate(s);
  }

  function conversation(s, text, result) {
    check(
      s.player.room === s.elias.room ||
        (/^\/shout\s/i.test(text) && rooms[s.player.room].exits.includes(s.elias.room)),
      'Elias cannot hear you from here.',
    );
    check(string(text, 200000) && text.trim());
    check(
      result &&
        string(result.dialogue, 2400) &&
        result.dialogue.trim() &&
        string(result.memory, 2500),
    );
    let next = validate(s);
    message(next, 'Player', text);
    if (
      result.action === 'give_pick' &&
      next.doorLocked &&
      !next.inventory.some((i) => i.capacity > 0) &&
      !next.completed
    )
      next = act(next, 'give-pick', 'ai');

    message(next, 'Elias', result.dialogue);
    next.elias.memory = result.memory;
    for (const k of ['input', 'output'])
      next.usage[k] +=
        Number.isSafeInteger(result.usage?.[k]) && result.usage[k] >= 0 ? result.usage[k] : 0;

    next.usage.calls++;

    return validate(next);
  }

  function inventory(s, owner = 'player') {
    const list =
      owner === 'player'
        ? s.inventory.map((i) => ({ ...i, kind: 'lockpick', appearance: { icon: 'tool' } }))
        : [];

    for (const i of s.items || [])
      if (i.owner === owner)
        list.push(
          i.kind === 'lockpick'
            ? { ...i, appearance: { icon: 'tool' } }
            : {
                ...i,
                kind: 'custom',
                appearance: {
                  name: i.name,
                  description: i.description + ' (Roleplay prop; no scripted abilities.)',
                  icon: 'box',
                },
              },
        );
    if (
      (['player', 'elias'].includes(owner) && s.recording === owner) ||
      (s.recording === 'archive' && owner === (s.recordingRoom || 'archive'))
    )
      list.push({
        id: 'recording',
        kind: 'custom',
        appearance: {
          name: 'Recording case',
          description: 'A brass-latched case bearing the initials E. R.',
          icon: 'box',
        },
      });

    return list;
  }

  function context(s, text) {
    const words = text.toLowerCase().match(/[a-z]{4,}/g) || [];
    const old = s.messages
      .slice(0, -16)
      .map((m, index) => ({
        m,
        index,
        score: words.filter((w) => m.text.toLowerCase().includes(w)).length,
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.index - a.index)
      .slice(0, 6)
      .map((x) => x.m);
    return {
      eliasItems: inventory(s, 'elias'),
      ownedItems: { player: inventory(s, 'player'), elias: inventory(s, 'elias') },
      player: s.player,
      elias: s.elias,
      room: rooms[s.player.room].name,
      doorLocked: s.doorLocked,
      inventory: s.inventory,
      recording: s.recording,
      completed: s.completed,
      pickGifts: s.pickGifts,
      delivery: /^\/shout\s/i.test(text) ? 'shout' : 'room',
      memories: old,
      recent: s.messages.slice(-16),
      message: text,
    };
  }

  globalThis.APSUSoloEngine = { create, validate, act, conversation, context, rooms, inventory };
})();
