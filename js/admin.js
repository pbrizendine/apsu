const worldId = new URLSearchParams(location.search).get('world') || 'alska-mogue';

const $ = (id) => document.getElementById(id);

let panelData,
  mapData,
  busy = false,
  refreshing = false,
  loaded = false;

async function rpc(name, args) {
  const r = await window.APSUDatabase.call(supabaseClient, name, args);

  if (r.error) throw r.error;

  return r.data;
}

function article(parent, text) {
  const a = document.createElement('article');
  a.textContent = text;
  parent.append(a);

  return a;
}

function playerName(id) {
  return panelData.players.find((p) => p.id === id)?.name || 'Player';
}

function targetLink() {
  $('target-profile').href = 'profile.html?id=' + encodeURIComponent($('target').value);
}

let warningRequest = 0;

async function loadTargetWarnings() {
  const target = $('target').value,
    request = ++warningRequest,
    list = $('target-warnings');
  list.textContent = 'Loading warnings…';
  try {
    const warnings = await rpc('player_world_warnings', { p_world: worldId, p_user: target });

    if (request !== warningRequest) return;

    list.replaceChildren();
    if (!warnings.length) list.textContent = 'No warnings in this world.';
    for (const warning of warnings)
      article(list, new Date(warning.created_at).toLocaleString() + ' · ' + warning.reason);
  } catch {
    if (request === warningRequest) list.textContent = 'Warnings unavailable.';
  }
}

async function refresh() {
  if (refreshing) return;

  refreshing = true;
  try {
    panelData = await rpc('admin_panel', { p_world: worldId });
    $('admin-content').hidden = false;
    $('admin-world').textContent =
      worldId +
      ' · ' +
      (panelData.rank === 4
        ? 'APSU Founder'
        : panelData.rank === 3
          ? 'World Owner'
          : panelData.rank === 2
            ? 'Lead Admin'
            : 'Admin');
    document.querySelectorAll('[data-founder]').forEach((e) => (e.hidden = panelData.rank !== 4));
    document.querySelectorAll('[data-lead]').forEach((e) => (e.hidden = panelData.rank < 2));
    if (panelData.rank < 2) $('create-rooms').hidden = true;

    document.querySelectorAll('[data-owner]').forEach((e) => (e.hidden = panelData.rank < 3));
    if (panelData.rank < 3) {
      if (panelData.rank < 2) $('rooms').hidden = true;
      if (['grant_admin', 'grant_lead', 'grant_owner', 'remove_admin'].includes($('action').value))
        $('action').value = 'warn';
    }

    const selected = $('target').value;
    $('target').replaceChildren();
    for (const p of panelData.players) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name + (p.online ? ' · online' : '') + (p.rank ? ' · staff' : '');
      $('target').append(o);
    }
    if (panelData.players.some((p) => p.id === selected)) $('target').value = selected;

    targetLink();
    loadTargetWarnings();
    $('actions').replaceChildren();
    for (const a of panelData.actions)
      article(
        $('actions'),
        new Date(a.created_at).toLocaleString() +
          ' · ' +
          playerName(a.actor) +
          ' · ' +
          a.action +
          (a.target ? ' · ' + playerName(a.target) : '') +
          '\n' +
          a.reason,
      );

    $('report-list').replaceChildren();
    if (!panelData.reports.length) $('report-list').textContent = 'No reports yet.';
    for (const r of panelData.reports) {
      const item = article(
        $('report-list'),
        playerName(r.player_id) + ' · ' + new Date(r.created_at).toLocaleString() + '\n' + r.body,
      );

      if (r.resolved) {
        item.append(document.createTextNode('\nResolved'));
      } else {
        const b = document.createElement('button');
        b.textContent = 'Mark resolved';
        b.onclick = () =>
          run(() => rpc('resolve_report', { p_world: worldId, p_id: r.id }), 'Report resolved.');
        item.append(b);
      }
    }

    const chat = $('staff-messages'),
      atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
    chat.replaceChildren();
    for (const m of [...panelData.chat].reverse())
      article(
        chat,
        m.username + ' · ' + new Date(m.created_at).toLocaleTimeString() + '\n' + m.body,
      );
    if (atBottom) chat.scrollTop = chat.scrollHeight;
    if (!loaded) {
      $('admin-status').textContent = '';
      loaded = true;
      const tab = new URLSearchParams(location.search).get('tab');

      for (const button of document.querySelectorAll('[data-panel]'))
        if (
          button.dataset.panel === tab &&
          (tab !== 'rooms' || panelData.rank >= 2) &&
          (tab !== 'create-rooms' || panelData.rank >= 2)
        )
          button.click();
    }
  } catch (error) {
    $('admin-content').hidden = true;
    $('admin-status').textContent = error.message || 'Could not load admin panel.';
  } finally {
    refreshing = false;
  }
}

