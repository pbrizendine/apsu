// Deterministic local rules. AI proposes choices; this module owns their consequences.
(() => {
  const weapons = {
    fists: { name: 'Unarmed', damage: 3, bonus: 0 },
    blade: { name: 'Blade', damage: 6, bonus: 2 },
    blunt: { name: 'Blunt weapon', damage: 5, bonus: 1 },
    pistol: { name: 'Handgun', damage: 8, bonus: 2 },
    rifle: { name: 'Long gun', damage: 10, bonus: 1 },
    bow: { name: 'Bow', damage: 7, bonus: 1 },
  };

  const ok = (v, m = 'Invalid simulation state.') => {
    if (!v) throw Error(m);
  };

  const living = (s, id) => s.sim.people[id]?.hp > 0;

  const conscious = (s, id) => living(s, id) && !s.sim.people[id]?.knockedOutUntil;

  const personName = (s, id) =>
    id === 'player' ? s.player.name : s.blueprint.characters.find((c) => c.id === id)?.name;

  const room = (s, id) => (id === 'player' ? s.player.room : s.npcs[id]?.room);

  function note(s, text, where = s.player.room) {
    s.messages.push({
      id: crypto.randomUUID(),
      who: 'Story',
      text,
      at: new Date().toISOString(),
      room: where,
      witnesses: Object.keys(s.npcs).filter((id) => room(s, id) === where),
    });
  }

  function readyWeapon(s, id) {
    // Choose only an owned weapon at combat start, never create gear from prose.
    if (!s.sim.people[id].equipped)
      s.sim.people[id].equipped =
        s.items.find((i) => i.owner === id && i.kind === 'weapon')?.id || null;
  }

  function normalize(v, s) {
    const ids = ['player', ...Object.keys(s.npcs)],
      old = v.sim;
    const sim = {
      people: {},
      relationships: {},
      occupationsInitialized: true,
      blocks: [],
      combat: null,
      turn: old?.turn || 0,
      lastExpansion: old?.lastExpansion ?? -10,
      evolving: old?.evolving !== false,
      seed: old?.seed ?? (crypto.getRandomValues(new Uint32Array(1))[0] || 1),
    };
    ok(
      Number.isSafeInteger(sim.turn) &&
        sim.turn >= 0 &&
        Number.isSafeInteger(sim.lastExpansion) &&
        Number.isInteger(sim.seed) &&
        sim.seed >= 0 &&
        sim.seed <= 4294967295,
    );
    for (const id of ids) {
      const p = old?.people?.[id] || {
        hp: 20,
        maxHp: 20,
        money: 20 * 10 ** s.blueprint.currency.decimals,
        equipped: null,
      };
      ok(
        Number.isInteger(p.maxHp) &&
          p.maxHp >= 1 &&
          p.maxHp <= 500 &&
          Number.isInteger(p.hp) &&
          p.hp >= 0 &&
          p.hp <= p.maxHp &&
          Number.isSafeInteger(p.money) &&
          p.money >= 0 &&
          p.money <= 1e12,
      );
      ok(
        p.equipped === null ||
          s.items.some((i) => i.id === p.equipped && i.kind === 'weapon' && i.owner === id),
        'Equipped weapon is not owned.',
      );
      ok(
        Number.isFinite(p.intoxication ?? 0) &&
          (p.intoxication ?? 0) >= 0 &&
          (p.intoxication ?? 0) <= 1000,
        'Invalid intoxication.',
      );
      sim.people[id] = {
        hp: p.hp,
        maxHp: p.maxHp,
        money: p.money,
        equipped: p.equipped,
        intoxication: p.intoxication ?? 0,
        knockedOutUntil: p.knockedOutUntil ?? 0,
      };
      ok(
        Number.isSafeInteger(sim.people[id].knockedOutUntil) &&
          sim.people[id].knockedOutUntil >= 0 &&
          (!sim.people[id].knockedOutUntil || p.hp > 0),
        'Invalid knockout state.',
      );
      if (id !== 'player' && p.hp === 0) s.npcs[id].following = false;
    }

    sim.housing = {};
    for (const [roomId, h] of Object.entries(old?.housing || {})) {
      ok(
        s.blueprint.rooms.some((r) => r.id === roomId && r.locked) &&
          h &&
          ids.includes(h.landlord) &&
          h.landlord !== 'player' &&
          Number.isSafeInteger(h.price) &&
          h.price > 0 &&
          h.price <= 1e12 &&
          [null, 'player'].includes(h.tenant),
        'Invalid rental record.',
      );
      sim.housing[roomId] = { landlord: h.landlord, price: h.price, tenant: h.tenant };
    }
    for (const source of ids) {
      sim.relationships[source] = {};
      for (const [target, r] of Object.entries(old?.relationships?.[source] || {})) {
        ok(
          ids.includes(target) &&
            source !== target &&
            r &&
            typeof r.met === 'boolean' &&
            typeof r.knowsName === 'boolean' &&
            typeof r.romance === 'boolean' &&
            ['trust', 'affection'].every(
              (k) => Number.isInteger(r[k]) && r[k] >= -100 && r[k] <= 100,
            ) &&
            typeof r.feelings === 'string' &&
            r.feelings.length <= 500,
          'Invalid relationship.',
        );
        sim.relationships[source][target] = {
          met: r.met,
          knowsName: r.knowsName,
          learnedName: typeof r.learnedName === 'string' ? r.learnedName.slice(0, 80) : '',
          romance: r.romance,
          trust: r.trust,
          affection: r.affection,
          feelings: r.feelings,
        };
      }
    }
    for (const b of old?.blocks || []) {
      ok(
        ids.includes(b.actor) &&
          b.actor !== 'player' &&
          s.blueprint.rooms.some((r) => r.id === b.from && r.exits.includes(b.to)),
        'Invalid blocked route.',
      );
      if (
        sim.people[b.actor].hp > 0 &&
        !sim.people[b.actor].knockedOutUntil &&
        room(s, b.actor) === b.from
      )
        sim.blocks.push({ actor: b.actor, from: b.from, to: b.to });
    }
    if (old?.combat) {
      const c = old.combat;
      ok(
        ids.includes(c.enemy) && c.enemy !== 'player' && Number.isInteger(c.round) && c.round >= 1,
      );
      if (
        sim.people.player.hp > 0 &&
        !sim.people.player.knockedOutUntil &&
        sim.people[c.enemy].hp > 0 &&
        !sim.people[c.enemy].knockedOutUntil &&
        room(s, c.enemy) === s.player.room
      )
        sim.combat = {
          enemy: c.enemy,
          round: c.round,
          phase: c.phase === 'enemy' ? 'enemy' : 'player',
          defending: c.defending === true,
          playerIntent: c.playerIntent === 'nonlethal' ? 'nonlethal' : 'lethal',
          enemyIntent: c.enemyIntent === 'nonlethal' ? 'nonlethal' : 'lethal',
        };
      if (sim.combat && c.assistance) {
        ok(
          Object.keys(s.npcs).includes(c.assistance.actor) &&
            c.assistance.requestedBy === c.enemy &&
            c.assistance.actor !== c.enemy,
          'Invalid assistance.',
        );
        sim.combat.assistance = {
          actor: c.assistance.actor,
          requestedBy: c.assistance.requestedBy,
        };
      }
    }
    if (!old?.occupationsInitialized) {
      for (const c of s.blueprint.characters) {
        if (s.blueprint.roles.some((r) => r.holder === c.id)) continue;

        const premise = s.blueprint.premise;
        const at = premise.indexOf(c.name);
        const own = [
          c.description,
          c.personality,
          at >= 0 ? premise.slice(at, at + 140).split(/[.!?]/)[0] : '',
        ].join(' ');
        const title = /\bco[- ]owner\b/i.test(own)
          ? 'Co-owner'
          : /\bbartender\b/i.test(own)
            ? 'Bartender'
            : null;

        if (!title) continue;

        const location = s.blueprint.rooms.find((r) => r.id === c.room);
        const building = APSUSoloBlueprint.buildingFor(s.blueprint, location.zone);
        let roleName = title;

        if (s.blueprint.roles.some((r) => r.name.toLowerCase() === roleName.toLowerCase()))
          roleName += ' · ' + c.name;

        s.blueprint.roles.push({
          name: roleName.slice(0, 80),
          holder: c.id,
          room: c.room,
          scope: (building?.name || s.title).slice(0, 80),
        });
      }
    }

    s.sim = sim;
    if (!old) ensureKeys(s, s.blueprint.rooms);

    return s;
  }

  function relationship(s, source, target) {
    s.sim.relationships[source] ||= {};
    return (s.sim.relationships[source][target] ||= {
      met: false,
      knowsName: false,
      romance: false,
      trust: 0,
      affection: 0,
      feelings: '',
    });
  }

  function introducedName(speech, name) {
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const candidates = [...new Set([name, name.split(/\s+/)[0]])];
    return (
      candidates.find((candidate) =>
        new RegExp(
          "(?:i'm |i am |my name is |call me )" + escape(candidate) + '(?=$|[\\s.,!?;:])',
          'i',
        ).test(speech),
      ) || ''
    );
  }

  function recordExchange(s, actor, text, result, reaction = false) {
    const witnesses = s.messages.at(-1)?.witnesses || [];
    const present = ['player', ...Object.keys(s.npcs)].filter(
      (id) =>
        (id === 'player' || witnesses.includes(id)) &&
        room(s, id) === room(s, actor) &&
        living(s, id),
    );
    // Witnessing speech establishes acquaintance, not private thoughts or mutual friendship.

    for (const id of present)
      if (id !== actor) {
        relationship(s, id, actor).met = true;
        if (!reaction && id === 'player') relationship(s, actor, id).met = true;
      }

    const learned = !reaction && introducedName(text, s.player.name);

    if (learned)
      for (const observer of present.filter((id) => id !== 'player')) {
        const r = relationship(s, observer, 'player');
        r.knowsName = true;
        if (!r.learnedName || learned.length > r.learnedName.length) r.learnedName = learned;
      }
    if (introducedName(result.dialogue, personName(s, actor)))
      for (const id of present) if (id !== actor) relationship(s, id, actor).knowsName = true;

    const seen = new Set();

    for (const update of (Array.isArray(result.relationshipUpdates)
      ? result.relationshipUpdates
      : []
    ).slice(0, 3)) {
      if (
        !present.includes(update?.target) ||
        update.target === actor ||
        seen.has(update.target) ||
        typeof update.feelings !== 'string' ||
        update.feelings.length > 500 ||
        !['trustDelta', 'affectionDelta'].every(
          (k) => Number.isInteger(update[k]) && Math.abs(update[k]) <= 5,
        )
      )
        continue;

      seen.add(update.target);
      const r = relationship(s, actor, update.target);
      r.trust = Math.max(-100, Math.min(100, r.trust + update.trustDelta));
      r.affection = Math.max(-100, Math.min(100, r.affection + update.affectionDelta));
      r.feelings = update.feelings;
    }
  }

  function blocker(s, from, to, actor = 'player') {
    return s.sim.blocks.find(
      (b) =>
        b.from === from &&
        b.to === to &&
        b.actor !== actor &&
        conscious(s, b.actor) &&
        room(s, b.actor) === from,
    );
  }

  function guard(s, action, value) {
    if (
      ['edit-world', 'expand-world', 'expansion-attempt', 'setting', 'notice', 'respawn'].includes(
        action,
      )
    )
      return;

    ok(
      living(s, 'player'),
      'Your character has died. This save remains available to inspect or branch from an earlier checkpoint.',
    );
    if (action !== 'recover')
      ok(conscious(s, 'player'), 'You are unconscious. Recover before acting.');
    if (action === 'move') {
      ok(!s.sim.combat, 'Disengage before leaving combat.');
      const to = typeof value === 'object' ? value.room : value;
      const block = blocker(s, s.player.room, to);
      ok(
        !block,
        personName(s, block?.actor) + ' is blocking this route. Negotiate or confront them.',
      );
    }
    if (['insert', 'unlock', 'damage', 'break', 'key-door'].includes(action)) {
      const b = blocker(s, s.player.room, value?.room);
      ok(
        !b,
        personName(s, b?.actor) + ' is guarding that entrance. Resolve the obstruction first.',
      );
    }
    if (s.sim.combat)
      ok(
        ['combat', 'notice', 'cancel', 'equip'].includes(action),
        'Resolve your combat turn first.',
      );
  }

  function roll(s, n) {
    let x = s.sim.seed || 1;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    s.sim.seed = x >>> 0;

    return 1 + (s.sim.seed % n);
  }

  function strike(s, actor, target, defending = false) {
    const p = s.sim.people[actor],
      t = s.sim.people[target];
    const nonlethal =
      (actor === 'player' ? s.sim.combat?.playerIntent : s.sim.combat?.enemyIntent) === 'nonlethal';
    const item = nonlethal
      ? null
      : s.items.find((i) => i.id === p.equipped && i.owner === actor) ||
        (actor !== 'player' ? s.items.find((i) => i.kind === 'weapon' && i.owner === actor) : null);
    const w = nonlethal ? { damage: 6, bonus: 1 } : weapons[item?.template] || weapons.fists;
    const dice = roll(s, 20);
    const hit = dice + w.bonus >= (defending ? 15 : 9);
    const damage = hit ? 2 + roll(s, w.damage) : 0;
    t.hp = Math.max(0, t.hp - damage);
    note(
      s,
      personName(s, actor) +
        (hit
          ? ' hits ' + personName(s, target) + ' for ' + damage + ' damage.'
          : ' misses ' + personName(s, target) + '.') +
        ' [' +
        (nonlethal ? 'Unarmed · non-lethal' : item?.name || 'Unarmed') +
        ' · roll ' +
        dice +
        ' + ' +
        w.bonus +
        ']',
    );
    if (!t.hp) {
      if (nonlethal) {
        t.hp = 1;
        t.knockedOutUntil = s.sim.turn + 4;
        if (target !== 'player') s.npcs[target].following = false;

        s.sim.blocks = s.sim.blocks.filter((b) => b.actor !== target);
        s.sim.combat = null;
        note(
          s,
          personName(s, target) +
            ' is knocked unconscious, but survives. Their possessions remain with them.',
        );

        return;
      }

      note(s, personName(s, target) + ' dies.');
      if (target !== 'player') {
        s.npcs[target].following = false;
        for (const i of s.items) if (i.owner === target) i.owner = room(s, target);

        s.sim.people[target].equipped = null;
      }

      s.sim.blocks = s.sim.blocks.filter((b) => b.actor !== target);
      s.sim.combat = null;
    }
  }
  // Supply keys once when doors are introduced, never regenerate a deleted key on reload.

  function ensureKeys(s, rooms) {
    for (const r of rooms.filter((r) => r.locked)) {
      if (!s.items.some((i) => i.kind === 'key' && i.opens === r.id)) {
        const holder =
          s.blueprint.characters.find((c) => c.room === r.exits[0]) || s.blueprint.characters[0];
        s.items.push({
          id: crypto.randomUUID(),
          kind: 'key',
          owner: holder.id,
          name: r.name + ' key',
          description: 'Opens ' + r.name + '.',
          opens: r.id,
          capacity: 0,
          valueMinor: null,
        });
      }
    }
  }

  function helpRoute(s, helper, destination) {
    const paths = [[room(s, helper)]],
      seen = new Set(paths[0]);

    for (const path of paths) {
      const here = path.at(-1);

      if (here === destination) return path;
      if (path.length > 2) continue;
      for (const next of s.blueprint.rooms.find((r) => r.id === here).exits) {
        if (seen.has(next) || s.doors[next] || blocker(s, here, next, helper)) continue;

        seen.add(next);
        paths.push([...path, next]);
      }
    }

    return null;
  }

  function helpChoices(s, id) {
    if (!s.sim.combat || s.sim.combat.enemy !== id || s.sim.combat.assistance) return [];

    return s.blueprint.characters
      .filter((c) => c.id !== id && conscious(s, c.id) && helpRoute(s, c.id, room(s, id)))
      .map((c) => ({
        id: 'call-help:' + c.id,
        description:
          'Call ' +
          c.name +
          ' for help. They can hear within two open passages, approach through real exits, and intervene to protect you. Choose only someone who would plausibly help.',
      }));
  }

  function spokenHelp(s, id, text) {
    if (
      /\b(?:would|could|might|not|don't|doesn't)\b[^.!?]{0,60}\b(?:call|shout|yell|scream)/i.test(
        text,
      )
    )
      return null;

    const matches = helpChoices(s, id).filter((choice) => {
      const helper = s.blueprint.characters.find((c) => c.id === choice.id.slice(10));
      const names = [helper.name, helper.name.split(' ')[0]]
        .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      return (
        new RegExp(
          '\\b(?:calls?|shouts?|yells?|screams?)\\s+(?:out\\s+)?(?:for|to)\\s+(?:' + names + ')\\b',
          'i',
        ).test(text) ||
        new RegExp(
          '\\b(?:' + names + ')[!,][^.!?]{0,80}\\b(?:help|come|get|need|security)\\b',
          'i',
        ).test(text)
      );
    });
    return matches.length === 1 ? matches[0].id : null;
  }

  function advanceHelp(s) {
    const combat = s.sim.combat,
      help = combat?.assistance;

    if (!help) return;

    const path = conscious(s, help.actor) && helpRoute(s, help.actor, s.player.room);

    if (!path) {
      note(s, 'The requested help cannot reach this encounter.');
      delete combat.assistance;
      return;
    }
    if (path.length > 1) {
      s.npcs[help.actor].room = path[1];
      note(s, personName(s, help.actor) + ' moves toward the call for help.', path[1]);
    }
    if (room(s, help.actor) === s.player.room) {
      const previous = combat.enemy;
      combat.enemy = help.actor;
      readyWeapon(s, help.actor);
      delete combat.assistance;
      note(
        s,
        personName(s, help.actor) +
          ' intervenes to protect ' +
          personName(s, previous) +
          '. You now face ' +
          personName(s, help.actor) +
          '.',
      );
    }
  }

  function choices(s, id) {
    if (!conscious(s, id)) return [];

    const out = [];
    const n = s.npcs[id];

    if (!s.sim.combat) {
      if (n.room === s.player.room && living(s, 'player'))
        s.blueprint.roles.forEach((role, index) => {
          if (role.holder === id)
            out.push({
              id: 'role-handover:' + index,
              description:
                'Voluntarily hand your role "' +
                role.name +
                '" to the player ONLY after an explicit mutual agreement. This changes the title, not keys, money, permissions or items.',
            });
        });
      for (const to of s.blueprint.rooms.find((r) => r.id === n.room).exits) {
        out.push({
          id: 'block:' + to,
          description:
            'Physically block the route to ' +
            s.blueprint.rooms.find((r) => r.id === to).name +
            '. Travelers must negotiate or confront you.',
        });
        if (s.items.some((i) => i.owner === id && i.kind === 'key' && i.opens === to))
          out.push({
            id: 'key:' + to,
            description: 'Use your key to ' + (s.doors[to] ? 'unlock' : 'lock') + ' the entrance.',
          });
      }
      if (
        s.blueprint.rooms.find((r) => r.id === n.room).locked &&
        s.items.some((i) => i.owner === id && i.kind === 'key' && i.opens === n.room)
      )
        out.push({
          id: 'key:' + n.room,
          description:
            'Use your key from inside to ' +
            (s.doors[n.room] ? 'unlock' : 'lock') +
            ' this entrance.',
        });
      if (s.sim.blocks.some((b) => b.actor === id))
        out.push({ id: 'unblock', description: 'Step aside and stop blocking passage.' });
      if (n.room === s.player.room && s.sim.people[id].money > 0) {
        const amount = Math.min(s.sim.people[id].money, 10 ** s.blueprint.currency.decimals);
        out.push({
          id: 'pay:' + amount,
          description: 'Pay the player ' + money(s, amount) + ' from your own funds.',
        });
      }
      if (n.room === s.player.room && conscious(s, 'player')) {
        out.push({
          id: 'attack:nonlethal',
          description:
            'Initiate a non-lethal unarmed fight to restrain or subdue the player. Only when justified by your motives and witnessed events; no injury occurs until the combat turn resolves.',
        });
        out.push({
          id: 'attack',
          description:
            'Initiate a lethal fight using your actual weapon. Reserve lethal force for a serious threat or a clearly established violent motive. Damage is resolved by code.',
        });
      }
    }

    return out;
  }

  function perform(s, id, action) {
    const n = s.npcs[id];

    if (action.startsWith('role-handover:')) {
      const index = Number(action.slice('role-handover:'.length));
      const role = s.blueprint.roles[index];
      ok(
        Number.isInteger(index) &&
          role?.holder === id &&
          n.room === s.player.room &&
          !s.sim.combat &&
          living(s, id) &&
          living(s, 'player'),
        'This role cannot be handed over.',
      );
      role.holder = 'player';
      note(
        s,
        personName(s, id) + ' hands the role of ' + role.name + ' to ' + s.player.name + '.',
        n.room,
      );

      return true;
    }
    if (action.startsWith('pay:')) {
      const amount = Number(action.slice(4));
      ok(
        Number.isSafeInteger(amount) &&
          amount > 0 &&
          amount <= s.sim.people[id].money &&
          n.room === s.player.room,
      );
      s.sim.people[id].money -= amount;
      s.sim.people.player.money += amount;
      note(s, personName(s, id) + ' pays ' + s.player.name + ' ' + money(s, amount) + '.');

      return true;
    }
    if (action.startsWith('block:')) {
      s.sim.blocks = s.sim.blocks.filter((b) => b.actor !== id);
      s.sim.blocks.push({ actor: id, from: n.room, to: action.slice(6) });
      note(
        s,
        personName(s, id) +
          ' blocks the route to ' +
          s.blueprint.rooms.find((r) => r.id === action.slice(6)).name +
          '.',
        n.room,
      );

      return true;
    }
    if (action === 'unblock') {
      s.sim.blocks = s.sim.blocks.filter((b) => b.actor !== id);
      note(s, personName(s, id) + ' steps aside.', n.room);
      return true;
    }
    if (action.startsWith('key:')) {
      const to = action.slice(4);
      s.doors[to] = !s.doors[to];
      if (!s.doors[to]) s.unlockedBy[to] = id;

      note(
        s,
        personName(s, id) +
          (s.doors[to] ? ' locks ' : ' unlocks ') +
          s.blueprint.rooms.find((r) => r.id === to).name +
          '.',
        n.room,
      );

      return true;
    }
    if (action.startsWith('call-help:')) {
      const helper = action.slice(10);
      ok(
        helpChoices(s, id).some((a) => a.id === action),
        'That character cannot respond to this call.',
      );
      s.sim.combat.assistance = { actor: helper, requestedBy: id };
      note(s, personName(s, id) + ' calls ' + personName(s, helper) + ' for help.');
      s.messages.at(-1).witnesses.push(helper);
      advanceHelp(s);

      return true;
    }
    if (action === 'stand-down') {
      ok(s.sim.combat?.enemy === id, 'Only the opponent can end this encounter.');
      s.sim.combat = null;
      note(s, personName(s, id) + ' stands down. Combat ends; injuries and guarded routes remain.');

      return true;
    }
    if (action === 'attack' || action === 'attack:nonlethal') {
      readyWeapon(s, id);
      const intent = action === 'attack:nonlethal' ? 'nonlethal' : 'lethal';
      s.sim.combat = { enemy: id, round: 1, playerIntent: intent, enemyIntent: intent };
      note(
        s,
        personName(s, id) +
          ' initiates ' +
          (intent === 'nonlethal' ? 'a non-lethal' : 'a lethal') +
          ' fight with ' +
          s.player.name +
          '. You may respond or surrender before the first blow.',
      );
      s.sim.combat.phase = 'enemy';

      return true;
    }

    return false;
  }

  function offerRental(s, actor, value, editing = false) {
    const r = s.blueprint.rooms.find((r) => r.id === value?.room);
    ok(r && s.npcs[actor], 'Choose an existing room and landlord.');
    const existing = s.sim.housing[r.id];
    ok(!existing?.tenant, 'This room is already rented.');
    ok(
      editing ||
        (existing
          ? existing.landlord === actor
          : s.items.some((i) => i.owner === actor && i.kind === 'key' && i.opens === r.id)),
      'This character has no authority to rent that room.',
    );
    ok(
      Number.isSafeInteger(value.price) && value.price > 0 && value.price <= 1e12,
      'Choose a positive rental price.',
    );
    if (!r.locked) {
      r.locked = true;
      s.doors[r.id] = true;
    }

    s.sim.housing[r.id] = { landlord: actor, price: value.price, tenant: null };
    if (!s.items.some((i) => i.owner === actor && i.kind === 'key' && i.opens === r.id))
      s.items.push({
        id: crypto.randomUUID(),
        kind: 'key',
        owner: actor,
        name: (r.name + ' landlord key').slice(0, 80),
        description: 'Key held by the recorded landlord.',
        opens: r.id,
        capacity: 0,
      });
  }
  // A conservative local path for explicit payment actions. Broader phrasing still uses structured intent.

  function explicitPayment(s, text, addressed) {
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const names = [s.player.name, s.player.name.split(' ')[0], 'I'];
    const source = '(?:' + names.map(escape).join('|') + ')';
    const currency = s.blueprint.currency;
    const units = [
      currency.name,
      currency.symbol,
      ...(currency.symbol === 'USD' ? ['dollars?', 'bucks?'] : []),
    ]
      .map((x) => (x === 'dollars?' || x === 'bucks?' ? x : escape(x)))
      .join('|');
    const amount =
      '(?:\\$\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s*(?:' +
      units +
      ')\\b)';
    const hits = [];

    for (const c of s.blueprint.characters) {
      const target =
        '(?:' +
        [c.name, c.name.split(' ')[0], ...(c.id === addressed ? ['you'] : [])]
          .map(escape)
          .join('|') +
        ')';
      const pattern = new RegExp(
        '(?:^|[.!*\\n]\\s*)(?:' +
          source +
          '\\s+|/me\\s+)(?:gives?|hands?|pays?|tips?)\\s+' +
          target +
          '\\s+' +
          amount,
        'gi',
      );

      for (const match of text.matchAll(pattern)) {
        if (/[?]/.test(text.slice(match.index).split(/[.!\n]/)[0])) continue;

        const major = Number((match[1] || match[2]).replaceAll(',', ''));

        if (match[1] && currency.symbol !== 'USD') continue;

        hits.push({
          recipient: c.id,
          amountMinor: Math.round(major * 10 ** currency.decimals),
          room: null,
          evidence: match[0].trim(),
        });
      }
    }
    if (hits.length !== 1) return null;

    const payment = hits[0];
    const rentals = Object.entries(s.sim.housing || {}).filter(
      ([id, h]) =>
        h.landlord === payment.recipient &&
        text.toLowerCase().includes(s.blueprint.rooms.find((r) => r.id === id).name.toLowerCase()),
    );

    if (rentals.length === 1 && /\b(rent|room|stay|check[ -]?in)\b/i.test(text))
      payment.room = rentals[0][0];

    return payment;
  }

  function playerPayment(s, value) {
    ok(
      value && Number.isSafeInteger(value.amountMinor) && value.amountMinor > 0,
      'Payment needs an exact positive amount.',
    );
    const target = value.recipient;
    ok(
      s.npcs[target] && conscious(s, target) && room(s, target) === s.player.room,
      'The recipient must be here and conscious.',
    );
    ok(
      !s.sim.combat && !s.activePick && conscious(s, 'player'),
      'Finish the current encounter before paying.',
    );
    ok(
      value.amountMinor <= s.sim.people.player.money,
      'Powergaming: payment exceeds your available money.',
    );
    ok(s.sim.people[target].money + value.amountMinor <= 1e12, 'Recipient balance limit reached.');
    let rental;

    if (value.room) {
      rental = s.sim.housing[value.room];
      ok(
        rental && !rental.tenant && rental.landlord === target,
        'No available rental offer from this landlord for that room.',
      );
      ok(rental.price === value.amountMinor, 'Payment must match the agreed rental price.');
    }

    s.sim.people.player.money -= value.amountMinor;
    s.sim.people[target].money += value.amountMinor;
    note(
      s,
      s.player.name + ' pays ' + personName(s, target) + ' ' + money(s, value.amountMinor) + '.',
    );
    if (rental) {
      rental.tenant = 'player';
      const r = s.blueprint.rooms.find((r) => r.id === value.room);

      if (!s.items.some((i) => i.owner === 'player' && i.kind === 'key' && i.opens === r.id))
        s.items.push({
          id: crypto.randomUUID(),
          kind: 'key',
          owner: 'player',
          name: (r.name + ' rental key').slice(0, 80),
          description: 'Issued with your paid tenancy.',
          opens: r.id,
          capacity: 0,
        });

      note(
        s,
        s.player.name +
          ' rents ' +
          r.name +
          '. This is now your home for this stay; its key is in your inventory.',
      );
    }
  }

  function apply(s, action, v) {
    if (action === 'rental-offer') {
      offerRental(s, v.landlord, { room: v.room, price: v.price }, true);
      note(
        s,
        'Rental configured: ' +
          s.blueprint.rooms.find((r) => r.id === v.room).name +
          ' — ' +
          money(s, v.price) +
          ' per stay.',
      );
      return true;
    }
    if (action === 'rent') {
      const h = s.sim.housing[v?.room];
      ok(h, 'Choose a rental offer.');
      playerPayment(s, { recipient: h.landlord, amountMinor: h.price, room: v.room });

      return true;
    }

    if (action === 'recover') {
      ok(!s.sim.combat && s.sim.people.player.knockedOutUntil, 'You are not unconscious.');
      s.sim.turn = Math.max(s.sim.turn, s.sim.people.player.knockedOutUntil);
      wake(s);

      return true;
    }
    if (action === 'relationship') {
      ok(
        s.sim.people[v?.source] && s.sim.people[v?.target] && v.source !== v.target,
        'Choose two characters.',
      );
      s.sim.relationships[v.source][v.target] = {
        met: v.met === true,
        knowsName: v.knowsName === true,
        romance: v.romance === true,
        trust: Number(v.trust),
        affection: Number(v.affection),
        feelings: String(v.feelings || ''),
      };
      return true;
    }
    if (action === 'expansion-attempt') {
      s.sim.lastExpansion = s.sim.turn;
      return true;
    }
    if (action === 'setting') {
      s.sim.evolving = v === true;
      return true;
    }
    if (action === 'consume') {
      const item = s.items.find((i) => i.id === v && i.owner === 'player' && i.kind === 'drink');
      ok(item, 'Choose a drink you own.');
      ok(!s.activePick, 'Finish lockpicking first.');
      if ((item.servings ?? 1) > 1) item.servings--;
      else s.items = s.items.filter((i) => i.id !== item.id);

      s.sim.people.player.intoxication = Math.min(
        1000,
        s.sim.people.player.intoxication + (item.servingMl * item.abv) / 100 / 20,
      );
      note(s, s.player.name + ' drinks ' + item.name + '.');

      return true;
    }
    if (action === 'equip') {
      const i = s.items.find((i) => i.id === v && i.owner === 'player' && i.kind === 'weapon');
      ok(i, 'Choose a weapon you own.');
      s.sim.people.player.equipped = i.id;
      note(s, s.player.name + ' equips ' + i.name + '.');

      return true;
    }
    if (action === 'pay') {
      playerPayment(s, { recipient: v?.target, amountMinor: v?.amount, room: null });
      return true;
    }
    if (action === 'key-door') {
      const r = s.blueprint.rooms.find((r) => r.id === v?.room);
      ok(
        r?.locked && (r.exits.includes(s.player.room) || r.id === s.player.room),
        'Choose an adjacent door.',
      );
      ok(
        s.items.some((i) => i.owner === 'player' && i.kind === 'key' && i.opens === r.id),
        'You need the matching key.',
      );
      s.doors[r.id] = !s.doors[r.id];
      if (!s.doors[r.id]) s.unlockedBy[r.id] = 'player';

      note(s, s.player.name + (s.doors[r.id] ? ' locks ' : ' unlocks ') + r.name + '.');

      return true;
    }
    if (action === 'combat') {
      if (v?.verb === 'exchange') {
        ok(['attack', 'defend', 'flee'].includes(v.tactic), 'Choose a combat tactic.');
        apply(s, 'combat', { verb: v.tactic });
        if (s.sim.combat?.phase === 'enemy') apply(s, 'combat', { verb: 'continue' });

        return true;
      }

      ok(!s.activePick, 'Finish lockpicking first.');
      if (v?.verb === 'start') {
        ok(
          !s.sim.combat &&
            conscious(s, v.target) &&
            v.target !== 'player' &&
            room(s, v.target) === s.player.room,
          'Choose a living opponent here.',
        );
        readyWeapon(s, v.target);
        ok(
          v.intent === undefined || ['nonlethal', 'lethal'].includes(v.intent),
          'Choose non-lethal or lethal combat.',
        );
        const intent = v.intent || 'lethal';
        s.sim.combat = { enemy: v.target, round: 1, playerIntent: intent, enemyIntent: intent };
        note(
          s,
          s.player.name +
            ' confronts ' +
            personName(s, v.target) +
            '. ' +
            (intent === 'nonlethal' ? 'Non-lethal' : 'Lethal') +
            ' combat begins.',
        );

        return true;
      }

      ok(s.sim.combat, 'There is no active encounter.');
      const enemy = s.sim.combat.enemy;
      ok(
        v?.verb !== 'surrender',
        'Offer surrender through dialogue; your opponent must accept it.',
      );
      if (v?.verb === 'intent') {
        ok(
          s.sim.combat.phase !== 'enemy' && ['nonlethal', 'lethal'].includes(v.intent),
          'Choose your approach on your turn.',
        );
        s.sim.combat.playerIntent = v.intent;
        note(
          s,
          s.player.name +
            (v.intent === 'nonlethal'
              ? ' aims to subdue, using unarmed non-lethal strikes.'
              : ' prepares lethal force.'),
        );

        return true;
      }
      if (v?.verb === 'continue') {
        ok(s.sim.combat.phase === 'enemy', 'Choose your action first.');
        strike(s, enemy, 'player', s.sim.combat.defending);
        if (s.sim.combat) {
          s.sim.combat.round++;
          s.sim.combat.phase = 'player';
          advanceHelp(s);
        }

        return true;
      }

      ok(s.sim.combat.phase !== 'enemy', 'Let your opponent respond before acting again.');
      ok(['attack', 'defend', 'flee'].includes(v?.verb), 'Choose a combat action.');
      if (v.verb === 'flee' && roll(s, 20) >= 9) {
        s.sim.combat = null;
        note(s, s.player.name + ' disengages. Guarded routes remain blocked.');
        return true;
      }
      if (v.verb === 'attack') {
        if (s.sim.combat.playerIntent === 'lethal' && s.sim.combat.enemyIntent === 'nonlethal') {
          s.sim.combat.enemyIntent = 'lethal';
          note(s, 'The attack escalates the fight to lethal force.');
        }

        strike(s, 'player', enemy);
      } else note(s, s.player.name + (v.verb === 'defend' ? ' defends.' : ' fails to disengage.'));
      if (s.sim.combat) {
        s.sim.combat.phase = 'enemy';
        s.sim.combat.defending = v.verb === 'defend';
      }

      s.sim.turn++;
      for (const p of Object.values(s.sim.people))
        p.intoxication = Math.max(0, (p.intoxication || 0) - 0.05);

      return true;
    }
    if (action === 'expand-world') {
      ok(!s.activePick && !s.sim.combat, 'Finish the current encounter first.');
      const before = new Set(s.blueprint.characters.map((c) => c.id)),
        rooms = new Set(s.blueprint.rooms.map((r) => r.id));
      s.blueprint = APSUSoloBlueprint.extend(s.blueprint, v.patch, v.anchor);
      for (const c of s.blueprint.characters)
        if (!before.has(c.id)) {
          s.npcs[c.id] = { room: c.room, following: false, goal: c.goal, memory: '' };
          s.sim.people[c.id] = {
            hp: 20,
            maxHp: 20,
            money: 20 * 10 ** s.blueprint.currency.decimals,
            equipped: null,
          };
        }
      for (const r of s.blueprint.rooms) if (!rooms.has(r.id) && r.locked) s.doors[r.id] = true;
      for (const i of v.patch.items)
        s.items.push({ ...i, capacity: i.kind === 'lockpick' ? 100 : 0 });

      ensureKeys(
        s,
        s.blueprint.rooms.filter((r) => !rooms.has(r.id)),
      );
      s.sim.lastExpansion = s.sim.turn;
      note(s, 'New places and people are now part of ' + s.title + '.');

      return true;
    }
    if (action === 'edit-world') {
      ok(!s.activePick && !s.sim.combat, 'Finish the current encounter before editing.');
      const draft = APSUSoloBlueprint.validate(v.blueprint);
      ok(
        s.blueprint.rooms.every((r) => draft.rooms.some((x) => x.id === r.id)) &&
          s.blueprint.characters.every((c) => draft.characters.some((x) => x.id === c.id)),
        'Existing places and characters cannot be deleted.',
      );
      for (const c of draft.characters) {
        const previous = s.blueprint.characters.find((x) => x.id === c.id);

        if (previous && previous.name !== c.name)
          for (const message of s.messages) if (message.who === previous.name) message.who = c.name;
      }

      const newDoors = draft.rooms.filter(
        (r) => r.locked && !s.blueprint.rooms.some((x) => x.id === r.id && x.locked),
      );
      const scale = 10 ** (draft.currency.decimals - s.blueprint.currency.decimals);

      for (const p of Object.values(s.sim.people))
        p.money = Math.min(1e12, Math.round(p.money * scale));
      for (const item of s.items)
        if (item.valueMinor != null)
          item.valueMinor = Math.min(1e12, Math.round(item.valueMinor * scale));

      s.blueprint = draft;
      s.title = draft.title;
      if (v.character && s.npcs[v.character.id]) {
        const n = s.npcs[v.character.id];
        n.goal = v.character.goal;
        if (n.room !== v.character.room) {
          n.room = v.character.room;
          n.following = false;
        }
      }
      for (const r of draft.rooms)
        if (r.locked && s.doors[r.id] === undefined) s.doors[r.id] = true;
      for (const c of draft.characters)
        if (!s.npcs[c.id]) {
          s.npcs[c.id] = { room: c.room, following: false, goal: c.goal, memory: '' };
          s.sim.people[c.id] = {
            hp: 20,
            maxHp: 20,
            money: 20 * 10 ** s.blueprint.currency.decimals,
            equipped: null,
          };
        }
      if (v.money !== undefined) {
        ok(
          Number.isSafeInteger(v.money) && v.money >= 0 && v.money <= 1e12,
          'Invalid starting funds.',
        );
        s.sim.people.player.money = v.money;
      }
      if (v.item) {
        ok(!s.items.some((i) => i.id === v.item.id), 'Duplicate item.');
        s.items.push({ ...v.item, capacity: v.item.kind === 'lockpick' ? 100 : 0 });
      }

      ensureKeys(s, newDoors);
      note(s, 'World editor changes saved.');

      return true;
    }

    return false;
  }

  function wake(s) {
    for (const [id, p] of Object.entries(s.sim.people)) {
      if (p.hp > 0 && p.knockedOutUntil && s.sim.turn >= p.knockedOutUntil) {
        p.knockedOutUntil = 0;
        p.hp = Math.max(p.hp, Math.ceil(p.maxHp / 4));
        note(s, personName(s, id) + ' regains consciousness, still injured.', room(s, id));
      }
    }
  }

  function advance(s) {
    s.sim.turn++;
    wake(s);
    for (const p of Object.values(s.sim.people))
      p.intoxication = Math.max(0, (p.intoxication || 0) - 0.05);
    if (s.sim.turn % 3 || s.sim.combat || s.activePick) return;
    for (const c of s.blueprint.characters) {
      const n = s.npcs[c.id];

      if (!conscious(s, c.id) || n.following || n.room === s.player.room || !c.routine?.length)
        continue;

      const dest = c.routine[Math.floor(s.sim.turn / 3) % c.routine.length];

      if (dest === n.room) {
        s.sim.people[c.id].money = Math.min(
          1e12,
          s.sim.people[c.id].money + 10 ** s.blueprint.currency.decimals,
        );
        continue;
      }

      const paths = [[n.room]],
        seen = new Set([n.room]);
      let step;

      for (const path of paths) {
        const last = path.at(-1);

        if (last === dest) {
          step = path[1];
          break;
        }
        for (const next of s.blueprint.rooms.find((r) => r.id === last).exits)
          if (!seen.has(next) && !s.doors[next] && !blocker(s, last, next, c.id)) {
            seen.add(next);
            paths.push([...path, next]);
          }
      }
      if (step) {
        const from = n.room;
        n.room = step;
        note(
          s,
          c.name +
            ' travels to ' +
            s.blueprint.rooms.find((r) => r.id === step).name +
            ' as part of their routine.',
          step,
        );
        const event = s.messages.at(-1);
        event.visible = step === s.player.room || from === s.player.room;
        event.witnesses = [...new Set([...event.witnesses, c.id])];
      }
    }
  }

  function money(s, amount) {
    const c = s.blueprint.currency;
    return (amount / 10 ** c.decimals).toFixed(c.decimals) + ' ' + c.symbol;
  }

  function map(s, whole = false) {
    const rooms = s.blueprint.rooms,
      B = APSUSoloBlueprint;

    const building = (r) => B.buildingFor(s.blueprint, r.zone);

    if (whole) {
      const result = {};

      for (const r of rooms) {
        const b = building(r),
          id = b ? b.id : r.id;

        if (!result[id])
          result[id] = {
            name: b ? b.name : r.name,
            kind: b ? 'building' : 'street',
            outdoor: !b,
            exits: [],
          };
        for (const e of r.exits) {
          const target = rooms.find((x) => x.id === e),
            dest = building(target)?.id || e;

          if (dest !== id && !result[id].exits.includes(dest)) result[id].exits.push(dest);
        }
      }

      return result;
    }

    const here = rooms.find((r) => r.id === s.player.room),
      boundary = building(here);

    const inside = (r) =>
      boundary ? building(r)?.id === boundary.id : !building(r) && r.zone === here.zone;

    const visible = new Set(rooms.filter(inside).map((r) => r.id));

    for (const r of rooms.filter(inside)) for (const e of r.exits) visible.add(e);

    return Object.fromEntries(
      rooms
        .filter((r) => visible.has(r.id))
        .map((r) => [
          r.id,
          {
            ...r,
            exits: r.exits.filter((e) => visible.has(e)),
            portal: !inside(r),
            outdoor: !building(r),
            name: inside(r)
              ? r.name
              : !building(r)
                ? 'Outside · ' + r.name
                : 'Entrance · ' + building(r).name,
          },
        ]),
    );
  }

  globalThis.APSUSoloSimulation = {
    normalize,
    guard,
    apply,
    advance,
    choices,
    perform,
    blocker,
    relationship,
    offerRental,
    playerPayment,
    explicitPayment,
    helpChoices,
    spokenHelp,
    recordExchange,
    introducedName,
    living,
    conscious,
    note,
    money,
    map,
    weapons,
    drinkingState: (value) =>
      value < 0.25
        ? 'Sober'
        : value < 1
          ? 'Lightly affected'
          : value < 2.5
            ? 'Tipsy'
            : value < 5
              ? 'Drunk'
              : 'Very drunk',
  };
})();
