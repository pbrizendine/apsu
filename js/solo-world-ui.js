// Generated-world controls share the room's panels and native dialogs.
(() => {
  const panel = document.createElement('section');
  panel.className = 'panel living-panel';
  panel.dataset.panelId = 'living-world';
  panel.innerHTML = `<h2>World & character</h2><p id="living-health"></p><p id="living-money"></p><p id="living-drinking"></p><p id="living-encounter" role="status"></p><div id="living-actions"></div><label class="living-toggle"><input id="combat-dialogue" type="checkbox" checked>Character dialogue between combat turns</label><p class="muted">One AI request per combat action when connected.</p><button id="housing-open">Homes & rentals</button><button id="world-editor-open">Edit world</button><button id="world-expand-open">Explore something new</button><label class="living-toggle"><input type="checkbox" id="world-evolving">Allow occasional world expansion during dialogue</label><p class="muted">Expansion uses one extra free-model request, at most once every six turns. No background requests.</p>`;
  document.querySelector('.room-sidebar').prepend(panel);
  const editorPage = document.body.classList.contains('world-editor-page');
  const dialog = document.createElement(editorPage ? 'div' : 'dialog');
  dialog.id = 'world-editor';
  dialog.className = 'world-editor';
  dialog.innerHTML = `<h2>World editor</h2><p>Change your world without erasing its history. Existing characters keep their health, memory, and possessions.</p><div class="editor-grid"><section><h3>Setting</h3><label>World title<input id="edit-world-title" maxlength="80"></label><label>Premise<textarea id="edit-world-premise" maxlength="1600"></textarea></label><label>Story approach<select id="edit-story-mode"><option value="sandbox">Open-ended world</option><option value="directed">Directed story</option></select></label><label>Currency name<input id="edit-currency-name" maxlength="40"></label><label>Currency symbol / code<input id="edit-currency-symbol" maxlength="12"></label><label>Decimal places<select id="edit-currency-decimals"><option value="0">0 · gold, credits</option><option value="2">2 · dollars, euros</option></select></label><label>Your funds<input id="edit-wallet" type="number" min="0" step="0.01"></label><button id="save-setting">Save setting</button></section><section><h3>Rooms & areas</h3><label>Room<select id="edit-room-select"></select></label><label>Name<input id="edit-room-name" maxlength="80"></label><label>Description<textarea id="edit-room-description" maxlength="1000"></textarea></label><label>Area<select id="edit-room-zone"></select></label><label><input type="checkbox" id="edit-room-locked">Has a lockable entrance (one connection)</label><label>Connect to (hold Ctrl / Command for multiple)<select id="edit-room-exits" multiple></select></label><button id="save-room">Save room</button><button id="add-room">Add connected room</button><label>Street name<input id="new-street-name" maxlength="80" placeholder="Street outside the building"></label><button id="add-street">Add street outside selected room</button><label>New area name<input id="new-zone-name" maxlength="80"></label><label>Area type<select id="new-zone-kind"><option value="building">Building interior</option><option value="region">Region</option></select></label><button id="add-zone">Create area inside selected area</button></section><section><h3>Characters</h3><label>Character<select id="edit-person-select"></select></label><label>Name<input id="edit-person-name" maxlength="60"></label><label>Appearance<textarea id="edit-person-description" maxlength="1000"></textarea></label><label>Personality<textarea id="edit-person-personality" maxlength="1000"></textarea></label><label>Backstory<textarea id="edit-person-backstory" maxlength="1800"></textarea></label><label>Motivations (one per line)<textarea id="edit-person-motivations"></textarea></label><div id="edit-person-depth"></div><label>Goal<textarea id="edit-person-goal" maxlength="1000"></textarea></label><label>Location<select id="edit-person-room"></select></label><label>Routine destinations (multiple selection)<select id="edit-person-routine" multiple></select></label><button id="save-person">Save character</button><button id="add-person">Add character</button></section><section><h3>Items</h3><label>Name<input id="edit-item-name" maxlength="80"></label><label>Description<textarea id="edit-item-description" maxlength="500"></textarea></label><label>Estimated value (world currency)<input id="edit-item-value" type="number" min="0" step="0.01" placeholder="Optional estimate"></label><label>Template<select id="edit-item-kind"><option value="prop">Roleplay object</option><option value="drink">Drink</option><option value="lockpick">Lockpick</option><option value="key">Door key</option><option value="blade">Blade</option><option value="blunt">Blunt weapon</option><option value="pistol">Handgun</option><option value="rifle">Long gun</option><option value="bow">Bow</option></select></label><label>Place in room or inventory<select id="edit-item-owner"></select></label><div id="edit-drink-fields" hidden><label>Alcohol %<input id="edit-drink-abv" type="number" min="0" max="100" value="0" step="0.1"></label><label>Serving (ml)<input id="edit-drink-ml" type="number" min="10" max="2000" value="250"></label></div><label id="edit-key-field" hidden>Key opens<select id="edit-key-opens"></select></label><button id="add-world-item">Create item</button></section><section><h3>World roles</h3><p>Assign a position to yourself or an NPC. This updates the current world facts, not keys or inventory. Review conflicting lore and character goals separately.</p><label>Role<select id="edit-role-select"></select></label><label>Title<input id="edit-role-name" maxlength="80" placeholder="Nightclub owner"></label><label>Held by<select id="edit-role-holder"></select></label><label>Associated room<select id="edit-role-room"></select></label><button id="save-role">Save role</button><button id="new-role">New role</button><button id="delete-role">Remove role</button></section><section><h3>Lore & secrets</h3><label>Record<select id="edit-lore-select"></select></label><label>Established fact<textarea id="edit-lore-fact" maxlength="1500"></textarea></label><label>Who knows this? (multiple selection)<select id="edit-lore-known" multiple></select></label><button id="save-lore">Save lore</button><button id="add-lore">Add lore record</button></section></div><p id="world-editor-status" role="status"></p><button id="world-editor-close">Close</button>`;
  (editorPage ? document.getElementById('editor-main') : document.body).append(dialog);
  const expansion = document.createElement('dialog');
  expansion.innerHTML = `<h2>Explore something new</h2><p>Add a few connected places or people. Established rooms, possessions, health, and history stay intact. This uses your connected key with the default free model.</p><label>What belongs here?<textarea id="expand-world-prompt" maxlength="3000" placeholder="A workshop behind the market, with an owner who has reasons to stay out of the conflict"></textarea></label><button id="expand-world-go">Generate addition</button><p id="expand-world-status" role="status"></p><button id="expand-world-close">Close</button>`;
  document.body.append(expansion);
  const housingDialog = document.createElement('dialog');
  housingDialog.setAttribute('aria-labelledby', 'housing-title');
  housingDialog.innerHTML = `<h2 id="housing-title">Homes & rentals</h2><p>Rent pays the landlord once for the stay and gives you a working room key. No recurring charges or automatic expiry.</p><div id="housing-list"></div><details><summary>Configure a rental (world editor)</summary><label>Room<select id="housing-room"></select></label><label>Landlord<select id="housing-landlord"></select></label><label>Price per stay (world currency)<input id="housing-price" type="number" min="0.01" step="0.01"></label><p>Configuring an unlocked room adds a lock. Occupied rentals cannot be reassigned.</p><button id="housing-configure">Save rental offer</button></details><p id="housing-status" role="status"></p><button id="housing-close">Close</button>`;
  document.body.append(housingDialog);

  const $ = (id) => document.getElementById(id);

  let state,
    api,
    working = false;

  const uid = (p) => p + crypto.randomUUID().replaceAll('-', '').slice(0, 16);

  const choices = (el, rows, selected) => {
    el.replaceChildren();
    for (const [value, text] of rows) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      o.selected = Array.isArray(selected) ? selected.includes(value) : selected === value;
      el.append(o);
    }
  };

  const run = async (fn) => {
    if (working) return;

    working = true;
    try {
      if (!api.available()) throw Error('Finish the current action first.');

      await fn();
      $('world-editor-status').textContent = 'Saved.';
    } catch (e) {
      $('world-editor-status').textContent = e.message;
      api.error(e.message);
      if (housingDialog.open) $('housing-status').textContent = e.message;
    } finally {
      working = false;
    }
  };

  const save = async (draft, extra = {}) => {
    await api.act('edit-world', { blueprint: draft, ...extra });
    load();
  };

  function load() {
    const selectedRoom = $('edit-room-select').value || state.player.room;
    const b = state.blueprint;
    $('edit-world-title').value = b.title;
    $('edit-world-premise').value = b.premise;
    $('edit-story-mode').value = b.storyMode;
    $('edit-currency-name').value = b.currency.name;
    $('edit-currency-symbol').value = b.currency.symbol;
    $('edit-currency-decimals').value = String(b.currency.decimals);
    $('edit-wallet').value = state.sim.people.player.money / 10 ** b.currency.decimals;
    choices(
      $('edit-room-select'),
      b.rooms.map((r) => [r.id, r.name]),
      selectedRoom,
    );
    choices(
      $('edit-room-zone'),
      b.zones.map((z) => [z.id, z.name]),
    );
    choices(
      $('edit-person-select'),
      b.characters.map((c) => [c.id, c.name]),
    );
    choices(
      $('edit-person-room'),
      b.rooms.map((r) => [r.id, r.name]),
    );
    choices(
      $('edit-person-routine'),
      b.rooms.map((r) => [r.id, r.name]),
    );
    choices($('edit-item-owner'), [
      ['player', state.player.name],
      ...b.characters.map((c) => [c.id, c.name]),
      ...b.rooms.map((r) => [r.id, 'Room floor · ' + r.name]),
    ]);
    choices(
      $('edit-key-opens'),
      b.rooms.filter((r) => r.locked).map((r) => [r.id, r.name]),
    );
    choices(
      $('edit-lore-select'),
      b.lore.map((l, i) => [String(i), l.fact.slice(0, 60)]),
    );
    choices($('edit-lore-known'), [
      ['all', 'Everyone'],
      ...b.characters.map((c) => [c.id, c.name]),
    ]);
    choices($('edit-role-select'), [
      ['', 'New role'],
      ...b.roles.map((r, i) => [String(i), r.name]),
    ]);
    choices($('edit-role-holder'), [
      ['player', state.player.name + ' · You'],
      ...b.characters.map((c) => [c.id, c.name]),
    ]);
    choices($('edit-role-room'), [['', 'World-wide'], ...b.rooms.map((r) => [r.id, r.name])]);
    roleFields();
    roomFields();
    personFields();
    loreFields();
  }

  const roleScopeLabel = document.createElement('label');
  roleScopeLabel.textContent = 'Workplace / organization';
  const roleScope = document.createElement('input');
  roleScope.id = 'edit-role-scope';
  roleScope.maxLength = 80;
  roleScopeLabel.append(roleScope);
  $('edit-role-name').parentElement.after(roleScopeLabel);

  function roleFields() {
    const selected = $('edit-role-select').value;
    const role = selected === '' ? null : state.blueprint.roles[Number(selected)];
    $('edit-role-name').value = role?.name || '';
    $('edit-role-scope').value = role?.scope || '';
    $('edit-role-holder').value = role?.holder || 'player';
    $('edit-role-room').value = role?.room || '';
  }

  function roomFields() {
    const r = state.blueprint.rooms.find((r) => r.id === $('edit-room-select').value);

    if (!r) return;

    $('edit-room-name').value = r.name;
    $('edit-room-description').value = r.description;
    $('edit-room-zone').value = r.zone;
    $('edit-room-locked').checked = r.locked;
    choices(
      $('edit-room-exits'),
      state.blueprint.rooms.filter((x) => x.id !== r.id).map((x) => [x.id, x.name]),
      r.exits,
    );
    syncRoomWorkspace();
  }

  function personFields() {
    const c = state.blueprint.characters.find((c) => c.id === $('edit-person-select').value);

    if (!c) return;
    for (const k of ['name', 'description', 'personality', 'goal'])
      $('edit-person-' + k).value = k === 'goal' ? state.npcs[c.id].goal : c[k];

    $('edit-person-backstory').value = c.backstory || '';
    $('edit-person-motivations').value = (c.motivations || []).join('\n');
    const depth = $('edit-person-depth');
    depth.replaceChildren();
    for (const key of ['warmth', 'caution', 'assertiveness', 'curiosity', 'discipline']) {
      const label = document.createElement('label'),
        input = document.createElement('input');
      label.textContent = key + ' (0–100)';
      input.id = 'trait-' + key;
      input.type = 'number';
      input.min = '0';
      input.max = '100';
      input.value = c.traits?.[key] ?? 50;
      label.append(input);
      depth.append(label);
    }
    for (const key of ['likes', 'dislikes', 'values', 'boundaries']) {
      const label = document.createElement('label'),
        input = document.createElement('textarea');
      label.textContent = key + ' (one per line)';
      input.id = 'preference-' + key;
      input.value = (c.preferences?.[key] || []).join('\n');
      label.append(input);
      depth.append(label);
    }

    $('edit-person-room').value = state.npcs[c.id].room;
    for (const o of $('edit-person-routine').options)
      o.selected = c.routine?.includes(o.value) || false;
  }

  function loreFields() {
    const l = state.blueprint.lore[Number($('edit-lore-select').value)];
    $('edit-lore-fact').value = l?.fact || '';
    for (const o of $('edit-lore-known').options)
      o.selected = l?.knownBy.includes(o.value) || false;
  }

  function syncRoomWorkspace() {
    if (!editorPage || !$('editor-room-list')) return;

    const list = $('editor-room-list');
    list.replaceChildren();
    const search = ($('editor-room-search').value || '').toLowerCase();

    for (const room of state.blueprint.rooms) {
      const area = state.blueprint.zones.find((z) => z.id === room.zone)?.name || '';

      if (!(room.name + ' ' + area).toLowerCase().includes(search)) continue;

      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = room.name + (area ? ' · ' + area : '');
      b.setAttribute('aria-pressed', String(room.id === $('edit-room-select').value));
      b.onclick = async () => {
        const current = state.blueprint.rooms.find((r) => r.id === $('edit-room-select').value);
        const changed =
          current &&
          (current.name !== $('edit-room-name').value ||
            current.description !== $('edit-room-description').value ||
            current.zone !== $('edit-room-zone').value ||
            current.locked !== $('edit-room-locked').checked ||
            JSON.stringify([...current.exits].sort()) !==
              JSON.stringify(
                Array.from($('edit-room-exits').selectedOptions, (o) => o.value).sort(),
              ));

        if (
          changed &&
          !(await APSUUI.confirm({
            title: 'Unsaved room changes',
            message: 'Discard the changes to this room and open another room?',
            confirmLabel: 'Discard changes',
          }))
        )
          return;

        $('edit-room-select').value = room.id;
        roomFields();
      };
      list.append(b);
    }

    const links = $('editor-connections');
    links.replaceChildren();
    for (const option of $('edit-room-exits').options) {
      const label = document.createElement('label'),
        input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = option.selected;
      input.onchange = () => {
        option.selected = input.checked;
      };
      label.append(input, document.createTextNode(option.textContent));
      links.append(label);
    }
  }

  function setupWorkspace() {
    const grid = dialog.querySelector('.editor-grid');
    const sections = [...grid.children];
    const nav = document.createElement('nav');
    nav.className = 'editor-tabs';
    nav.setAttribute('aria-label', 'World editor sections');
    const titles = ['Settings', 'Rooms', 'Characters', 'Items', 'Roles', 'Lore'];

    const select = (index) => {
      sections.forEach((section, i) => (section.hidden = i !== index));
      [...nav.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
    };

    titles.forEach((title, index) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = title;
      b.onclick = () => select(index);
      nav.append(b);
    });
    grid.before(nav);
    select(location.hash === '#roles' ? 4 : 1);
    const roomSection = sections[1];
    roomSection.classList.add('editor-room-workspace');
    const fields = document.createElement('div');
    fields.className = 'editor-room-fields';
    while (roomSection.firstChild) fields.append(roomSection.firstChild);

    const sidebar = document.createElement('aside');
    sidebar.innerHTML =
      '<label>Find a room<input id="editor-room-search" type="search" placeholder="Room or building name"></label><div id="editor-room-list"></div>';
    roomSection.append(sidebar, fields);
    $('editor-room-search').oninput = syncRoomWorkspace;
    $('edit-room-select').parentElement.hidden = true;
    const exitLabel = $('edit-room-exits').parentElement;
    exitLabel.hidden = true;
    const connections = document.createElement('fieldset');
    connections.innerHTML =
      '<legend>Connected rooms</legend><p>Check each room with a direct passage. Connections work in both directions.</p><div id="editor-connections"></div>';
    exitLabel.after(connections);
    const details = document.createElement('details');
    details.innerHTML = '<summary>Add rooms, streets or areas</summary>';
    fields.append(details);
    const newName = document.createElement('label');
    newName.innerHTML =
      'New room name<input id="new-room-name" maxlength="80" placeholder="Kitchen, back office…">';
    details.append(newName);
    for (const id of [
      'add-room',
      'new-street-name',
      'add-street',
      'new-zone-name',
      'new-zone-kind',
      'add-zone',
    ]) {
      const el = $(id);
      details.append(el.tagName === 'INPUT' || el.tagName === 'SELECT' ? el.parentElement : el);
    }

    $('add-room').textContent = 'Create room connected to selected room';
    $('world-editor-close').hidden = true;
    syncRoomWorkspace();
  }

  function renderHousing() {
    if (!state?.sim) return;

    const list = $('housing-list');
    list.replaceChildren();
    for (const [roomId, h] of Object.entries(state.sim.housing || {})) {
      const room = state.blueprint.rooms.find((r) => r.id === roomId);
      const landlord = state.blueprint.characters.find((c) => c.id === h.landlord);
      const row = document.createElement('p');
      row.textContent =
        room.name +
        ' · ' +
        (h.tenant === 'player'
          ? 'Your rented home'
          : APSUSoloSimulation.money(state, h.price) + ' per stay') +
        ' · Landlord: ' +
        landlord.name;
      list.append(row);
      if (!h.tenant) {
        const button = document.createElement('button');
        button.textContent = 'Rent ' + room.name;
        button.disabled = state.npcs[h.landlord].room !== state.player.room;
        button.title = 'Meet the landlord to pay and collect the key.';
        button.onclick = () =>
          run(async () => {
            await api.act('rent', { room: roomId });
            renderHousing();
          });
        list.append(button);
      }
    }
    if (!list.children.length)
      list.textContent =
        'No rental offers yet. Ask a room’s keyholder about renting, or configure a rental below.';
  }

  function mount(config) {
    api = config;
    $('housing-open').onclick = () => {
      if (!api.available()) return;

      choices(
        $('housing-room'),
        state.blueprint.rooms.map((r) => [r.id, r.name]),
      );
      choices(
        $('housing-landlord'),
        state.blueprint.characters.map((c) => [c.id, c.name]),
      );
      $('housing-price').step = String(10 ** -state.blueprint.currency.decimals);
      $('housing-price').min = $('housing-price').step;
      $('housing-status').textContent = '';
      renderHousing();
      housingDialog.showModal();
    };
    $('housing-close').onclick = () => housingDialog.close();
    $('housing-configure').onclick = () =>
      run(async () => {
        await api.act('rental-offer', {
          room: $('housing-room').value,
          landlord: $('housing-landlord').value,
          price: Math.round(
            Number($('housing-price').value) * 10 ** state.blueprint.currency.decimals,
          ),
        });
        $('housing-status').textContent = 'Rental offer saved.';
        renderHousing();
      });
    $('world-editor-open').onclick = () => {
      if (!api.available()) {
        api.error('Finish the current action first.');
        return;
      }

      window.open('solo-editor.html?save=' + encodeURIComponent(state.id), '_blank', 'noopener');
    };
    $('world-editor-close').onclick = () => (editorPage ? window.close() : dialog.close());
    if (editorPage) {
      load();
      setupWorkspace();
    }

    $('edit-room-select').onchange = roomFields;
    $('edit-person-select').onchange = personFields;
    $('edit-lore-select').onchange = loreFields;
    $('edit-role-select').onchange = roleFields;
    $('new-role').onclick = () => {
      $('edit-role-select').value = '';
      roleFields();
    };
    $('save-role').onclick = () =>
      run(() => {
        const b = structuredClone(state.blueprint);
        const role = {
          name: $('edit-role-name').value.trim(),
          scope: $('edit-role-scope').value.trim(),
          holder: $('edit-role-holder').value,
          room: $('edit-role-room').value || null,
        };
        const index = $('edit-role-select').value;

        if (index === '') b.roles.push(role);
        else b.roles[Number(index)] = role;

        return save(b);
      });
    $('delete-role').onclick = () =>
      run(() => {
        const b = structuredClone(state.blueprint);
        const index = $('edit-role-select').value;

        if (index !== '') b.roles.splice(Number(index), 1);

        return save(b);
      });
    $('save-setting').onclick = () =>
      run(() => {
        const b = structuredClone(state.blueprint);
        b.title = $('edit-world-title').value;
        b.premise = $('edit-world-premise').value;
        b.storyMode = $('edit-story-mode').value;
        b.currency = {
          name: $('edit-currency-name').value,
          symbol: $('edit-currency-symbol').value,
          decimals: Number($('edit-currency-decimals').value),
        };

        return save(b, {
          money: Math.round(Number($('edit-wallet').value) * 10 ** b.currency.decimals),
        });
      });
    $('save-room').onclick = () =>
      run(() => {
        const b = structuredClone(state.blueprint),
          r = b.rooms.find((r) => r.id === $('edit-room-select').value);
        r.name = $('edit-room-name').value;
        r.description = $('edit-room-description').value;
        r.zone = $('edit-room-zone').value;
        r.locked = $('edit-room-locked').checked;
        r.exits = Array.from($('edit-room-exits').selectedOptions, (o) => o.value);
        for (const other of b.rooms.filter((x) => x.id !== r.id)) {
          other.exits = other.exits.filter((id) => id !== r.id);
          if (r.exits.includes(other.id)) other.exits.push(r.id);
        }

        return save(APSUSoloBlueprint.withStreets(b, state.blueprint));
      });
    $('add-street').onclick = () =>
      run(() => {
        const b = structuredClone(state.blueprint),
          r = b.rooms.find((r) => r.id === $('edit-room-select').value);

        if (r.locked) throw Error('Choose an unlocked entrance or lobby before adding a street.');

        const building = APSUSoloBlueprint.buildingFor(b, r.zone);

        if (!building) throw Error('Assign this room to a building area first.');

        let area = b.zones.find((z) => z.id === building.parent && z.kind === 'region');

        if (!area) {
          area = { id: uid('z'), name: 'Surrounding streets', kind: 'region', parent: null };
          b.zones.push(area);
          b.zones.find((z) => z.id === building.id).parent = area.id;
        }

        const street = {
          id: uid('r'),
          name:
            $('new-street-name').value.trim() || ('Street outside ' + building.name).slice(0, 80),
          description: 'An outdoor street leads to the entrance of ' + building.name + '.',
          zone: area.id,
          locked: false,
          exits: [r.id],
        };
        r.exits.push(street.id);
        b.rooms.push(street);

        return save(b);
      });
    $('add-room').onclick = () =>
      run(() => {
        const b = structuredClone(state.blueprint),
          anchor = b.rooms.find((r) => r.id === $('edit-room-select').value);
        const id = uid('room_');
        anchor.exits.push(id);
        b.rooms.push({
          id,
          name: $('new-room-name')?.value.trim() || 'New room',
          description: 'An unexplored room.',
          zone: $('edit-room-zone').value,
          locked: false,
          exits: [anchor.id],
        });

        return save(b).then(() => {
          $('edit-room-select').value = id;
          roomFields();
        });
      });
    $('add-zone').onclick = () =>
      run(() => {
        const b = structuredClone(state.blueprint);
        b.zones.push({
          id: uid('area_'),
          name: $('new-zone-name').value,
          kind: $('new-zone-kind').value,
          parent: $('edit-room-zone').value,
        });
        return save(b);
      });
    for (const add of [false, true])
      $(add ? 'add-person' : 'save-person').onclick = () =>
        run(async () => {
          const b = structuredClone(state.blueprint),
            id = add ? uid('person_') : $('edit-person-select').value,
            c = {
              id,
              room: $('edit-person-room').value,
              routine: Array.from($('edit-person-routine').selectedOptions, (o) => o.value),
            };

          for (const k of ['name', 'description', 'personality', 'goal'])
            c[k] = $('edit-person-' + k).value;

          const lines = (value) =>
            value
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);

          c.backstory = $('edit-person-backstory').value;
          c.motivations = lines($('edit-person-motivations').value);
          c.traits = Object.fromEntries(
            ['warmth', 'caution', 'assertiveness', 'curiosity', 'discipline'].map((k) => [
              k,
              Number($('trait-' + k).value),
            ]),
          );
          c.preferences = Object.fromEntries(
            ['likes', 'dislikes', 'values', 'boundaries'].map((k) => [
              k,
              lines($('preference-' + k).value),
            ]),
          );
          if (add) b.characters.push(c);
          else b.characters[b.characters.findIndex((x) => x.id === id)] = c;

          await save(b, { character: c });
        });

    $('edit-item-kind').onchange = () => {
      $('edit-key-field').hidden = $('edit-item-kind').value !== 'key';
      $('edit-drink-fields').hidden = $('edit-item-kind').value !== 'drink';
    };
    $('add-world-item').onclick = () =>
      run(() => {
        const type = $('edit-item-kind').value,
          item = {
            id: uid('item_'),
            name: $('edit-item-name').value,
            description: $('edit-item-description').value,
            valueMinor:
              $('edit-item-value').value === ''
                ? null
                : Math.round(
                    Number($('edit-item-value').value) * 10 ** state.blueprint.currency.decimals,
                  ),
            owner: $('edit-item-owner').value,
            kind: ['prop', 'key', 'lockpick', 'drink'].includes(type) ? type : 'weapon',
            ...(type === 'drink'
              ? {
                  abv: Number($('edit-drink-abv').value),
                  servingMl: Number($('edit-drink-ml').value),
                }
              : {}),
            ...(type === 'key' ? { opens: $('edit-key-opens').value } : {}),
            ...(!['prop', 'key', 'lockpick', 'drink'].includes(type) ? { template: type } : {}),
          };
        return save(structuredClone(state.blueprint), { item });
      });
    for (const add of [false, true])
      $(add ? 'add-lore' : 'save-lore').onclick = () =>
        run(() => {
          const b = structuredClone(state.blueprint),
            l = {
              fact: $('edit-lore-fact').value,
              knownBy: Array.from($('edit-lore-known').selectedOptions, (o) => o.value),
            };

          if (add || !b.lore.length) b.lore.push(l);
          else b.lore[Number($('edit-lore-select').value)] = l;

          return save(b);
        });

    $('world-evolving').onchange = () => run(() => api.act('setting', $('world-evolving').checked));
    $('world-expand-open').onclick = () => expansion.showModal();
    $('expand-world-close').onclick = () => expansion.close();
    $('expand-world-go').onclick = () =>
      run(async () => {
        $('expand-world-status').textContent = 'Creating a connected addition…';
        try {
          await api.expand($('expand-world-prompt').value);
          $('expand-world-status').textContent = 'Added to your world.';
        } catch (e) {
          $('expand-world-status').textContent = e.message;
          throw e;
        }
      });
  }

  function render(s) {
    state = s;
    panel.hidden = !s.sim;
    if (!s.sim) return;

    const sim = s.sim,
      p = sim.people.player;
    $('living-health').textContent = p.hp
      ? `${s.player.name} · ${p.hp} / ${p.maxHp} HP`
      : `${s.player.name} · Deceased`;
    $('living-money').textContent = APSUSoloSimulation.money(s, p.money);
    $('world-evolving').checked = sim.evolving;
    const box = $('living-actions');
    box.replaceChildren();

    const button = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.disabled = !p.hp;
      b.onclick = () => run(fn);
      box.append(b);
    };

    $('living-drinking').textContent =
      APSUSoloSimulation.drinkingState(p.intoxication || 0) + ' · game state';
    $('living-encounter').textContent = sim.combat
      ? 'Round ' +
        sim.combat.round +
        ' · ' +
        s.blueprint.characters.find((c) => c.id === sim.combat.enemy).name +
        ' · ' +
        sim.people[sim.combat.enemy].hp +
        ' HP'
      : 'No active encounter';
    if (p.knockedOutUntil) {
      $('living-encounter').textContent =
        'Unconscious, not dead. Recover to continue with injuries; possessions are kept.';
      button('Recover after the fight', () => api.act('recover'));
      return;
    }
    for (const i of s.items.filter((i) => i.owner === 'player' && i.kind === 'weapon'))
      button((p.equipped === i.id ? 'Equipped: ' : 'Equip ') + i.name, () =>
        api.act('equip', i.id),
      );
    if (sim.combat) {
      const equipped =
        sim.combat.playerIntent === 'nonlethal' ? null : s.items.find((i) => i.id === p.equipped);
      const enemyWeapon =
        sim.combat.enemyIntent === 'nonlethal'
          ? null
          : s.items.find((i) => i.id === sim.people[sim.combat.enemy].equipped);
      $('living-encounter').textContent +=
        ' · Your intent: ' +
        (sim.combat.playerIntent === 'nonlethal' ? 'non-lethal' : 'lethal') +
        ' · Opponent intent: ' +
        (sim.combat.enemyIntent === 'nonlethal' ? 'non-lethal' : 'lethal') +
        ' · Your weapon: ' +
        (equipped?.name || 'Unarmed') +
        ' · Opponent weapon: ' +
        (enemyWeapon?.name || 'Unarmed') +
        (sim.combat.phase === 'enemy'
          ? ' · Opponent turn. You can speak before continuing.'
          : ' · Your turn.');
      const surrenderHint = document.createElement('p');
      surrenderHint.textContent =
        'To surrender or negotiate a truce, speak to your opponent in chat.';
      box.append(surrenderHint);
      if (sim.combat.phase === 'enemy') {
        button('Continue opponent turn', () => api.act('combat', { verb: 'continue' }));
        return;
      }

      button(
        sim.combat.playerIntent === 'nonlethal' ? 'Switch to lethal force' : 'Switch to non-lethal',
        () =>
          api.act('combat', {
            verb: 'intent',
            intent: sim.combat.playerIntent === 'nonlethal' ? 'lethal' : 'nonlethal',
          }),
      );
      for (const verb of ['attack', 'defend', 'flee'])
        button(
          verb === 'flee'
            ? 'Disengage'
            : verb === 'attack'
              ? sim.combat.playerIntent === 'nonlethal'
                ? 'Subdue (unarmed)'
                : 'Attack (lethal)'
              : 'Defend',
          () => api.act('combat', { verb: 'exchange', tactic: verb }),
        );

      return;
    }
    for (const c of s.blueprint.characters.filter(
      (c) => s.npcs[c.id].room === s.player.room && APSUSoloSimulation.conscious(s, c.id),
    )) {
      button('Non-lethal fight with ' + c.name, () =>
        api.act('combat', { verb: 'start', target: c.id, intent: 'nonlethal' }),
      );
      button('Lethal fight with ' + c.name, () =>
        api.act('combat', { verb: 'start', target: c.id, intent: 'lethal' }),
      );
      const row = document.createElement('label');
      row.textContent = 'Pay ' + c.name;
      const amount = document.createElement('input');
      amount.type = 'number';
      amount.min = '0';
      amount.step = String(1 / 10 ** s.blueprint.currency.decimals);
      amount.placeholder = 'Amount';
      row.append(amount);
      box.append(row);
      button('Transfer to ' + c.name, () =>
        api.act('pay', {
          target: c.id,
          amount: Math.round(Number(amount.value) * 10 ** s.blueprint.currency.decimals),
        }),
      );
    }
    for (const r of s.blueprint.rooms.filter(
      (r) =>
        r.locked &&
        (r.id === s.player.room || r.exits.includes(s.player.room)) &&
        s.items.some((i) => i.owner === 'player' && i.kind === 'key' && i.opens === r.id),
    ))
      button((s.doors[r.id] ? 'Unlock ' : 'Lock ') + r.name + ' with key', () =>
        api.act('key-door', { room: r.id }),
      );
    for (const block of sim.blocks.filter((b) => b.from === s.player.room)) {
      const line = document.createElement('p');
      line.textContent =
        s.blueprint.characters.find((c) => c.id === block.actor).name +
        ' blocks ' +
        s.blueprint.rooms.find((r) => r.id === block.to).name +
        '.';
      box.append(line);
    }
  }

  globalThis.APSUSoloWorldUI = { mount, render };
})();
