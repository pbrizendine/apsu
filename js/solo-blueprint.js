// Shared browser/relay validation. Generated content is data, never executable code.
(() => {
  const ok = (v, m) => {
    if (!v) throw Error(m || 'Invalid world design.');
  };

  const text = (v, n) => typeof v === 'string' && v.trim().length > 0 && v.length <= n;

  const id = (v) =>
    typeof v === 'string' &&
    /^[a-z][a-z0-9_-]{0,39}$/.test(v) &&
    !['player', 'constructor', 'prototype', '__proto__'].includes(v);
  // Narrow compatibility repair for explicitly named ordinary objects from older drafts.

  function scriptItem(source) {
    const i = { ...source };

    if (i.kind !== 'prop') return i;

    const name = String(i.name || '')
      .trim()
      .toLowerCase();

    if (['service pistol', 'pistol', 'handgun', 'revolver'].includes(name))
      return { ...i, kind: 'weapon', template: 'pistol' };
    if (['whiskey bottle', 'whisky bottle', 'bottle of whiskey', 'bottle of whisky'].includes(name))
      return { ...i, kind: 'drink', abv: 40, servingMl: 45, servings: 16 };

    return i;
  }

  function validate(v) {
    ok(v && text(v.title, 80) && text(v.premise, 1600), 'Give the world a title and premise.');
    ok(Array.isArray(v.rooms) && v.rooms.length >= 3 && v.rooms.length <= 120, 'Use 3–120 rooms.');
    ok(
      Array.isArray(v.characters) && v.characters.length >= 1 && v.characters.length <= 60,
      'Use 1–60 characters.',
    );
    ok(Array.isArray(v.items) && v.items.length <= 400, 'Use at most 400 starting items.');
    const zones =
      v.zones === undefined
        ? [{ id: 'outdoors', name: 'Surroundings', kind: 'region', parent: null }]
        : v.zones;
    ok(Array.isArray(zones) && zones.length > 0 && zones.length <= 80, 'Use 1–80 areas.');
    ok(
      zones.every(
        (z) => z && id(z.id) && text(z.name, 80) && ['region', 'building'].includes(z.kind),
      ) && new Set(zones.map((z) => z.id)).size === zones.length,
      'Invalid areas.',
    );
    for (const z of zones) {
      ok(z.parent === null || zones.some((x) => x.id === z.parent), 'Unknown parent area.');
      const seen = new Set([z.id]);
      let at = z;

      while (at.parent) {
        ok(!seen.has(at.parent), 'Area parents cannot form a cycle.');
        seen.add(at.parent);
        at = zones.find((x) => x.id === at.parent);
      }
    }

    const currency = v.currency || { name: 'Gold', symbol: 'gold', decimals: 0 };
    ok(
      text(currency.name, 40) && text(currency.symbol, 12) && [0, 2].includes(currency.decimals),
      'Invalid currency.',
    );
    const lore = v.lore || [];
    ok(Array.isArray(lore) && lore.length <= 100, 'Too many lore records.');
    const all = [...v.rooms, ...v.characters, ...v.items];
    ok(
      all.every((x) => x && id(x.id)) && new Set(all.map((x) => x.id)).size === all.length,
      'IDs must be unique and safe.',
    );
    const roomIDs = v.rooms.map((r) => r.id),
      people = v.characters.map((c) => c.id),
      owners = ['player', ...roomIDs, ...people];
    ok(roomIDs.includes(v.start), 'Choose a valid starting room.');
    const rooms = v.rooms.map((r, index) => {
      ok(
        text(r.name, 80) &&
          text(r.description, 1000) &&
          Array.isArray(r.exits) &&
          r.exits.length > 0 &&
          r.exits.length < 8 &&
          new Set(r.exits).size === r.exits.length &&
          r.exits.every((e) => e !== r.id && roomIDs.includes(e)),
        'Rooms need descriptions and valid exits.',
      );
      ok(typeof r.locked === 'boolean', 'Specify whether each room is locked.');
      ok(
        !r.locked || r.exits.length === 1,
        'Locked rooms must have one entrance in this prototype.',
      );

      return {
        id: r.id,
        name: r.name,
        description: r.description,
        exits: [...r.exits],
        locked: r.locked,
        zone: r.zone || zones[0].id,
        mapX: Number.isFinite(r.mapX) ? Math.max(-100, Math.min(100, r.mapX)) : index % 3,
        mapY: Math.floor(index / 3),
      };
    });
    ok(
      rooms.every((r) => zones.some((z) => z.id === r.zone)),
      'Unknown room area.',
    );
    ok(!rooms.find((r) => r.id === v.start).locked, 'The starting room cannot be locked.');
    for (const r of rooms)
      for (const target of r.exits)
        ok(
          rooms.find((x) => x.id === target).exits.includes(r.id),
          'Exits must connect in both directions.',
        );

    const seen = new Set([v.start]),
      queue = [v.start];

    for (const r of queue)
      for (const e of rooms.find((x) => x.id === r).exits)
        if (!seen.has(e)) {
          seen.add(e);
          queue.push(e);
        }

    ok(seen.size === rooms.length, 'Every room must be reachable.');
    const characters = v.characters.map((c) => {
      ok(
        text(c.name, 60) &&
          text(c.description, 1000) &&
          text(c.goal, 1000) &&
          text(c.personality, 1000) &&
          roomIDs.includes(c.room),
        'Characters need descriptions, goals, personality and a valid room.',
      );
      const backstory = c.backstory ?? '';
      ok(
        typeof backstory === 'string' && backstory.length <= 1800,
        'Backstory must be at most 1800 characters.',
      );
      const traits = {};

      for (const key of ['warmth', 'caution', 'assertiveness', 'curiosity', 'discipline']) {
        const value = c.traits?.[key] ?? 50;
        ok(
          Number.isInteger(value) && value >= 0 && value <= 100,
          'Traits must be whole numbers from 0 to 100.',
        );
        traits[key] = value;
      }

      const preferences = {};

      for (const key of ['likes', 'dislikes', 'values', 'boundaries']) {
        const list = c.preferences?.[key] ?? [];
        ok(
          Array.isArray(list) && list.length <= 6 && list.every((v) => text(v, 180)),
          'Use up to six short preferences per category.',
        );
        preferences[key] = [...list];
      }

      const motivations = c.motivations ?? [];
      ok(
        Array.isArray(motivations) &&
          motivations.length <= 6 &&
          motivations.every((v) => text(v, 240)),
        'Use up to six short motivations.',
      );
      const routine = c.routine || [];
      ok(
        Array.isArray(routine) && routine.length <= 8 && routine.every((x) => roomIDs.includes(x)),
        'Routine must use existing places.',
      );

      return {
        routine,
        backstory,
        traits,
        preferences,
        motivations: [...motivations],
        id: c.id,
        name: c.name,
        description: c.description,
        goal: c.goal,
        personality: c.personality,
        room: c.room,
      };
    });
    // An arrival room may be empty; do not create a duplicate player to fill it.
    ok(
      new Set(characters.map((c) => c.name.toLowerCase())).size === characters.length &&
        !characters.some((c) => ['player', 'story', 'system'].includes(c.name.toLowerCase())),
      'Character names must be distinct.',
    );
    const roles = v.roles || [];
    ok(Array.isArray(roles) && roles.length <= 40, 'Use at most 40 world roles.');
    ok(
      roles.every(
        (r) =>
          r &&
          text(r.name, 80) &&
          (r.scope === undefined || (typeof r.scope === 'string' && r.scope.length <= 80)) &&
          ['player', ...people].includes(r.holder) &&
          (r.room === null || roomIDs.includes(r.room)),
      ) && new Set(roles.map((r) => r.name.toLowerCase())).size === roles.length,
      'Roles need unique names, an existing character or player, and an optional room.',
    );
    const items = v.items.map((source) => {
      const i = scriptItem(source);

      const itemError = (detail) =>
        'Items need valid kinds and owners. Item "' + i.id + '": ' + detail;

      ok(text(i.name, 80), itemError('name must contain 1–80 characters.'));
      ok(
        typeof i.description === 'string' && i.description.length <= 500,
        itemError('description must be text of at most 500 characters.'),
      );
      ok(
        ['prop', 'lockpick', 'key', 'weapon', 'drink'].includes(i.kind),
        itemError('kind must be prop, lockpick, key, weapon, or drink.'),
      );
      ok(
        owners.includes(i.owner),
        itemError(
          'owner must be player or an existing room/character ID; unknown or ambiguous owner.',
        ),
      );
      ok(
        i.valueMinor == null ||
          (Number.isSafeInteger(i.valueMinor) && i.valueMinor >= 0 && i.valueMinor <= 1e12),
        'Item value must be a nonnegative amount in minor currency units.',
      );
      if (i.kind === 'drink') {
        ok(
          Number.isInteger(i.servings ?? 1) && (i.servings ?? 1) >= 1 && (i.servings ?? 1) <= 100,
          'Invalid drink servings.',
        );
        ok(
          Number.isFinite(i.abv) &&
            i.abv >= 0 &&
            i.abv <= 100 &&
            Number.isFinite(i.servingMl) &&
            i.servingMl >= 10 &&
            i.servingMl <= 2000,
          'Drinks need 0–100% alcohol and a 10–2000 ml serving.',
        );
      }
      if (i.kind === 'key')
        ok(
          rooms.some((r) => r.id === i.opens && r.locked),
          'Keys must name a door.',
        );
      if (i.kind === 'weapon')
        ok(
          ['blade', 'blunt', 'pistol', 'rifle', 'bow'].includes(i.template),
          'Choose a supported weapon template.',
        );

      return {
        id: i.id,
        name: i.name,
        description: i.description,
        valueMinor: i.valueMinor ?? null,
        kind: i.kind,
        owner: i.owner,
        ...(i.kind === 'key' ? { opens: i.opens } : {}),
        ...(i.kind === 'weapon' ? { template: i.template } : {}),
        ...(i.kind === 'drink'
          ? { abv: i.abv, servingMl: i.servingMl, servings: i.servings ?? 1 }
          : {}),
      };
    });
    ok(
      items.filter((i) => i.kind === 'lockpick' && i.owner === 'player').length <= 3,
      'The player can start with at most 3 working picks.',
    );
    for (const record of lore)
      ok(
        record &&
          text(record.fact, 1500) &&
          Array.isArray(record.knownBy) &&
          record.knownBy.every((x) => x === 'all' || people.includes(x)),
        'Lore needs a fact and valid witnesses.',
      );

    return {
      title: v.title,
      premise: v.premise,
      start: v.start,
      roles: roles.map((r) => ({
        name: r.name,
        holder: r.holder,
        room: r.room,
        scope: r.scope || '',
      })),
      rooms,
      characters,
      items,
      zones: zones.map((z) => ({ id: z.id, name: z.name, kind: z.kind, parent: z.parent })),
      currency: { name: currency.name, symbol: currency.symbol, decimals: currency.decimals },
      storyMode: v.storyMode === 'directed' ? 'directed' : 'sandbox',
      lore: lore.map((x) => ({ fact: x.fact, knownBy: [...new Set(x.knownBy)] })),
    };
  }
  // A building can contain nested areas; use its outermost building boundary.

  function buildingFor(world, zoneId) {
    const seen = new Set();
    let at = world.zones?.find((z) => z.id === zoneId),
      building = null;

    while (at && !seen.has(at.id)) {
      seen.add(at.id);
      if (at.kind === 'building') building = at;

      at = world.zones.find((z) => z.id === at.parent);
    }

    return building;
  }

  function withStreets(value, existing = null) {
    const world = structuredClone(value);

    if (!Array.isArray(world.zones) || !Array.isArray(world.rooms)) return world;

    const used = new Set(
      [...world.rooms, ...(world.characters || []), ...(world.items || []), ...world.zones].map(
        (x) => x.id,
      ),
    );

    const unique = (prefix) => {
      let i = 1;

      while (used.has(prefix + i)) i++;

      const id = prefix + i;
      used.add(id);

      return id;
    };

    const edges = new Set();

    for (const room of [...world.rooms])
      for (const id of [...(room.exits || [])]) {
        const other = world.rooms.find((r) => r.id === id);

        if (!other) continue;

        const key = [room.id, id].sort().join(':');

        if (edges.has(key)) continue;

        edges.add(key);
        // Never rewrite established playable routes while expanding a saved world.
        if (existing?.rooms.some((r) => r.id === room.id && r.exits.includes(id))) continue;

        const a = buildingFor(world, room.zone),
          b = buildingFor(world, other.zone);

        if (!a || !b || a.id === b.id) continue;

        let region = world.zones.find((z) => z.id === a.parent && z.kind === 'region');

        if (!region) {
          region = {
            id: unique('street_area_'),
            name: 'Surrounding streets',
            kind: 'region',
            parent: null,
          };
          world.zones.push(region);
        }

        const streetId = unique('street_');
        room.exits = room.exits.map((e) => (e === id ? streetId : e));
        other.exits = other.exits.map((e) => (e === room.id ? streetId : e));
        if (!other.exits.includes(streetId)) other.exits.push(streetId);

        world.rooms.push({
          id: streetId,
          name: (
            'Street: ' +
            room.name.slice(0, 28) +
            ' — ' +
            other.name.slice(0, 28) +
            ' · ' +
            streetId.slice(7)
          ).slice(0, 80),
          description: (
            'An outdoor route connects the entrances of ' +
            a.name +
            ' and ' +
            b.name +
            '.'
          ).slice(0, 1000),
          zone: region.id,
          locked: false,
          exits: [room.id, other.id],
        });
      }

    return world;
  }

  function extend(current, patch, anchor) {
    const base = validate(current);
    ok(
      base.rooms.some((r) => r.id === anchor),
      'Unknown expansion anchor.',
    );
    ok(
      patch &&
        Array.isArray(patch.rooms) &&
        patch.rooms.length <= 4 &&
        Array.isArray(patch.characters) &&
        patch.characters.length <= 3 &&
        Array.isArray(patch.items) &&
        patch.items.length <= 15,
      'Expansion is too large.',
    );
    ok(
      patch.rooms.length + patch.characters.length > 0,
      'An expansion needs a new place or person.',
    );
    const copy = structuredClone(base),
      existing = new Set(base.rooms.map((r) => r.id));

    for (const r of patch.rooms) {
      ok(
        r.exits.every((e) => !existing.has(e) || e === anchor),
        'New routes must join the anchor.',
      );
      if (r.exits.includes(anchor)) copy.rooms.find((x) => x.id === anchor).exits.push(r.id);
    }

    copy.rooms.push(...patch.rooms);
    copy.characters.push(...patch.characters);
    copy.items.push(...patch.items);
    if (patch.zones) copy.zones.push(...patch.zones);
    if (patch.lore) copy.lore.push(...patch.lore);
    if (patch.roles) copy.roles.push(...patch.roles);

    return validate(withStreets(copy, base));
  }

  globalThis.APSUSoloBlueprint = { validate, extend, buildingFor, withStreets, scriptItem };
})();
