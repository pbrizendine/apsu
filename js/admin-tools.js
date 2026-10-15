// Additional world tools use the same permission-checked RPCs as the original panel.
function optionsFor(select, rows, empty) {
  const previous = select.value;
  select.replaceChildren();
  if (empty) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = empty;
    select.append(o);
  }
  for (const row of rows) {
    const o = document.createElement('option');
    o.value = row.id;
    o.textContent = row.label;
    select.append(o);
  }
  if ([...select.options].some((o) => o.value === previous)) select.value = previous;
}

async function loadRoomOwners(id) {
  const [characters, auth] = await Promise.all([
    rpc('world_character_directory', { p_world: worldId }),
    supabaseClient.auth.getUser(),
  ]);
  optionsFor(
    $(id),
    characters.map((c) => ({
      id: c.id,
      label:
        c.name +
        (c.player_id === auth.data.user?.id ? ' (your character)' : ' · ' + c.player_name) +
        ' · ' +
        c.id.slice(0, 8),
    })),
    'No character owner',
  );
  const own = characters.filter((c) => c.player_id === auth.data.user?.id);
  let button = document.getElementById(id + '-mine');

  if (!button) {
    button = document.createElement('button');
    button.id = id + '-mine';
    button.type = 'button';
    $(id).closest('label').after(button);
  }

  button.textContent = 'Choose my character';
  button.hidden = !own.length;
  button.onclick = () => {
    $(id).value = own.find((c) => c.online)?.id || own[0].id;
    $(id).focus();
  };
}

function renderConnectionEditor(room) {
  const list = $('room-connection-editor');
  list.replaceChildren();
  for (const target of mapData.rooms.filter((r) => r.id !== room.id)) {
    const connected = mapData.connections.some(
        (e) => e.from_room === room.id && e.to_room === target.id,
      ),
      row = document.createElement('div'),
      name = document.createElement('span'),
      button = document.createElement('button');
    row.className = 'connection-row';
    name.textContent = target.name;
    button.type = 'button';
    button.textContent = connected ? 'Disconnect passage' : 'Connect passage';
    button.onclick = () =>
      run(async () => {
        await rpc('connect_world_rooms', {
          p_world: worldId,
          p_from: room.id,
          p_to: target.id,
          p_connected: !connected,
        });
        await loadMap();
      }, 'Connection saved.');
    row.append(name, button);
    list.append(row);
  }
}

let directoryBusy = false;

async function loadLocations() {
  if (directoryBusy) return;

  directoryBusy = true;
  try {
    const [characters, map, auth] = await Promise.all([
      rpc('world_character_directory', { p_world: worldId }),
      rpc('world_map', { p_world: worldId }),
      supabaseClient.auth.getUser(),
    ]);
    const list = $('admin-locations');
    list.replaceChildren();
    for (const c of characters.filter((c) => c.online)) {
      const row = article(list, c.name + ' · ' + c.player_name + ' · ' + c.room_name);
      const code = document.createElement('small');
      code.textContent = 'Character ID: ' + c.id;
      row.append(code);
    }
    if (!list.children.length) list.textContent = 'No characters connected.';

    optionsFor(
      $('teleport-character'),
      characters
        .filter((c) => c.player_id === auth.data.user?.id)
        .map((c) => ({ id: c.id, label: c.name + ' · ' + c.room_name })),
    );
    optionsFor(
      $('teleport-destination'),
      map.rooms.map((r) => ({ id: r.id, label: r.name })),
    );
  } catch (e) {
    $('admin-status').textContent = e.message;
  } finally {
    directoryBusy = false;
  }
}

$('teleport-form').onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    await rpc('admin_teleport', {
      p_character: $('teleport-character').value,
      p_to: $('teleport-destination').value,
    });
    await loadLocations();
  }, 'Teleported. Your open room view will update.');
};
let badgeData = { definitions: [], awards: [] },
  badgeRequest = null;

async function loadBadges() {
  badgeData = await rpc('world_badge_editor', { p_world: worldId });
  optionsFor(
    $('badge-select'),
    badgeData.definitions.map((b) => ({ id: b.id, label: b.name })),
    'Create a badge',
  );
  optionsFor(
    $('badge-award'),
    badgeData.definitions.map((b) => ({ id: b.id, label: b.name })),
  );
  optionsFor(
    $('badge-player'),
    (panelData?.players || []).map((p) => ({ id: p.id, label: p.name })),
  );
  $('badge-awards').replaceChildren();
  for (const a of badgeData.awards)
    article(
      $('badge-awards'),
      playerName(a.player_id) +
        ' · ' +
        (badgeData.definitions.find((b) => b.id === a.badge_id)?.name || 'Badge'),
    );

  showBadge();
}

function showBadge() {
  const b = badgeData.definitions.find((b) => b.id === $('badge-select').value);
  badgeRequest = null;
  $('badge-name').value = b?.name || '';
  $('badge-color').value = b?.color || '#479663';
  $('badge-description').value = b?.description || '';
  previewBadge();
}

function previewBadge() {
  $('badge-preview').textContent = $('badge-name').value || 'Badge preview';
  $('badge-preview').style.borderColor = $('badge-color').value;
}

$('badge-select').onchange = showBadge;
$('badge-name').oninput = previewBadge;
$('badge-color').oninput = previewBadge;
$('badge-form').onsubmit = (e) => {
  e.preventDefault();
  const id = $('badge-select').value || (badgeRequest ||= crypto.randomUUID());
  run(async () => {
    await rpc('save_world_badge', {
      p_id: id,
      p_world: worldId,
      p_name: $('badge-name').value,
      p_color: $('badge-color').value,
      p_description: $('badge-description').value,
    });
    await loadBadges();
    $('badge-select').value = id;
    showBadge();
  }, 'World badge saved.');
};
$('badge-award-form').onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    await rpc('award_world_badge', {
      p_world: worldId,
      p_badge: $('badge-award').value,
      p_player: $('badge-player').value,
      p_award: $('badge-award-action').value === 'give',
    });
    await loadBadges();
  }, 'World badge updated.');
};
for (const button of document.querySelectorAll('[data-panel]'))
  button.addEventListener('click', () => {
    if (button.dataset.panel === 'locations') loadLocations();
    if (button.dataset.panel === 'badges')
      loadBadges().catch((e) => ($('admin-status').textContent = e.message));
  });

setInterval(() => {
  if (!$('locations').hidden && !document.hidden) loadLocations();
}, 5000);