async function run(action, success) {
  if (busy) return;

  busy = true;
  $('admin-status').textContent = 'Saving…';
  try {
    await action();
    await refresh();
    $('admin-status').textContent = success;
  } catch (e) {
    $('admin-status').textContent = e.message || 'Could not save. Please try again.';
  } finally {
    busy = false;
  }
}

document.querySelectorAll('[data-panel]').forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll('[data-panel]')
        .forEach((tab) => tab.setAttribute('aria-pressed', String(tab === b)));
      document
        .querySelectorAll('.admin-section')
        .forEach((s) => (s.hidden = s.id !== b.dataset.panel));
      if (b.dataset.panel === 'create-rooms')
        loadCreateMap().catch((e) => ($('admin-status').textContent = e.message));
      if (b.dataset.panel === 'items')
        loadSpawnMap().catch((e) => ($('admin-status').textContent = e.message));
      if (b.dataset.panel === 'rooms')
        loadMap().catch((e) => ($('admin-status').textContent = e.message));
    }),
);
$('target').onchange = () => {
  targetLink();
  loadTargetWarnings();
};
$('action').onchange = () => {
  $('duration-label').hidden = !['ban', 'mute'].includes($('action').value);
  $('duration').required = $('action').value === 'mute';
};
let pendingAction = null;
$('moderate').onsubmit = async (event) => {
  event.preventDefault();
  if (busy) return;

  const action = $('action').value,
    target = $('target').value,
    reason = $('reason').value.trim();

  if (!target || !reason) return;
  if (
    !(await APSUUI.confirm({
      title: 'Confirm ' + action.replaceAll('_', ' '),
      message:
        'Apply this action to ' + playerName(target) + ' in ' + worldId + '? Reason: ' + reason,
      confirmLabel: 'Apply action',
    }))
  )
    return;

  const args = {
    p_world: worldId,
    p_action: action,
    p_target: target,
    p_reason: reason,
    p_minutes:
      ['ban', 'mute'].includes(action) && $('duration').value ? Number($('duration').value) : null,
  };
  const signature = JSON.stringify(args);

  if (!pendingAction || pendingAction.signature !== signature)
    pendingAction = { signature, id: crypto.randomUUID() };

  await run(async () => {
    await rpc('moderation_action', { ...args, p_id: pendingAction.id });
    pendingAction = null;
  }, 'Action saved.');
};
let pendingChat = null;
$('staff-form').onsubmit = (event) => {
  event.preventDefault();
  const body = $('staff-body').value.trim();

  if (!body) return;
  if (!pendingChat || pendingChat.body !== body) pendingChat = { id: crypto.randomUUID(), body };

  const attempt = pendingChat;
  run(async () => {
    await rpc('admin_chat', { p_id: attempt.id, p_world: worldId, p_body: body });
    if ($('staff-body').value.trim() === body) $('staff-body').value = '';

    pendingChat = null;
  }, 'Message sent.');
};

async function loadMap() {
  mapData = await rpc('world_map', { p_world: worldId });
  const previous = $('room-select').value;
  $('room-select').replaceChildren();
  for (const r of mapData.rooms) {
    const o = document.createElement('option');
    o.value = r.id;
    o.textContent = r.name;
    $('room-select').append(o);
  }
  if (mapData.rooms.some((r) => r.id === previous)) $('room-select').value = previous;

  await loadRoomOwners('room-owner');
  showRoom();
}

const objectAppearances = new Map();

