// Version 3 local agency scenario. Vesper saves continue through the original engine.
(() => {
  const legacy = APSUSoloEngine;
  const rooms = {
    workshop: {
      name: 'Mercer Workshop',
      description:
        'A dark repair shop. A generator stands idle beside the locked supply-room door. Rain taps the street-facing windows.',
      mapX: 0,
      mapY: 0,
      exits: ['street', 'supply'],
    },
    street: {
      name: 'Mercer Street',
      description:
        'A stalled evacuation van waits beneath an unlit streetlamp. The workshop is still open.',
      mapX: 0,
      mapY: 1,
      exits: ['workshop', 'roof'],
    },
    roof: {
      name: 'Rooftop Store',
      description:
        'A rooftop storage landing. A charged portable battery sits under a weatherproof cover; it could power the workshop lights.',
      mapX: 1,
      mapY: 1,
      exits: ['street'],
    },
    supply: {
      name: 'Supply Room',
      description:
        'Metal shelving, spare belts and a single sealed fuel can. There is not enough fuel for both the generator and the van.',
      mapX: 1,
      mapY: 0,
      exits: ['workshop'],
    },
  };

  function currentRooms(s) {
    const result = structuredClone(rooms);

    if (!s.doorLocked)
      result.workshop.description = result.workshop.description.replace(
        'locked supply-room door',
        'unlocked supply-room door',
      );
    if (s.generatorPowered)
      result.workshop.description = result.workshop.description.replace(
        'A dark repair shop. A generator stands idle',
        s.batteryUsed
          ? 'A lit repair shop. A portable battery powers the lights; the generator stands idle'
          : 'A lit repair shop. A generator hums',
      );
    if (s.vanFueled)
      result.street.description = result.street.description.replace(
        'A stalled evacuation van',
        'A fueled evacuation van',
      );
    if (!s.items.some((i) => i.id === 'fuel' && i.owner === 'supply'))
      result.supply.description = 'Metal shelving and spare belts. The fuel can has been removed.';
    if (!s.items.some((i) => i.kind === 'battery' && i.owner === 'roof'))
      result.roof.description =
        'A rooftop storage landing. The weatherproof battery cover is empty.';

    return result;
  }

  const definitions = {
    mara: {
      id: 'mara',
      number: 2,
      name: 'Mara Vale',
      description:
        'A mechanic in her thirties, with cropped dark hair, grease-stained sleeves and a patched canvas jacket. Her hands move carefully even when she speaks quickly.',
      goal: 'Restore workshop power so the block has light and a place to gather.',
      personality:
        'Practical, protective of her neighbors, wary of wasting resources. Will bargain and reconsider when given a concrete alternative.',
    },
    leon: {
      id: 'leon',
      number: 3,
      name: 'Leon Price',
      description:
        'A lean driver in a rain-dark coat, with tired eyes and a folded street map tucked into his breast pocket.',
      goal: 'Fuel the van and leave to collect his stranded sister.',
      personality:
        'Impatient but not cruel. Wants a credible plan for his sister; can compromise, refuse or choose to leave a conversation.',
    },
  };

  const check = (ok, msg = 'Invalid Mercer save or action.') => {
    if (!ok) throw Error(msg);
  };

  const str = (v, n) => typeof v === 'string' && v.length <= n;

  const uid = () => crypto.randomUUID();

  const owners = ['player', 'mara', 'leon', ...Object.keys(rooms)];

  function note(s, who, text, privateTo = null) {
    s.messages.push({
      id: uid(),
      who,
      text,
      at: new Date().toISOString(),
      room: s.player.room,
      witnesses: privateTo
        ? [privateTo]
        : Object.keys(s.npcs).filter((id) => s.npcs[id].room === s.player.room),
    });
  }

  function create(name, description = '') {
    check(str(name, 60) && name.trim() && str(description, 1000), 'Enter your character name.');
    const s = {
      format: 'apsu-solo',
      version: 3,
      scenario: 'mercer',
      id: uid(),
      revision: 0,
      title: 'Last Light on Mercer',
      updatedAt: new Date().toISOString(),
      player: { name: name.trim(), description, room: 'workshop' },
      npcs: {
        mara: { room: 'workshop', following: false, memory: '', goal: definitions.mara.goal },
        leon: { room: 'workshop', following: false, memory: '', goal: definitions.leon.goal },
      },
      items: [
        ...Array.from({ length: 3 }, () => ({
          id: uid(),
          kind: 'lockpick',
          capacity: 100,
          name: 'Lockpick',
          description: 'A steel lockpick.',
          owner: 'mara',
        })),
        {
          id: 'fuel',
          kind: 'fuel',
          capacity: 0,
          name: 'Sealed fuel can',
          description: 'Enough fuel for one machine: the workshop generator or the van.',
          owner: 'supply',
        },
      ],
      doorLocked: true,
      activePick: null,
      generatorPowered: false,
      vanFueled: false,
      completed: false,
      messages: [],
      usage: { input: 0, output: 0, calls: 0 },
    };
    note(
      s,
      'Story',
      'Mercer Street is without power. Mara needs fuel for the workshop generator; Leon needs it for his van. The supply-room door is locked. Their choices, and yours, determine what happens.',
    );
    note(
      s,
      'Mara Vale',
      'There’s one can behind that door. I have picks, but I need someone with steady hands. We could give the whole block somewhere to gather.',
    );
    note(
      s,
      'Leon Price',
      'My sister is still across town. Light here will not get her home. Let’s at least talk before we use the fuel.',
    );

    return validate(s);
  }

  function validate(v) {
    check(v?.format === 'apsu-solo' && v.version === 3 && v.scenario === 'mercer');
    check(
      str(v.id, 80) &&
        /^[\w-]+$/.test(v.id) &&
        Number.isSafeInteger(v.revision) &&
        v.revision >= 0 &&
        str(v.updatedAt, 40) &&
        Number.isFinite(Date.parse(v.updatedAt)),
    );
    check(
      str(v.player?.name, 60) &&
        v.player.name.trim() &&
        str(v.player.description, 1000) &&
        Object.hasOwn(rooms, v.player.room),
    );
    const s = {
      format: 'apsu-solo',
      version: 3,
      scenario: 'mercer',
      id: v.id,
      revision: v.revision,
      title: 'Last Light on Mercer',
      updatedAt: v.updatedAt,
      player: { name: v.player.name, description: v.player.description, room: v.player.room },
      npcs: {},
      items: [],
      messages: [],
      usage: {},
    };

    for (const id of Object.keys(definitions)) {
      const n = v.npcs?.[id];
      check(
        n &&
          Object.hasOwn(rooms, n.room) &&
          typeof n.following === 'boolean' &&
          str(n.memory, 2500) &&
          str(n.goal, 1000) &&
          n.goal.trim(),
      );
      check(!n.following || n.room === s.player.room);
      s.npcs[id] = { room: n.room, following: n.following, memory: n.memory, goal: n.goal };
    }
    for (const key of ['doorLocked', 'generatorPowered', 'vanFueled']) {
      check(typeof v[key] === 'boolean');
      s[key] = v[key];
    }

    s.batteryUsed = v.batteryUsed === true;
    s.batteryIntroduced = true;
    check(!(s.generatorPowered && s.vanFueled) || s.batteryUsed);
    s.completed = s.generatorPowered || s.vanFueled;
    // Only the player can run this scenario's lock script, including older saves.
    s.unlockedBy = s.doorLocked ? null : 'player';
    check(Array.isArray(v.items) && v.items.length <= 10000);
    s.items = v.items.map((i) => {
      check(
        i &&
          str(i.id, 80) &&
          /^[\w-]+$/.test(i.id) &&
          owners.includes(i.owner) &&
          ['lockpick', 'fuel', 'prop', 'battery'].includes(i.kind) &&
          str(i.name, 80) &&
          i.name.trim() &&
          str(i.description, 500) &&
          [0, 50, 100].includes(i.capacity),
      );
      check((i.id === 'fuel') === (i.kind === 'fuel'));
      return {
        id: i.id,
        kind: i.kind,
        capacity: i.capacity,
        name: i.name,
        description: i.description,
        owner: i.owner,
      };
    });
    if (v.batteryIntroduced !== true && !s.items.some((i) => i.id === 'battery'))
      s.items.push({
        id: 'battery',
        kind: 'battery',
        capacity: 0,
        name: 'Charged battery',
        description: 'Can power the workshop lights without consuming fuel.',
        owner: 'roof',
      });

    check(new Set(s.items.map((i) => i.id)).size === s.items.length);
    check(
      !(s.vanFueled || (s.generatorPowered && !s.batteryUsed)) ||
        !s.items.some((i) => i.kind === 'fuel'),
    );
    check(!s.batteryUsed || !s.items.some((i) => i.kind === 'battery'));
    check(
      s.items.filter((i) => i.owner === 'player' && i.kind === 'lockpick' && i.capacity > 0)
        .length <= 3,
    );
    s.activePick = v.activePick;
    check(
      s.activePick === null ||
        (s.doorLocked &&
          s.player.room === 'workshop' &&
          s.items.some(
            (i) =>
              i.id === s.activePick &&
              i.owner === 'player' &&
              i.kind === 'lockpick' &&
              i.capacity > 0,
          )),
    );
    check(Array.isArray(v.messages) && v.messages.length <= 20000);
    s.messages = v.messages.map((m) => {
      check(
        m &&
          str(m.id, 80) &&
          ['Player', 'Story', ...Object.values(definitions).map((n) => n.name)].includes(m.who) &&
          str(m.text, 200000) &&
          str(m.at, 40) &&
          Number.isFinite(Date.parse(m.at)) &&
          Object.hasOwn(rooms, m.room) &&
          Array.isArray(m.witnesses) &&
          m.witnesses.every((id) => Object.hasOwn(definitions, id)),
      );
      return {
        id: m.id,
        who: m.who,
        text: m.text,
        at: m.at,
        room: m.room,
        witnesses: [...new Set(m.witnesses)],
      };
    });
    for (const k of ['input', 'output', 'calls']) {
      check(Number.isSafeInteger(v.usage?.[k]) && v.usage[k] >= 0);
      s.usage[k] = v.usage[k];
    }

    check(JSON.stringify(s).length < 8000000, 'Download a backup; the prototype save is full.');

    return s;
  }

  const actors = (s) => Object.entries(definitions).map(([id, d]) => ({ ...d, ...s.npcs[id] }));

  const inventory = (s, owner = 'player') =>
    s.items
      .filter((i) => i.owner === owner)
      .map((i) => ({
        ...i,
        kind: i.kind === 'lockpick' ? 'lockpick' : 'custom',
        appearance: {
          name: i.name,
          description:
            i.description + (i.kind === 'prop' ? ' (Roleplay prop; no scripted abilities.)' : ''),
          icon: i.kind === 'lockpick' ? 'tool' : i.kind === 'fuel' ? 'bottle' : 'box',
        },
      }));

  const accessible = (s, from, to) =>
    rooms[from].exits.includes(to) && !(to === 'supply' && s.doorLocked);

  function choices(s, id) {
    const n = s.npcs[id];
    check(n);
    const together = n.room === s.player.room;
    const list = [
      { id: 'none', description: 'Speak, decline, negotiate or wait without a mechanical action.' },
    ];

    if (together)
      list.push({
        id: n.following ? 'stay' : 'follow',
        description: n.following
          ? 'Stop following; remain here.'
          : 'Follow the player on future moves.',
      });
    for (const r of rooms[n.room].exits)
      if (accessible(s, n.room, r))
        list.push({
          id: 'move:' + r,
          description: 'Walk to ' + rooms[r].name + ' and stop following. Do not move the player.',
        });
    for (const i of s.items) {
      if (
        together &&
        i.owner === id &&
        !(
          i.kind === 'lockpick' &&
          i.capacity > 0 &&
          s.items.filter((x) => x.owner === 'player' && x.kind === 'lockpick' && x.capacity > 0)
            .length >= 3
        )
      )
        list.push({ id: 'give:' + i.id, description: 'Give your ' + i.name + ' to the player.' });
      if (i.owner === n.room)
        list.push({ id: 'take:' + i.id, description: 'Pick up ' + i.name + ' from this room.' });
    }
    if (s.items.some((i) => i.kind === 'fuel' && i.owner === id)) {
      if (n.room === 'workshop' && !s.generatorPowered)
        list.push({
          id: 'power',
          description: 'Use up your fuel to power the generator. This leaves no fuel for the van.',
        });
      if (n.room === 'street' && !s.vanFueled)
        list.push({
          id: 'van',
          description: 'Use up your fuel in the van. This leaves no fuel for the generator.',
        });
    }
    if (
      n.room === 'workshop' &&
      !s.generatorPowered &&
      s.items.some((i) => i.kind === 'battery' && i.owner === id)
    )
      list.push({
        id: 'battery',
        description: 'Use your charged battery for the workshop lights, preserving the fuel.',
      });

    return list;
  }

  function npcAction(s, id, choice) {
    check(
      choices(s, id).some((a) => a.id === choice),
      'That character action is no longer possible.',
    );
    const n = s.npcs[id],
      name = definitions[id].name,
      origin = n.room;

    const record = (state, who, text) => {
      note(state, who, text);
      const event = state.messages.at(-1);
      event.room = origin;
      event.witnesses = [
        ...new Set([
          id,
          ...Object.keys(state.npcs).filter((other) => state.npcs[other].room === origin),
        ]),
      ];
    };

    if (choice === 'none') return;
    if (choice === 'follow' || choice === 'stay') {
      n.following = choice === 'follow';
      record(s, 'Story', name + (n.following ? ' begins following you.' : ' stops following you.'));
    } else if (choice.startsWith('move:')) {
      n.room = choice.slice(5);
      n.following = false;
      record(s, 'Story', name + ' moves to ' + rooms[n.room].name + '.');
    } else if (choice.startsWith('give:') || choice.startsWith('take:')) {
      const i = s.items.find((i) => i.id === choice.slice(5));
      i.owner = choice.startsWith('give:') ? 'player' : id;
      record(
        s,
        'Story',
        name + (choice.startsWith('give:') ? ' gives you ' : ' picks up ') + i.name + '.',
      );
    } else if (choice === 'battery') {
      s.items = s.items.filter((i) => !(i.kind === 'battery' && i.owner === id));
      s.batteryUsed = true;
      s.generatorPowered = true;
      s.completed = true;
      record(
        s,
        'Story',
        name + ' powers the workshop lights with the battery. The fuel is untouched.',
      );
    } else {
      s.items = s.items.filter((i) => !(i.kind === 'fuel' && i.owner === id));
      if (choice === 'power') s.generatorPowered = true;
      if (choice === 'van') s.vanFueled = true;

      s.completed = true;
      record(
        s,
        'Story',
        name +
          (choice === 'power'
            ? ' starts the generator. The workshop has power.'
            : ' fuels the van. It is ready to collect his sister.'),
      );
    }
  }

  function act(v, action, value) {
    const s = validate(v);

    if (action === 'notice') {
      check(str(value, 1000));
      note(s, 'Story', value);
    } else if (action === 'narrate' || action === 'emote') {
      check(str(value, 200000) && value.trim());
      note(s, 'Player', action === 'emote' ? '/me ' + value : value);
    } else if (action === 'move') {
      check(!s.activePick, 'Finish or cancel the lock first.');
      const target = typeof value === 'object' ? value.room : value;
      check(accessible(s, s.player.room, target), 'That route is unavailable or locked.');
      s.player.room = target;
      for (const n of Object.values(s.npcs)) if (n.following) n.room = target;
      if (!value?.quiet) note(s, 'Story', 'You enter ' + rooms[target].name + '.');
    } else if (action === 'give-pick') {
      check(s.npcs.mara.room === s.player.room, 'Mara is not here.');
      const pick = s.items.find(
        (i) => i.owner === 'mara' && i.kind === 'lockpick' && i.capacity > 0,
      );
      check(pick, 'Mara has no working picks left.');
      npcAction(s, 'mara', 'give:' + pick.id);
    } else if (action === 'inventory') {
      const { ids, verb, target } = value || {};
      check(!s.activePick, 'Finish or cancel the lock first.');
      check(
        Array.isArray(ids) &&
          ids.length > 0 &&
          ids.length <= 100 &&
          new Set(ids).size === ids.length &&
          ['give', 'show', 'drop', 'delete', 'pickup'].includes(verb),
        'Invalid inventory action.',
      );
      if (['give', 'show'].includes(verb))
        check(s.npcs[target]?.room === s.player.room, 'Choose a character in this room.');

      const itemNames = ids
        .map((id) => s.items.find((i) => i.id === id)?.name || 'item')
        .join(', ');

      for (const id of ids) {
        const i = s.items.find((i) => i.id === id);
        check(
          i && i.owner === (verb === 'pickup' ? s.player.room : 'player'),
          'That item is not available.',
        );
        if (verb === 'show') continue;
        if (verb === 'delete') s.items = s.items.filter((x) => x.id !== id);
        else i.owner = verb === 'pickup' ? 'player' : verb === 'drop' ? s.player.room : target;
      }

      note(
        s,
        'Story',
        verb === 'give'
          ? s.player.name + ' gives ' + itemNames + ' to ' + definitions[target].name + '.'
          : verb === 'show'
            ? 'You show the item to ' + definitions[target].name + '.'
            : s.player.name +
              ': ' +
              itemNames +
              ' ' +
              { pickup: 'picked up', drop: 'dropped', delete: 'deleted' }[verb] +
              '.',
      );
    } else if (action === 'add-prop') {
      check(str(value?.name, 80) && value.name.trim() && str(value.description, 500));
      check(
        !/fuel|battery|lock\s*pick|key|generator/i.test(value.name),
        'Use the tracked world item for that object.',
      );
      s.items.push({
        id: uid(),
        kind: 'prop',
        capacity: 0,
        name: value.name.trim(),
        description: value.description,
        owner: 'player',
      });
      note(s, 'Story', 'Roleplay prop added. It has no scripted abilities.');
    } else if (action === 'use-fuel') {
      check(
        ['workshop', 'street'].includes(s.player.room) &&
          !(s.player.room === 'workshop' ? s.generatorPowered : s.vanFueled),
        'Use fuel by the generator or van.',
      );
      const fuel = s.items.find((i) => i.kind === 'fuel' && i.owner === 'player');
      check(fuel, 'You do not have the fuel.');
      s.items = s.items.filter((i) => i.id !== fuel.id);
      if (s.player.room === 'workshop') s.generatorPowered = true;
      else s.vanFueled = true;

      s.completed = true;
      note(
        s,
        'Story',
        s.player.room === 'workshop'
          ? 'You power the workshop generator.'
          : 'You fuel the evacuation van.',
      );
    } else if (action === 'use-battery') {
      check(
        s.player.room === 'workshop' &&
          !s.generatorPowered &&
          s.items.some((i) => i.kind === 'battery' && i.owner === 'player'),
        'Bring the charged battery to the workshop.',
      );
      s.items = s.items.filter((i) => !(i.kind === 'battery' && i.owner === 'player'));
      s.batteryUsed = true;
      s.generatorPowered = true;
      s.completed = true;
      note(
        s,
        'Story',
        s.player.name + ' powers the workshop lights with the battery. The fuel is untouched.',
      );
    } else if (action === 'edit-npc') {
      check(
        Object.hasOwn(s.npcs, value?.id) &&
          str(value.memory, 2500) &&
          str(value.goal, 1000) &&
          value.goal.trim(),
        'Enter a valid memory and goal.',
      );
      s.npcs[value.id].memory = value.memory;
      s.npcs[value.id].goal = value.goal;
      note(s, 'Story', 'OOC character state updated.');
    } else if (['insert', 'damage', 'break', 'unlock'].includes(action)) {
      check(s.player.room === 'workshop' && s.doorLocked, 'This lock is unavailable.');
      const i = s.items.find(
        (i) => i.id === value && i.owner === 'player' && i.kind === 'lockpick' && i.capacity > 0,
      );
      check(i, 'You do not own a working lockpick.');
      if (action === 'insert') {
        check(!s.activePick || s.activePick === value);
        s.activePick = value;
      } else {
        check(s.activePick === value, 'Insert the pick first.');
        if (action === 'damage') i.capacity = 50;
        if (action === 'break') {
          i.capacity = 0;
          s.activePick = null;
          note(s, 'Story', 'The lockpick broke.');
        }
        if (action === 'unlock') {
          s.activePick = null;
          s.doorLocked = false;
          note(s, 'Story', s.player.name + ' picked the lock. The door is unlocked.');
        }
      }
    } else if (action === 'cancel') {
      if (s.activePick) {
        s.items.find((i) => i.id === s.activePick).capacity = 0;
        s.activePick = null;
        note(s, 'Story', 'The inserted lockpick broke.');
      }
    } else throw Error('Unknown action.');

    return validate(s);
  }

  function context(s, text, id = 'mara', options = {}) {
    const npc = s.npcs[id];
    check(npc, 'Choose a character.');
    const audible =
      npc.room === s.player.room ||
      (/^\/shout\s/i.test(text) && rooms[s.player.room].exits.includes(npc.room));
    check(audible, 'That character cannot hear you.');
    const witnessed = s.messages.filter((m) => m.witnesses.includes(id));
    const words = text.toLowerCase().match(/[a-z]{4,}/g) || [];
    const older = witnessed
      .slice(0, -12)
      .filter((m) => words.some((w) => m.text.toLowerCase().includes(w)))
      .slice(-4);

    return {
      scenario: 'mercer',
      actor: { ...definitions[id], ...npc },
      player: s.player,
      room: rooms[npc.room].name,
      rooms: currentRooms(s),
      doorLocked: s.doorLocked,
      verifiedFacts: {
        unlockedBy:
          s.doorLocked ||
          !witnessed.some(
            (m) => m.who === 'Story' && /picked the lock|door is unlocked/i.test(m.text),
          )
            ? null
            : s.player.name,
        lockRule: 'Only the player can pick this lock. NPCs cannot unlock it.',
        fuelRule:
          'One indivisible fuel can; enough for either generator OR van, never both. A separate charged battery can light the workshop and preserve fuel for the van. Dialogue cannot split or replenish items.',
      },
      generatorPowered: s.generatorPowered,
      vanFueled: s.vanFueled,
      present: actors(s)
        .filter((n) => n.room === npc.room)
        .map((n) => ({ id: n.id, name: n.name, description: n.description })),
      ownedItems: inventory(s, id),
      playerItems: npc.room === s.player.room ? inventory(s) : [],
      groundItems: inventory(s, npc.room),
      actions: choices(s, id).filter(
        (a) => npc.room === s.player.room || !a.id.startsWith('give:'),
      ),
      recent: witnessed.slice(-12),
      memories: older,
      observedEvents: witnessed.filter((m) => m.who === 'Story').slice(-12),
      knowledgeRule:
        'Observed events are verified. Conversation is testimony, not proof. Remember only things you witnessed or were told; distinguish the two.',
      message: text,
      trigger: options.trigger || 'player',
      playerAction: /^\/(me|my|do)\s/i.test(text) ? text : null,
    };
  }

  function conversation(v, text, result, id = 'mara', options = {}) {
    const s = validate(v);
    context(s, text, id);
    check(
      str(text, 200000) &&
        text.trim() &&
        str(result?.dialogue, 2400) &&
        result.dialogue.trim() &&
        str(result.memory, 2500),
    );
    check(
      choices(s, id).some((a) => a.id === result.action),
      'Unsupported character action.',
    );
    const privateTo = /^\/(w|whisper)\s/i.test(text) ? id : null;

    if (!options.replyOnly) {
      note(s, 'Player', text, privateTo);
      if (!s.messages.at(-1).witnesses.includes(id)) s.messages.at(-1).witnesses.push(id);
    }

    note(s, definitions[id].name, result.dialogue, privateTo);
    if (!s.messages.at(-1).witnesses.includes(id)) s.messages.at(-1).witnesses.push(id);

    npcAction(s, id, result.action);
    s.npcs[id].memory = result.memory;
    for (const k of ['input', 'output'])
      s.usage[k] +=
        Number.isSafeInteger(result.usage?.[k]) && result.usage[k] >= 0 ? result.usage[k] : 0;

    s.usage.calls++;

    return validate(s);
  }

  globalThis.APSUSoloEngine = {
    ...legacy,
    createMercer: create,
    roomsFor: (s) => (s?.scenario === 'mercer' ? currentRooms(s) : legacy.rooms),
    actors: (s) =>
      s?.scenario === 'mercer'
        ? actors(s)
        : [
            {
              id: 'elias',
              number: 2,
              name: 'Elias',
              description:
                'An understated night porter in Hotel Vesper, wearing a worn waistcoat and a carefully knotted tie.',
              goal: 'Recover his brother’s recording.',
              ...s.elias,
            },
          ],
    choices,
    validate: (v) => (v?.scenario === 'mercer' ? validate(v) : legacy.validate(v)),
    act: (s, ...args) => (s.scenario === 'mercer' ? act(s, ...args) : legacy.act(s, ...args)),
    inventory: (s, ...args) =>
      s.scenario === 'mercer' ? inventory(s, ...args) : legacy.inventory(s, ...args),
    context: (s, ...args) =>
      s.scenario === 'mercer' ? context(s, ...args) : legacy.context(s, ...args),
    conversation: (s, ...args) =>
      s.scenario === 'mercer' ? conversation(s, ...args) : legacy.conversation(s, ...args),
  };
})();
