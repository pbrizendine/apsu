// Data-driven solo worlds. Only bounded, code-defined actions mutate state.
(() => {
  const prior = APSUSoloEngine,
    check = (v, m = 'Invalid generated save or action.') => {
      if (!v) throw Error(m);
    },
    str = (v, n) => typeof v === 'string' && v.length <= n;

  const sim = globalThis.APSUSoloSimulation;

  const uuid = () => crypto.randomUUID(),
    now = () => new Date().toISOString();

  function note(s, who, text, room = s.player.room, privateTo = null) {
    s.messages.push({
      id: uuid(),
      who,
      text,
      at: now(),
      room,
      witnesses: privateTo
        ? [privateTo]
        : Object.keys(s.npcs).filter((id) => s.npcs[id].room === room),
    });
  }

  const roomsFor = (s) =>
    Object.fromEntries(
      s.blueprint.rooms.map((r) => [
        r.id,
        {
          ...r,
          hasDoor: r.locked,
          locked: s.doors[r.id] === true,
          description:
            r.description +
            (r.locked ? ' The entrance door is ' + (s.doors[r.id] ? 'locked.' : 'unlocked.') : ''),
        },
      ]),
    );

  const actors = (s) =>
    s.blueprint.characters.map((c, n) => ({ ...c, ...s.npcs[c.id], number: n + 2 }));

  const canMove = (s, from, to) =>
    s.blueprint.rooms.find((r) => r.id === from)?.exits.includes(to) && s.doors[to] !== true;

  function validate(v) {
    check(v?.format === 'apsu-solo' && v.version === 4 && v.scenario === 'generated');
    const blueprint = APSUSoloBlueprint.validate(v.blueprint),
      rids = blueprint.rooms.map((r) => r.id),
      nids = blueprint.characters.map((n) => n.id),
      owners = ['player', ...rids, ...nids];
    check(
      str(v.id, 80) &&
        /^[\w-]+$/.test(v.id) &&
        Number.isSafeInteger(v.revision) &&
        v.revision >= 0 &&
        Number.isFinite(Date.parse(v.updatedAt)),
    );
    check(
      str(v.player?.name, 60) &&
        v.player.name.trim() &&
        str(v.player.description, 1000) &&
        rids.includes(v.player.room),
    );
    const s = {
      format: 'apsu-solo',
      version: 4,
      scenario: 'generated',
      id: v.id,
      revision: v.revision,
      updatedAt: v.updatedAt,
      title: blueprint.title,
      blueprint,
      player: { ...v.player },
      npcs: {},
      items: [],
      doors: {},
      unlockedBy: {},
      messages: [],
      usage: {},
      activePick: v.activePick,
      activeDoor: v.activeDoor,
      completed: false,
    };
    s.player = { name: v.player.name, description: v.player.description, room: v.player.room };
    for (const c of blueprint.characters) {
      const n = v.npcs?.[c.id];
      check(
        n &&
          rids.includes(n.room) &&
          typeof n.following === 'boolean' &&
          str(n.goal, 1000) &&
          str(n.memory, 2500) &&
          (!n.following || n.room === s.player.room),
      );
      s.npcs[c.id] = { room: n.room, following: n.following, goal: n.goal, memory: n.memory };
      const candidate = n.goalCandidate;

      if (
        candidate &&
        str(candidate.goal, 1000) &&
        str(candidate.reason, 600) &&
        Number.isSafeInteger(candidate.startedAt) &&
        candidate.startedAt >= 0 &&
        Number.isSafeInteger(candidate.count) &&
        candidate.count > 0 &&
        candidate.count <= 100
      )
        s.npcs[c.id].goalCandidate = {
          goal: candidate.goal,
          reason: candidate.reason,
          startedAt: candidate.startedAt,
          count: candidate.count,
        };

      s.npcs[c.id].goalHistory = (Array.isArray(n.goalHistory) ? n.goalHistory : [])
        .filter(
          (h) =>
            h &&
            str(h.from, 1000) &&
            str(h.to, 1000) &&
            str(h.reason, 600) &&
            Number.isSafeInteger(h.turn) &&
            h.turn >= 0,
        )
        .slice(-3)
        .map((h) => ({ from: h.from, to: h.to, reason: h.reason, turn: h.turn }));
    }
    for (const r of blueprint.rooms.filter((r) => r.locked)) {
      check(typeof v.doors?.[r.id] === 'boolean');
      s.doors[r.id] = v.doors[r.id];
      if (!v.doors[r.id])
        s.unlockedBy[r.id] = ['player', ...nids].includes(v.unlockedBy?.[r.id])
          ? v.unlockedBy[r.id]
          : null;
    }

    check(Array.isArray(v.items) && v.items.length <= 10000);
    s.items = v.items.map((source) => {
      const i = APSUSoloBlueprint.scriptItem(source);
      check(
        i &&
          str(i.id, 80) &&
          /^[\w-]+$/.test(i.id) &&
          ['prop', 'lockpick', 'key', 'weapon', 'drink'].includes(i.kind) &&
          owners.includes(i.owner) &&
          str(i.name, 80) &&
          str(i.description, 500) &&
          [0, 50, 100].includes(i.capacity),
      );
      check(
        i.valueMinor == null ||
          (Number.isSafeInteger(i.valueMinor) && i.valueMinor >= 0 && i.valueMinor <= 1e12),
        'Item value must be a nonnegative amount in minor currency units.',
      );
      if (i.kind === 'drink') {
        check(
          Number.isInteger(i.servings ?? 1) && (i.servings ?? 1) >= 1 && (i.servings ?? 1) <= 100,
          'Invalid drink servings.',
        );
        check(
          Number.isFinite(i.abv) &&
            i.abv >= 0 &&
            i.abv <= 100 &&
            Number.isFinite(i.servingMl) &&
            i.servingMl >= 10 &&
            i.servingMl <= 2000,
          'Invalid drink.',
        );
      }
      if (i.kind === 'key')
        check(
          blueprint.rooms.some((r) => r.id === i.opens && r.locked),
          'Unknown key destination.',
        );
      if (i.kind === 'weapon')
        check(
          ['blade', 'blunt', 'pistol', 'rifle', 'bow'].includes(i.template),
          'Unknown weapon template.',
        );

      return {
        ...(i.kind === 'key' ? { opens: i.opens } : {}),
        ...(i.kind === 'weapon' ? { template: i.template } : {}),
        ...(i.kind === 'drink'
          ? { abv: i.abv, servingMl: i.servingMl, servings: i.servings ?? 1 }
          : {}),
        id: i.id,
        kind: i.kind,
        owner: i.owner,
        name: i.name,
        description: i.description,
        valueMinor: i.valueMinor ?? null,
        capacity: i.capacity,
      };
    });
    check(new Set(s.items.map((i) => i.id)).size === s.items.length);
    check(
      s.items.filter((i) => i.owner === 'player' && i.kind === 'lockpick' && i.capacity > 0)
        .length <= 3,
    );
    check(
      s.activePick === null ||
        s.items.some(
          (i) =>
            i.id === s.activePick &&
            i.owner === 'player' &&
            i.kind === 'lockpick' &&
            i.capacity > 0,
        ),
    );
    check(
      s.activePick === null
        ? s.activeDoor === null
        : s.doors[s.activeDoor] === true &&
            blueprint.rooms.find((r) => r.id === s.player.room).exits.includes(s.activeDoor),
    );
    check(Array.isArray(v.messages) && v.messages.length <= 20000);
    s.messages = v.messages.map((m) => {
      check(
        m &&
          str(m.id, 80) &&
          ['Story', 'Player', ...blueprint.characters.map((c) => c.name)].includes(m.who) &&
          str(m.text, 200000) &&
          Number.isFinite(Date.parse(m.at)) &&
          rids.includes(m.room) &&
          Array.isArray(m.witnesses) &&
          m.witnesses.every((id) => nids.includes(id)),
      );
      return {
        id: m.id,
        who: m.who,
        text: m.text,
        at: m.at,
        room: m.room,
        witnesses: [...new Set(m.witnesses)],
        ...(m.who === 'Story' && m.voidedTurn === true ? { voidedTurn: true } : {}),
        ...(m.visible === false ? { visible: false } : {}),
      };
    });
    for (const k of ['input', 'output', 'calls']) {
      check(Number.isSafeInteger(v.usage?.[k]) && v.usage[k] >= 0);
      s.usage[k] = v.usage[k];
    }
    if (sim) sim.normalize(v, s);
    if (v.combatCheckpoint != null) {
      check(
        !v.combatCheckpoint.combatCheckpoint,
        'Combat checkpoints cannot contain other checkpoints.',
      );
      const checkpoint = validate(v.combatCheckpoint);
      check(
        checkpoint.id === s.id &&
          !checkpoint.sim.combat &&
          checkpoint.sim.people.player.hp > 0 &&
          !checkpoint.activePick,
        'Invalid pre-combat checkpoint.',
      );
      s.combatCheckpoint = checkpoint;
    }

    check(JSON.stringify(s).length < 32000000, 'Download a backup; this save is full.');

    return s;
  }

  function create(design, name, description = '') {
    let blueprint = APSUSoloBlueprint.validate(design);
    const duplicate = blueprint.characters.find(
      (c) => c.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );

    if (duplicate) {
      check(
        blueprint.characters.length > 1,
        'This name belongs to the only NPC. Choose a different player name.',
      );
      blueprint.characters = blueprint.characters.filter((c) => c.id !== duplicate.id);
      for (const item of blueprint.items) if (item.owner === duplicate.id) item.owner = 'player';
      for (const role of blueprint.roles) if (role.holder === duplicate.id) role.holder = 'player';
      for (const record of blueprint.lore)
        record.knownBy = record.knownBy.filter((id) => id !== duplicate.id);

      blueprint = APSUSoloBlueprint.validate(blueprint);
    }

    const s = {
      format: 'apsu-solo',
      version: 4,
      scenario: 'generated',
      id: uuid(),
      revision: 0,
      updatedAt: now(),
      blueprint,
      player: { name: name.trim(), description, room: blueprint.start },
      npcs: Object.fromEntries(
        blueprint.characters.map((c) => [
          c.id,
          { room: c.room, following: false, goal: c.goal, memory: '' },
        ]),
      ),
      items: blueprint.items.map((i) => ({ ...i, capacity: i.kind === 'lockpick' ? 100 : 0 })),
      doors: Object.fromEntries(blueprint.rooms.filter((r) => r.locked).map((r) => [r.id, true])),
      activePick: null,
      activeDoor: null,
      messages: [],
      usage: { input: 0, output: 0, calls: 0 },
    };
    note(s, 'Story', blueprint.premise);

    return validate(s);
  }

  const inventory = (s, owner = 'player') =>
    s.items
      .filter((i) => i.owner === owner)
      .map((i) => ({
        ...i,
        kind: i.kind === 'lockpick' ? 'lockpick' : 'custom',
        usableKey: i.kind === 'key',
        consumable: i.kind === 'drink',
        equippable: i.kind === 'weapon',
        detailLabel:
          i.kind === 'drink'
            ? i.servings +
              ' servings left · ' +
              i.servingMl +
              ' ml per serving · ' +
              i.abv +
              '% ABV'
            : '',
        valueLabel: i.valueMinor == null ? 'Value not appraised' : sim.money(s, i.valueMinor),
        abv: i.abv,
        servingMl: i.servingMl,
        appearance: {
          name: i.name,
          description:
            i.description +
            (i.kind === 'drink'
              ? ' · ' + i.servings + ' servings · ' + i.servingMl + ' ml · ' + i.abv + '% ABV'
              : ''),
          icon: globalThis.APSUItems?.iconFor?.(i) || (i.kind === 'lockpick' ? 'tool' : 'box'),
        },
      }));

  function choices(s, id) {
    const n = s.npcs[id];
    check(n);
    if (sim && !sim.conscious(s, id)) return [];
    if (s.sim?.combat)
      return [
        { id: 'none', description: 'Speak only; combat is resolved with encounter controls.' },
        ...sim.helpChoices(s, id),
        ...(s.sim.combat.enemy === id
          ? [
              {
                id: 'stand-down',
                description:
                  'Accept a truce or surrender yourself, ending combat without further damage. Injuries and guarded routes remain.',
              },
            ]
          : []),
      ];

    const out = [
      { id: 'none', description: 'Speak, negotiate or refuse without changing mechanics.' },
    ];

    if (n.room === s.player.room)
      out.push({
        id: n.following ? 'stay' : 'follow',
        description: n.following ? 'Stop following.' : 'Follow the player on future moves.',
      });
    for (const r of roomsFor(s)[n.room].exits)
      if (canMove(s, n.room, r) && (!sim || !sim.blocker(s, n.room, r, id)))
        out.push({ id: 'move:' + r, description: 'Move yourself to ' + roomsFor(s)[r].name + '.' });
    for (const i of s.items) {
      if (
        i.owner === id &&
        n.room === s.player.room &&
        !(
          i.kind === 'lockpick' &&
          i.capacity > 0 &&
          s.items.filter((x) => x.owner === 'player' && x.kind === 'lockpick' && x.capacity > 0)
            .length >= 3
        )
      )
        out.push({ id: 'give:' + i.id, description: 'Give your ' + i.name + ' to the player.' });
      if (i.owner === n.room)
        out.push({ id: 'take:' + i.id, description: 'Pick up ' + i.name + '.' });
    }

    return sim ? [...out, ...sim.choices(s, id)] : out;
  }

  function perform(s, id, action) {
    check(
      choices(s, id).some((a) => a.id === action),
      'That action is no longer available.',
    );
    const n = s.npcs[id],
      name = actors(s).find((a) => a.id === id).name,
      room = n.room;

    if (action === 'none') return;
    if (sim?.perform(s, id, action)) return;
    if (['follow', 'stay'].includes(action)) {
      n.following = action === 'follow';
      note(
        s,
        'Story',
        name + (n.following ? ' begins following you.' : ' stops following you.'),
        room,
      );
    } else if (action.startsWith('move:')) {
      n.room = action.slice(5);
      n.following = false;
      note(s, 'Story', name + ' moves to ' + roomsFor(s)[n.room].name + '.', room);
      s.messages.at(-1).witnesses.push(id);
    } else {
      const item = s.items.find((i) => i.id === action.slice(5));
      item.owner = action.startsWith('give:') ? 'player' : id;
      note(
        s,
        'Story',
        name + (action.startsWith('give:') ? ' gives you ' : ' picks up ') + item.name + '.',
        room,
      );
    }
  }

  function combatSnapshot(s) {
    const copy = structuredClone(s);
    delete copy.combatCheckpoint;
    return copy;
  }

  function act(v, action, value) {
    const s = validate(v);

    if (action === 'void-payment') {
      check(str(value, 1000));
      note(
        s,
        'Story',
        value + ' Message voided; no money changed hands and no character memory was updated.',
      );
      s.messages.at(-1).witnesses = [];
      s.messages.at(-1).voidedTurn = true;

      return validate(s);
    }

    sim?.guard(s, action, value);
    if (action === 'respawn') {
      check(s.sim.people.player.hp === 0, 'You are already alive.');
      check(
        s.combatCheckpoint,
        'This older encounter has no pre-combat save. Restore a manual checkpoint or quit the world.',
      );
      const restored = validate(s.combatCheckpoint);
      // Rewind fiction, never the storage revision or actual provider usage.
      restored.revision = s.revision;
      restored.updatedAt = s.updatedAt;
      restored.usage = { ...s.usage };

      return restored;
    }
    if (action === 'combat' && value?.verb === 'start' && !s.sim.combat)
      s.combatCheckpoint = combatSnapshot(s);
    if (sim?.apply(s, action, value)) return validate(s);
    if (action === 'move') {
      check(!s.activePick, 'Finish the lock first.');
      const to = typeof value === 'object' ? value.room : value;
      check(canMove(s, s.player.room, to), 'That route is unavailable or locked.');
      s.player.room = to;
      for (const n of Object.values(s.npcs)) if (n.following) n.room = to;
      if (!value?.quiet) note(s, 'Story', s.player.name + ' enters ' + roomsFor(s)[to].name + '.');
    } else if (['notice', 'narrate', 'emote'].includes(action)) {
      check(str(value, 200000));
      note(
        s,
        action === 'notice' ? 'Story' : 'Player',
        action === 'emote' ? '/me ' + value : value,
      );
    } else if (action === 'inventory') {
      check(!s.activePick, 'Finish the lock first.');
      const { ids, verb, target } = value;
      check(
        Array.isArray(ids) &&
          ids.length > 0 &&
          ids.length <= 100 &&
          new Set(ids).size === ids.length &&
          ['give', 'show', 'drop', 'delete', 'pickup'].includes(verb),
      );
      if (['give', 'show'].includes(verb))
        check(s.npcs[target]?.room === s.player.room, 'Choose someone in this room.');

      const names = [];

      for (const id of ids) {
        const i = s.items.find((i) => i.id === id);
        check(
          i && i.owner === (verb === 'pickup' ? s.player.room : 'player'),
          'You cannot transfer that item.',
        );
        names.push(i.name);
        if (verb === 'delete') s.items = s.items.filter((x) => x.id !== id);
        else if (verb !== 'show')
          i.owner = verb === 'give' ? target : verb === 'drop' ? s.player.room : 'player';
      }

      note(
        s,
        'Story',
        s.player.name +
          ' ' +
          { give: 'gives', show: 'shows', drop: 'drops', delete: 'deletes', pickup: 'picks up' }[
            verb
          ] +
          ' ' +
          names.join(', ') +
          (['give', 'show'].includes(verb)
            ? ' to ' + actors(s).find((n) => n.id === target).name
            : '') +
          '.',
      );
    } else if (action === 'add-prop') {
      check(
        str(value?.name, 80) &&
          value.name.trim() &&
          str(value.description, 500) &&
          !/lock\s*pick|key/i.test(value.name),
        'Use a tracked script item.',
      );
      s.items.push({
        id: uuid(),
        kind: 'prop',
        name: value.name,
        description: value.description,
        owner: 'player',
        capacity: 0,
      });
      note(s, 'Story', 'Roleplay prop added; it has no scripted powers.');
    } else if (action === 'edit-npc') {
      check(
        s.npcs[value?.id] && str(value.goal, 1000) && value.goal.trim() && str(value.memory, 2500),
      );
      delete s.npcs[value.id].goalCandidate;
      s.npcs[value.id].goal = value.goal;
      s.npcs[value.id].memory = value.memory;
      note(s, 'Story', 'OOC character state updated.');
    } else if (action === 'cancel') {
      if (s.activePick) {
        s.items.find((i) => i.id === s.activePick).capacity = 0;
        s.activePick = null;
        s.activeDoor = null;
        note(s, 'Story', 'The inserted lockpick broke.');
      }
    } else if (['insert', 'damage', 'break', 'unlock'].includes(action)) {
      const { item, room } = value || {};
      check(
        s.doors[room] === true && roomsFor(s)[s.player.room].exits.includes(room),
        'That lock is unavailable.',
      );
      const pick = s.items.find(
        (i) => i.id === item && i.owner === 'player' && i.kind === 'lockpick' && i.capacity > 0,
      );
      check(pick, 'You need a working pick.');
      if (action === 'insert') {
        check(!s.activePick || s.activePick === item);
        s.activePick = item;
        s.activeDoor = room;
      } else {
        check(s.activePick === item && s.activeDoor === room, 'Insert the pick first.');
        if (action === 'damage') pick.capacity = 50;
        else {
          if (action === 'break') {
            pick.capacity = 0;
            note(s, 'Story', 'The lockpick broke.');
          } else {
            s.doors[room] = false;
            s.unlockedBy[room] = 'player';
            note(s, 'Story', s.player.name + ' picked the lock to ' + roomsFor(s)[room].name + '.');
          }

          s.activePick = null;
          s.activeDoor = null;
        }
      }
    } else throw Error('Unknown action.');
    if (s.sim) {
      sim.advance(s);
      for (const [id, person] of Object.entries(s.sim.people))
        if (person.equipped && !s.items.some((i) => i.id === person.equipped && i.owner === id))
          person.equipped = null;
    }

    return validate(s);
  }

  function context(s, text, id, options = {}) {
    const n = s.npcs[id];
    check(
      !sim || (sim.conscious(s, id) && sim.conscious(s, 'player')),
      'Unconscious or dead characters cannot speak.',
    );
    check(
      n &&
        (n.room === s.player.room ||
          (/^\/shout\s/i.test(text) && roomsFor(s)[s.player.room].exits.includes(n.room))),
      'That character cannot hear you.',
    );
    const witnessed = s.messages.filter((m) => m.witnesses.includes(id));
    const payload = {
      scenario: 'generated',
      setting: { title: s.title, premise: s.blueprint.premise, storyMode: s.blueprint.storyMode },
      roles: s.blueprint.roles.filter((r) => r.holder !== 'player'),
      knownCast: s.blueprint.characters.map((c) => ({
        id: c.id,
        name: c.name,
        role: s.blueprint.roles.filter((r) => r.holder === c.id).map((r) => r.name),
        alive: !s.sim || s.sim.people[c.id]?.hp > 0,
      })),
      roleRule:
        'Current role assignments are authoritative and supersede conflicting backstory or old memories. They do not grant keys or change inventory.',
      lore: s.blueprint.lore.filter((l) => l.knownBy.includes('all') || l.knownBy.includes(id)),
      simulation: s.sim
        ? {
            you: s.sim.people[id],
            yourEquipment: {
              weapon: s.items.find((i) => i.id === s.sim.people[id].equipped)?.name || 'Unarmed',
              ownedWeapons: s.items
                .filter((i) => i.owner === id && i.kind === 'weapon')
                .map((i) => i.name),
            },
            player: s.sim.people.player,
            playerEquipment: {
              weapon: s.items.find((i) => i.id === s.sim.people.player.equipped)?.name || 'Unarmed',
            },
            playerDrinkingState: sim.drinkingState(s.sim.people.player.intoxication),
            blocks: s.sim.blocks.filter((b) => b.from === n.room),
            combat: s.sim.combat,
            housing: s.sim.housing,
            currency: s.blueprint.currency,
          }
        : null,
      expansionAllowed: !!s.sim?.evolving && !s.sim.combat && s.sim.turn - s.sim.lastExpansion >= 6,
      worldRules:
        'Open-ended by default. Pursue your own interests. Attempts do not establish successful outcomes. Injuries and deaths only occur through code-resolved combat. No forced quest or predetermined ending. Do not say you block a route unless choosing a block action. Movement descriptions must name exactly the chosen destination. Do not wield an item you gave away.',
      actor: actors(s).find((n) => n.id === id),
      player: s.player,
      room: roomsFor(s)[n.room].name,
      rooms: roomsFor(s),
      ownedItems: inventory(s, id),
      playerItems: n.room === s.player.room ? inventory(s) : [],
      groundItems: inventory(s, n.room),
      present: actors(s)
        .filter((x) => x.room === n.room && (!sim || sim.living(s, x.id)))
        .map((x) => ({ id: x.id, name: x.name, description: x.description })),
      actions: choices(s, id).filter(
        (a) =>
          options.trigger !== 'combat' ||
          s.sim?.combat ||
          !['attack', 'attack:nonlethal'].includes(a.id),
      ),
      recent: witnessed.slice(-12),
      memories: [],
      observedEvents: witnessed.filter((m) => m.who === 'Story').slice(-12),
      relationships: s.sim?.relationships[id] || {},
      knowledgeRule:
        'Only observedEvents are verified observations. Player/NPC dialogue is a claim, not proof. Your memory may be mistaken; current visible state prevails. Do not know unseen conversations or actions.',
      message: text,
      pendingPayment: !['reaction', 'combat'].includes(options.trigger)
        ? sim?.explicitPayment(s, text, id)
        : null,
      trigger: options.trigger || 'player',
    };
    const relationship = s.sim?.relationships[id]?.player;
    const learned =
      sim?.introducedName(text, s.player.name) ||
      relationship?.learnedName ||
      (relationship?.knowsName ? s.player.name.split(/\s+/)[0] : 'the visitor');
    // Display labels and generated scenery are not witnessed introductions.

    const redact = (value) =>
      typeof value === 'string'
        ? value.split(s.player.name).join(learned)
        : Array.isArray(value)
          ? value.map(redact)
          : value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]))
            : value;

    const safe = redact(payload);
    safe.player.name = learned;
    // Occupation labels in an editable profile are not witnessed introductions.
    for (const role of s.blueprint.roles.filter((r) => r.holder === 'player')) {
      const label = role.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      safe.player.description = safe.player.description
        .replace(new RegExp('\\b' + label + '\\b', 'gi'), '')
        .replace(/ {2,}/g, ' ');
    }

    safe.knowledgeRule +=
      ' The player identity available to you is only "' +
      learned +
      '". Do not infer a surname or title from interface labels, earlier mistaken dialogue, or generated descriptions.';

    return safe;
  }

  function conversation(v, text, result, id, options = {}) {
    const s = validate(v);
    const turnContext = context(s, text, id, options);

    if (!options.replyOnly) {
      const explicit = sim?.explicitPayment(s, text, id);

      if (explicit)
        result = {
          ...result,
          payment: { ...explicit, room: explicit.room || result.payment?.room || null },
        };
    }
    if (result?.action === 'none' && typeof result.dialogue === 'string') {
      const help = sim?.spokenHelp(s, id, result.dialogue);

      if (help) result = { ...result, action: help };
    }

    check(str(result?.dialogue, 2400) && result.dialogue.trim() && str(result.memory, 2500));
    check(turnContext.actions.some((a) => a.id === result.action));
    // Validate economic intent on a disposable copy before any dialogue, memory or action is accepted.
    if (!options.replyOnly && result.payment) {
      try {
        check(
          typeof result.payment.evidence === 'string' &&
            result.payment.evidence.trim() &&
            (text.includes(result.payment.evidence) ||
              turnContext.message.includes(result.payment.evidence)),
          'Payment must reference the actual player message.',
        );
        sim.playerPayment(structuredClone(s), result.payment);
      } catch (error) {
        note(
          s,
          'Story',
          error.message +
            ' Message voided; no money changed hands and no character memory was updated.',
        );
        s.messages.at(-1).witnesses = [];
        s.messages.at(-1).voidedTurn = true;
        for (const k of ['input', 'output'])
          s.usage[k] +=
            Number.isSafeInteger(result.usage?.[k]) && result.usage[k] >= 0 ? result.usage[k] : 0;

        s.usage.calls++;

        return validate(s);
      }
    }
    // Capture before the NPC reply, memory changes, or any attack-triggering speech.
    if (['attack', 'attack:nonlethal'].includes(result.action) && !s.sim.combat)
      s.combatCheckpoint = combatSnapshot(s);

    const privateTo = /^\/(w|whisper)\s/i.test(text) ? id : null;

    if (!options.replyOnly) {
      note(s, 'Player', text, s.player.room, privateTo);
      s.messages.at(-1).witnesses = [...new Set([...s.messages.at(-1).witnesses, id])];
    }
    if (!options.replyOnly && result.payment) sim.playerPayment(s, result.payment);

    note(s, actors(s).find((n) => n.id === id).name, result.dialogue, s.npcs[id].room, privateTo);
    s.messages.at(-1).witnesses = [...new Set([...s.messages.at(-1).witnesses, id])];
    for (const appraisal of Array.isArray(result.itemValues) ? result.itemValues.slice(0, 8) : []) {
      const item = s.items.find(
        (i) => i.id === appraisal.id && i.owner === id && i.valueMinor == null,
      );

      if (
        item &&
        Number.isSafeInteger(appraisal.valueMinor) &&
        appraisal.valueMinor >= 0 &&
        appraisal.valueMinor <= 1e12
      )
        item.valueMinor = appraisal.valueMinor;
    }

    sim?.recordExchange(
      s,
      id,
      text,
      result,
      options.trigger === 'reaction' || options.trigger === 'combat',
    );
    if (result.rentalOffer && !options.replyOnly) {
      try {
        sim.offerRental(s, id, {
          room: result.rentalOffer.room,
          price: result.rentalOffer.priceMinor,
        });
      } catch (error) {
        note(s, 'Story', 'Rental offer was not registered: ' + error.message);
      }
    }

    perform(s, id, result.action);
    s.npcs[id].memory = result.memory;
    const actorState = s.npcs[id],
      proposal = result.goalReflection,
      turn = s.sim?.turn || 0;

    if (actorState.goalCandidate && turn - actorState.goalCandidate.startedAt > 12)
      delete actorState.goalCandidate;
    if (
      proposal &&
      str(proposal.goal, 1000) &&
      proposal.goal.trim() &&
      str(proposal.reason, 600) &&
      proposal.reason.trim().length >= 20 &&
      proposal.goal.trim() !== actorState.goal
    ) {
      const goal = proposal.goal.trim(),
        reason = proposal.reason.trim();
      const candidate = actorState.goalCandidate;
      actorState.goalCandidate =
        candidate?.goal === goal
          ? { ...candidate, count: Math.min(100, candidate.count + 1), reason }
          : { goal, reason, count: 1, startedAt: turn };
      const next = actorState.goalCandidate;

      if (
        next.count >= 3 &&
        turn - next.startedAt >= 4 &&
        turn - (actorState.goalHistory.at(-1)?.turn ?? -8) >= 8
      ) {
        actorState.goalHistory.push({
          from: actorState.goal,
          to: next.goal,
          reason: next.reason,
          turn,
        });
        actorState.goalHistory = actorState.goalHistory.slice(-3);
        actorState.goal = next.goal;
        delete actorState.goalCandidate;
      }
    }
    for (const k of ['input', 'output'])
      s.usage[k] +=
        Number.isSafeInteger(result.usage?.[k]) && result.usage[k] >= 0 ? result.usage[k] : 0;

    s.usage.calls++;
    if (s.sim) {
      sim.advance(s);
      for (const [who, p] of Object.entries(s.sim.people))
        if (p.equipped && !s.items.some((i) => i.id === p.equipped && i.owner === who))
          p.equipped = null;
    }

    return validate(s);
  }

  globalThis.APSUSoloEngine = {
    ...prior,
    createGenerated: create,
    mapFor: (s, whole = false) =>
      s.scenario === 'generated' && sim ? sim.map(s, whole) : prior.roomsFor(s),
    roomsFor: (s) => (s?.scenario === 'generated' ? roomsFor(s) : prior.roomsFor(s)),
    actors: (s) => (s?.scenario === 'generated' ? actors(s) : prior.actors(s)),
    choices: (s, ...a) => (s.scenario === 'generated' ? choices(s, ...a) : prior.choices(s, ...a)),
    validate: (s) => (s?.scenario === 'generated' ? validate(s) : prior.validate(s)),
    act: (s, ...a) => (s.scenario === 'generated' ? act(s, ...a) : prior.act(s, ...a)),
    inventory: (s, ...a) =>
      s.scenario === 'generated' ? inventory(s, ...a) : prior.inventory(s, ...a),
    context: (s, ...a) => (s.scenario === 'generated' ? context(s, ...a) : prior.context(s, ...a)),
    conversation: (s, ...a) =>
      s.scenario === 'generated' ? conversation(s, ...a) : prior.conversation(s, ...a),
  };
})();