function objectEditor(item = { name: '', description: '', script: 'custom' }) {
  const box = document.createElement('div');
  box.className = 'object-editor';
  box.dataset.objectId = item.id || crypto.randomUUID();
  const typeLabel = document.createElement('label');
  typeLabel.textContent = 'Item / script';
  const type = document.createElement('select');
  type.dataset.field = 'script';
  for (const [value, label] of [
    ['custom', 'Custom item · can be picked up'],
    ['none', 'Scenery · cannot be picked up'],
    ['lockpick-full', 'Lockpick · full (100%)'],
    ['lockpick-damaged', 'Lockpick · damaged (50%)'],
    ['lockpick-broken', 'Lockpick · broken (0%)'],
    ['room-c-key', 'Key · Room C door'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    type.append(option);
  }

  type.value = item.script || 'none';
  typeLabel.append(type);
  box.append(typeLabel);
  type.onchange = () => {
    const name = box.querySelector('[data-field=name]');

    if (!name.value.trim() && !['custom', 'none'].includes(type.value))
      name.value = type.selectedOptions[0].textContent;
  };
  for (const [key, label, max] of [
    ['name', 'Name', 80],
    ['description', 'Description', 1000],
  ]) {
    const l = document.createElement('label');
    l.textContent = label;
    const i = document.createElement(key === 'name' ? 'input' : 'textarea');
    i.dataset.field = key;
    i.value = item[key] || '';
    i.maxLength = max;
    i.required = key === 'name';
    l.append(i);
    box.append(l);
  }

  const appearance = createItemAppearanceEditor(box, item);
  objectAppearances.set(box, appearance);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remove object';
  remove.onclick = () => {
    appearance.dispose();
    objectAppearances.delete(box);
    box.remove();
  };
  box.append(remove);
  $('object-editors').append(box);
}

async function showRoom() {
  const r = mapData.rooms.find((r) => r.id === $('room-select').value);

  if (!r) return;

  $('room-owner').value = r.owner_character || '';
  renderConnectionEditor(r);
  const door = mapData.doors?.find((d) => d.door_id === r.id);
  $('door-enabled').checked = !!door?.enabled;
  $('door-outside').replaceChildren();
  for (const edge of mapData.connections.filter((e) => e.from_room === r.id)) {
    const o = document.createElement('option');
    o.value = edge.to_room;
    o.textContent = mapData.rooms.find((x) => x.id === edge.to_room)?.name || edge.to_room;
    $('door-outside').append(o);
  }
  if (door?.outside_room) $('door-outside').value = door.outside_room;

  $('room-title').value = r.name;
  $('region-title').value = mapData.regions.find((x) => x.id === r.region_id).name;
  $('room-description').value = r.description;
  $('room-image').value = '';
  for (const editor of objectAppearances.values()) editor.dispose();

  objectAppearances.clear();
  $('object-editors').replaceChildren();
  (r.objects || []).forEach(objectEditor);
  $('room-image-preview').hidden = true;
  if (r.image_path) {
    const result = await supabaseClient.storage
      .from('room-images')
      .createSignedUrl(r.image_path, 3600);

    if (result.data && $('room-select').value === r.id) {
      $('room-image-preview').src = result.data.signedUrl;
      $('room-image-preview').hidden = false;
    }
  }
}

$('room-select').onchange = showRoom;
$('add-object').onclick = () => {
  if ($('object-editors').children.length < 20) objectEditor();
  else $('admin-status').textContent = 'Maximum 20 objects per room.';
};
$('room-form').onsubmit = (event) => {
  event.preventDefault();
  const room = mapData.rooms.find((r) => r.id === $('room-select').value),
    file = $('room-image').files[0],
    name = $('room-title').value.trim(),
    region = $('region-title').value.trim(),
    description = $('room-description').value,
    objects = [...$('object-editors').children].map((b) => ({
      id: b.dataset.objectId,
      script: b.querySelector('[data-field=script]').value,
      name: b.querySelector('[data-field=name]').value.trim(),
      description: b.querySelector('[data-field=description]').value,
    }));
  const objectBoxes = [...$('object-editors').children];
  run(async () => {
    for (let i = 0; i < objects.length; i++)
      Object.assign(objects[i], await objectAppearances.get(objectBoxes[i]).value());

    let path = room.image_path;

    if (file) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5242880)
        throw Error('Choose a JPEG, PNG or WebP up to 5 MB.');

      path = worldId + '/' + crypto.randomUUID();
      const result = await supabaseClient.storage
        .from('room-images')
        .upload(path, file, { contentType: file.type });

      if (result.error) throw result.error;
    }

    await rpc('save_room_details', {
      p_owner: $('room-owner').value || null,
      p_world: worldId,
      p_room: room.id,
      p_name: name,
      p_region: region,
      p_description: description,
      p_objects: objects,
      p_image: path,
      p_enabled: $('door-enabled').checked,
      p_outside: $('door-outside').value || null,
    });
    await loadMap();
  }, 'Room saved. Connected players will see the changes shortly.');
};
supabaseClient.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') location.replace('login.html');
});
// Wait for the tools script before opening a requested panel.
document.addEventListener('DOMContentLoaded', () => refresh(), { once: true });
setInterval(() => {
  if (!busy && !document.hidden) refresh();
}, 5000);

async function loadSpawnMap() {
  const [data, characters] = await Promise.all([
    rpc('world_map', { p_world: worldId }),
    rpc('world_character_directory', { p_world: worldId }),
  ]);
  optionsFor(
    $('spawn-character'),
    characters.map((c) => ({
      id: c.id,
      label: c.player_name + ' · ' + c.name + (c.online ? ' · online' : ''),
    })),
    'Choose a character',
  );
  for (const id of ['spawn-room', 'spawn-key-room']) {
    const selected = $(id).value;
    $(id).replaceChildren();
    for (const room of data.rooms) {
      if (id === 'spawn-key-room' && !data.doors?.some((d) => d.door_id === room.id && d.enabled))
        continue;

      const o = document.createElement('option');
      o.value = room.id;
      o.textContent = room.name;
      $(id).append(o);
    }
    if ([...$(id).options].some((o) => o.value === selected)) $(id).value = selected;
  }
}

$('spawn-kind').onchange = () => {
  $('spawn-key-room').disabled = $('spawn-kind').value !== 'key';
};
let pendingSpawn = null;
$('spawn-form').onsubmit = (event) => {
  event.preventDefault();
  const args = {
    p_world: worldId,
    p_room: $('spawn-destination').value === 'room' ? $('spawn-room').value : null,
    p_character: $('spawn-destination').value === 'character' ? $('spawn-character').value : null,
    p_kind: $('spawn-kind').value,
    p_quantity: Number($('spawn-quantity').value),
    p_key_room: $('spawn-kind').value === 'key' ? $('spawn-key-room').value : null,
  };

  if (!Number.isInteger(args.p_quantity) || args.p_quantity < 1 || args.p_quantity > 100) {
    $('admin-status').textContent = 'Enter a quantity from 1 to 100.';
    return;
  }

  const custom = $('spawn-kind').value === 'custom';
  const metadata = {
    name: custom ? $('spawn-name').value.trim() : '',
    description: custom ? $('spawn-description').value : '',
  };

  if ((!args.p_room && !args.p_character) || (custom && !metadata.name)) {
    $('admin-status').textContent = 'Choose a destination and enter a name for your custom item.';
    return;
  }

  run(async () => {
    args.p_item = { ...metadata, ...(await spawnAppearance.value()) };
    const signature = JSON.stringify(args);

    if (!pendingSpawn || pendingSpawn.signature !== signature)
      pendingSpawn = { signature, id: crypto.randomUUID() };

    await rpc('admin_issue_items', { ...args, p_request: pendingSpawn.id });
    pendingSpawn = null;
  }, 'Items delivered. Recorded in moderation history.');
};

let createMap,
  pendingRoom = null;

async function loadCreateMap() {
  createMap = await rpc('world_map', { p_world: worldId });
  const selected = $('new-room-anchor').value;
  $('new-room-anchor').replaceChildren();
  for (const room of createMap.rooms) {
    const option = document.createElement('option');
    option.value = room.id;
    option.textContent = room.name;
    $('new-room-anchor').append(option);
  }
  if (createMap.rooms.some((room) => room.id === selected)) $('new-room-anchor').value = selected;

  await loadRoomOwners('new-room-owner');
  showPlacement();
}

function showPlacement() {
  const anchor = createMap?.rooms.find((room) => room.id === $('new-room-anchor').value);

  if (!anchor) return;

  const [dx, dy] = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[
    $('new-room-direction').value
  ];
  const occupied = createMap.rooms.find(
    (room) => room.map_x === anchor.map_x + dx && room.map_y === anchor.map_y + dy,
  );
  $('new-room-placement').textContent = occupied
    ? 'That position is occupied by ' + occupied.name + '. Choose another direction.'
    : 'This position is available. Connected players will see the map update shortly.';
  $('create-room-form').querySelector('button[type="submit"]').disabled = !!occupied;
}

$('new-room-anchor').onchange = showPlacement;
$('new-room-direction').onchange = showPlacement;
$('create-room-form').onsubmit = (event) => {
  event.preventDefault();
  const args = {
    p_world: worldId,
    p_anchor: $('new-room-anchor').value,
    p_direction: $('new-room-direction').value,
    p_name: $('new-room-name').value.trim(),
    p_description: $('new-room-description').value.trim(),
    p_owner: $('new-room-owner').value || null,
  };

  if (!args.p_name || !args.p_anchor) {
    $('admin-status').textContent = 'Enter a location name and choose an existing room.';
    return;
  }

  const signature = JSON.stringify(args);

  if (!pendingRoom || pendingRoom.signature !== signature)
    pendingRoom = { signature, id: crypto.randomUUID() };

  run(async () => {
    await rpc('create_owned_world_room', { ...args, p_request: pendingRoom.id });
    pendingRoom = null;
    $('new-room-name').value = '';
    $('new-room-description').value = '';
    await loadCreateMap();
  }, 'Room created with a two-way passage. Recorded in moderation history.');
};
