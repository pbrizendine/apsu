// Personal layout and scene-preview state stay in this browser; chat never moves.
function createRoomWorkspace({ getWorld, getCharacter, client, openProfile, teleport }) {
  const left = document.querySelector('.room-details'),
    right = document.querySelector('.room-sidebar'),
    columns = [left, right];

  const tile = (id, title, column) => {
    const el = document.createElement('section');
    el.className = 'panel';
    el.dataset.panelId = id;
    const h = document.createElement('h2');
    h.textContent = title;
    el.append(h);
    column.append(el);

    return el;
  };

  const imagine = tile('imagine', 'Imagine', left);
  imagine.insertAdjacentHTML(
    'beforeend',
    '<p>Create your own interpretation of the scene.</p><button type="button" id="open-imagine">Prepare scene</button>',
  );
  const admin = tile('admin', 'Administration', right);
  admin.hidden = true;
  admin.id = 'admin-tile';
  right.prepend(admin);
  const existing = document.getElementById('admin-panel-link');
  admin.append(existing);
  for (const [label, tab] of [
    ['Reports', 'reports'],
    ['Locations & teleport', 'locations'],
    ['World badges', 'badges'],
    ['Admin Chat', 'staffchat'],
    ['Players & warnings', 'moderation'],
    ['Give or place items', 'items'],
    ['Create Room', 'create-rooms'],
    ['Room Editor', 'rooms'],
  ]) {
    const a = document.createElement('a');
    a.className = 'button-link admin-shortcut';
    a.textContent = label;
    a.target = '_blank';
    a.rel = 'noopener';
    a.dataset.adminTab = tab;
    admin.append(a);
  }

  new MutationObserver(() => {
    admin.hidden = existing.hidden;
    for (const a of admin.querySelectorAll('[data-admin-tab]')) {
      a.href = existing.href + '&tab=' + a.dataset.adminTab;
      a.hidden =
        (a.dataset.adminTab === 'rooms' && Number(existing.dataset.rank) < 2) ||
        (a.dataset.adminTab === 'create-rooms' && Number(existing.dataset.rank) < 2);
    }
  }).observe(existing, { attributes: true, attributeFilter: ['hidden', 'href', 'data-rank'] });
  const { panels, restore, defaults, save, status } = createPanelLayout({ left, right });
  const online = document.createElement('button');
  online.type = 'button';
  online.setAttribute('aria-haspopup', 'dialog');
  online.className = 'world-online-count';
  online.textContent = 'Players online · connecting…';
  panels.get('world').insertBefore(online, panels.get('world').querySelector('[data-leave-room]'));
  const onlineDialog = document.createElement('dialog');
  onlineDialog.className = 'workspace-dialog';
  onlineDialog.setAttribute('aria-label', 'Online players in this world');
  onlineDialog.innerHTML =
    '<div class="workspace-dialog-header"><h2>Players online</h2><button type="button">Close</button></div><p role="status"></p><ul class="online-player-list"></ul>';
  document.body.append(onlineDialog);
  onlineDialog.querySelector('button').onclick = () => onlineDialog.close();
  onlineDialog.addEventListener('close', () => online.focus());
  let rosterVersion = 0;
  online.onclick = async () => {
    if (!getCharacter()) return;

    const version = ++rosterVersion,
      worldId = getWorld().id;
    const message = onlineDialog.querySelector('[role=status]'),
      list = onlineDialog.querySelector('ul');
    list.replaceChildren();
    message.textContent = 'Loading online players…';
    onlineDialog.showModal();
    try {
      const { data, error } = await client.rpc('world_online_players', { p_world: worldId });

      if (version !== rosterVersion || !onlineDialog.open) return;
      if (error) throw error;
      for (const player of data || []) {
        const row = document.createElement('li');
        const profile = document.createElement('button');
        profile.type = 'button';
        profile.textContent = player.username;
        profile.onclick = () => {
          onlineDialog.close();
          openProfile(player.player_id);
        };
        row.append(profile);
        const nearby = [
          ...document.querySelectorAll('#room-characters [data-character-id]'),
        ].filter((b) => b.dataset.playerId === player.player_id);

        for (const person of nearby) {
          const characterLink = document.createElement('button');
          characterLink.type = 'button';
          characterLink.textContent = 'Character: ' + person.dataset.characterName;
          characterLink.onclick = () => {
            onlineDialog.close();
            person.click();
          };
          row.append(characterLink);
        }

        list.append(row);
      }

      message.textContent = (data?.length || 0) + ' players online in ' + getWorld().name + '.';
    } catch {
      message.textContent = 'Could not load online players. Close and try again.';
    }
  };
  let counting = false;

  async function updateCount() {
    if (counting || !getCharacter()) return;

    counting = true;
    try {
      const { data, error } = await client.rpc('connected_player_counts');
      online.textContent = error
        ? 'Players online · unavailable'
        : (data?.find((x) => x.world_id === getWorld().id)?.player_count || 0) + ' Players Online';
    } finally {
      counting = false;
    }
  }

  setInterval(updateCount, 15000);
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset panel layout';
  reset.className = 'layout-reset';
  reset.onclick = () => {
    restore(defaults);
    for (const panel of panels.values())
      if (panel.classList.contains('panel-collapsed'))
        panel.querySelector('.panel-minimize').click();

    save();
    status.textContent = 'Default panel layout restored.';
  };
  document.querySelector('.room-banner').append(reset);
  const mapButton = document.createElement('button');
  mapButton.type = 'button';
  mapButton.textContent = 'Expand map ↗';
  document.getElementById('world-map').after(mapButton);
  const smallMap = document.getElementById('world-map');
  smallMap.tabIndex = 0;
  smallMap.setAttribute('role', 'button');
  smallMap.setAttribute('aria-label', 'Open expanded location map');
  smallMap.onclick = () => openMap();
  smallMap.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMap();
    }
  };
  const mapDialog = document.createElement('dialog');
  mapDialog.className = 'workspace-dialog map-dialog';
  mapDialog.setAttribute('aria-labelledby', 'expanded-map-title');
  mapDialog.innerHTML =
    '<div class="workspace-dialog-header"><h2 id="expanded-map-title">Location map</h2><button type="button" id="map-style-toggle" aria-label="Switch to stylized map">Stylized map →</button><button type="button" data-close>Close</button></div><p id="expanded-map-context"></p><div class="expanded-map-layout"><div id="expanded-map" class="expanded-map"></div><div><label>Location<select id="map-room-select"></select></label><h3 id="map-selected-name"></h3><p id="map-selected-description"></p><p id="map-selected-exits"></p></div></div><p>Map overview only. Use Go somewhere to move through connected rooms.</p>';
  document.body.append(mapDialog);
  const uploadControls = document.createElement('div');
  uploadControls.className = 'map-upload-controls';
  uploadControls.hidden = true;
  uploadControls.innerHTML =
    '<label>Upload stylized map (PNG, JPEG or WebP, up to 5 MB)<input type="file" accept="image/png,image/jpeg,image/webp"></label><button type="button">Upload map</button><p role="status"></p>';
  mapDialog.append(uploadControls);
  uploadControls.querySelector('button').onclick = async () => {
    const file = uploadControls.querySelector('input').files[0],
      status = uploadControls.querySelector('p'),
      button = uploadControls.querySelector('button');

    if (!file) return;

    button.disabled = true;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5242880)
        throw Error('Choose a PNG, JPEG or WebP up to 5 MB.');

      const path = getWorld().id + '/' + crypto.randomUUID();
      let result = await client.storage
        .from('world-maps')
        .upload(path, file, { contentType: file.type });

      if (result.error) throw result.error;

      result = await client.rpc('save_world_map_image', { p_world: getWorld().id, p_path: path });
      if (result.error) throw result.error;

      await loadMapImage();
      status.textContent = 'Map uploaded.';
    } catch (e) {
      status.textContent = e.message;
    } finally {
      button.disabled = false;
    }
  };

  async function loadMapImage() {
    const { data, error } = await client
      .from('world_map_images')
      .select('image_path')
      .eq('world_id', getWorld().id)
      .maybeSingle();

    if (error) {
      uploadControls.querySelector('p').textContent =
        'Map uploads need the inventory-map.sql database update.';
      return;
    }

    mapPath = data?.image_path;
    mapUrl = null;
    if (mapPath) {
      const result = await client.storage.from('world-maps').createSignedUrl(mapPath, 3600);
      mapUrl = result.data?.signedUrl;
    }

    renderExpanded();
  }

  let stylized = false,
    selectedRoom = null,
    mapPath = null,
    mapUrl = null;
  const select = mapDialog.querySelector('select');
  select.onchange = () => {
    selectedRoom = select.value;
    renderExpanded();
  };

  function renderExpanded() {
    if (!mapDialog.open) return;

    const world = getWorld(),
      character = getCharacter();

    if (!character) return;

    const rooms = world.rooms;

    if (!rooms[selectedRoom]) selectedRoom = character.location;

    const canvas = mapDialog.querySelector('#expanded-map');
    renderWorldMap(canvas, rooms, character.location);
    canvas.classList.remove('stylized-map');
    canvas.querySelector('svg')?.setAttribute('role', 'group');
    mapDialog.querySelector('#expanded-map-title').textContent = stylized
      ? 'Stylized map'
      : 'Location map';
    const toggle = mapDialog.querySelector('#map-style-toggle');
    toggle.textContent = stylized ? '← Location map' : 'Stylized map →';
    toggle.setAttribute('aria-label', 'Switch to ' + (stylized ? 'location' : 'stylized') + ' map');
    mapDialog.querySelector('#expanded-map-context').textContent =
      world.name +
      ' · ' +
      world.regions[rooms[character.location].regionId].name +
      ' · You are in ' +
      rooms[character.location].name;
    select.replaceChildren();
    for (const [id, room] of Object.entries(rooms)) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = room.name + (id === character.location ? ' (you are here)' : '');
      select.append(o);
    }

    select.value = selectedRoom;
    const r = rooms[selectedRoom];
    mapDialog.querySelector('#map-selected-name').textContent = r.name;
    mapDialog.querySelector('#map-selected-description').textContent = r.description;
    mapDialog.querySelector('#map-selected-exits').textContent =
      'Connections: ' +
      r.exits
        .map((id) => rooms[id]?.name)
        .filter(Boolean)
        .join(', ');
    if (stylized) {
      canvas.replaceChildren();
      if (mapUrl) {
        const img = document.createElement('img');
        img.src = mapUrl;
        img.alt = 'World map for ' + world.name;
        img.className = 'uploaded-world-map';
        canvas.append(img);
      } else {
        canvas.textContent = 'No stylized map has been uploaded yet.';
      }
    }

    mapDialog.querySelector('.map-upload-controls').hidden =
      !stylized || Number(existing.dataset.rank) < 2;
    [...canvas.querySelectorAll('svg g')].forEach((g, i) => {
      const id = Object.keys(rooms)[i];
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', 'Inspect ' + rooms[id].name);

      const choose = () => {
        selectedRoom = id;
        renderExpanded();
        select.focus();
      };

      g.onclick = choose;
      g.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          choose();
        }
      };
    });
  }

  function openMap() {
    selectedRoom = getCharacter()?.location;
    if (!selectedRoom) return;

    mapDialog.showModal();
    renderExpanded();
    loadMapImage();
  }

  mapButton.onclick = openMap;
  mapDialog.querySelector('#map-style-toggle').onclick = () => {
    stylized = !stylized;
    renderExpanded();
  };
  const teleportButton = document.createElement('button');
  teleportButton.type = 'button';
  teleportButton.textContent = 'Teleport here';
  teleportButton.hidden = true;
  mapDialog.querySelector('#map-selected-exits').after(teleportButton);
  teleportButton.onclick = async () => {
    teleportButton.disabled = true;
    try {
      await teleport(selectedRoom);
      mapDialog.close();
    } catch (e) {
      status.textContent = e.message;
      mapDialog.querySelector('#expanded-map-context').textContent = e.message;
    } finally {
      teleportButton.disabled = false;
    }
  };
  new MutationObserver(() => {
    teleportButton.hidden = Number(existing.dataset.rank) < 1;
  }).observe(existing, { attributes: true, attributeFilter: ['data-rank'] });
  mapDialog.querySelector('[data-close]').onclick = () => mapDialog.close();
  const imagineDialog = document.createElement('dialog');
  imagineDialog.className = 'workspace-dialog';
  imagineDialog.setAttribute('aria-labelledby', 'imagine-title');
  imagineDialog.innerHTML =
    '<div class="workspace-dialog-header"><h2 id="imagine-title">Imagine</h2><button type="button" data-close>Close</button></div><p>A private interpretation of the scene. Your character is the focus.</p><fieldset id="imagine-characters"><legend>Include characters present</legend></fieldset><label>Your direction<textarea id="imagine-direction" rows="3" maxlength="1000" placeholder="For example: focus on my character beside the doorway"></textarea></label><button type="button" id="imagine-preview">Build prompt preview</button><p role="status" id="imagine-status"></p><label>Prompt preview<textarea id="imagine-prompt" rows="8" readonly></textarea></label>';
  document.body.append(imagineDialog);
  window.APSUImagine?.attach(imagineDialog, client);
  imagine.querySelector('button#open-imagine').onclick = () => {
    const field = imagineDialog.querySelector('fieldset');
    field.querySelectorAll('label').forEach((l) => l.remove());
    const c = getCharacter();

    if (!c) return;

    const people = new Map([[c.id, c.name]]);
    document
      .querySelectorAll('#room-characters button[data-character-id]')
      .forEach((b) => people.set(b.dataset.characterId, b.dataset.characterName));
    for (const [id, name] of people) {
      const label = document.createElement('label'),
        check = document.createElement('input');
      check.type = 'checkbox';
      check.value = id;
      check.dataset.name = name;
      check.checked = id === c.id;
      label.append(check, document.createTextNode(' ' + name + (id === c.id ? ' (you)' : '')));
      field.append(label);
    }

    imagineDialog.querySelector('#imagine-prompt').value = '';
    imagineDialog.querySelector('#imagine-status').textContent = '';
    imagineDialog.showModal();
  };
  imagineDialog.querySelector('[data-close]').onclick = () => imagineDialog.close();
  imagineDialog.querySelector('#imagine-preview').onclick = async () => {
    const button = imagineDialog.querySelector('#imagine-preview'),
      status = imagineDialog.querySelector('#imagine-status'),
      c = getCharacter();

    if (!c) return;

    const location = c.location,
      selected = [...imagineDialog.querySelectorAll('#imagine-characters input:checked')];
    button.disabled = true;
    status.textContent = 'Preparing descriptions…';
    try {
      const descriptions = [];

      for (const input of selected) {
        const { data, error } = await client.rpc('character_profile', { p_character: input.value });

        if (error || !data) throw Error('Could not load character descriptions.');

        descriptions.push({
          name: data.name,
          description: data.description,
          focus: input.value === c.id,
        });
      }
      if (getCharacter()?.location !== location)
        throw Error('You changed rooms. Reopen Imagine to update the scene.');

      const room = getWorld().rooms[location];
      imagineDialog.querySelector('#imagine-prompt').value = buildImaginePrompt(
        room,
        descriptions,
        imagineDialog.querySelector('#imagine-direction').value,
      );
      status.textContent = 'Preview ready. No image has been generated.';
    } catch (e) {
      status.textContent = e.message;
    } finally {
      button.disabled = false;
    }
  };

  return {
    refresh: () => {
      renderExpanded();
      updateCount();
    },
  };
}

function buildImaginePrompt(room, characters, direction) {
  return [
    'Create an atmospheric illustration of a roleplaying scene. This is an interpretation, not authoritative world state.',
    'Location: ' + room.name,
    'Environment: ' + room.description,
    ...characters.map(
      (c) =>
        (c.focus ? 'Main focus — ' : 'Supporting character — ') +
        c.name +
        ': ' +
        (c.description || 'Appearance unspecified; do not imply these details are established.'),
    ),
    direction.trim() ? 'Player direction: ' + direction.trim() : '',
    'Preserve the described appearances. Do not depict hidden information.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// The bottom edge resizes the whole chat panel; the writing area has its own handle.
(() => {
  const panel = document.querySelector('.room-chat');

  if (!panel) return;

  const handle = document.createElement('div');
  handle.className = 'chat-resize-handle';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', 'Resize chat height');
  handle.setAttribute('aria-orientation', 'horizontal');
  handle.setAttribute('aria-valuemin', '500');
  handle.setAttribute('aria-valuemax', '1600');
  handle.title = 'Drag to resize chat. Arrow keys resize when focused.';
  panel.append(handle);
  let height = Math.max(500, window.innerHeight - 220),
    drag = null;

  try {
    height = Number(APSUStorage.getItem('apsu-chat-height')) || height;
  } catch {}

  const set = (value, save = false) => {
    height = Math.max(500, Math.min(1600, value));
    panel.style.setProperty('--chat-height', height + 'px');
    handle.setAttribute('aria-valuenow', String(Math.round(height)));
    if (save)
      try {
        APSUStorage.setItem('apsu-chat-height', String(height));
      } catch {}
  };

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;

    event.preventDefault();
    drag = { id: event.pointerId, y: event.clientY, height: panel.getBoundingClientRect().height };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (drag?.id === event.pointerId) set(drag.height + event.clientY - drag.y);
  });

  const finish = () => {
    if (drag) set(height, true);

    drag = null;
  };

  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
  handle.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;

    event.preventDefault();
    set(panel.getBoundingClientRect().height + (event.key === 'ArrowUp' ? -20 : 20), true);
  });
  // A taller draft/image preview must not cover the send controls.

  const fitControls = () => {
    const style = getComputedStyle(panel);
    let minimum = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 2;

    for (const child of panel.children) {
      const childStyle = getComputedStyle(child);

      if (child === handle || childStyle.display === 'none') continue;

      minimum += child.id === 'chat-messages' ? 100 : child.getBoundingClientRect().height;
      minimum += parseFloat(childStyle.marginTop) + parseFloat(childStyle.marginBottom);
    }

    panel.style.minHeight = Math.max(500, Math.ceil(minimum)) + 'px';
  };

  const sizing = new ResizeObserver(fitControls);
  sizing.observe(document.getElementById('chat-form'));
  sizing.observe(document.querySelector('.chat-tools'));
  window.addEventListener('resize', fitControls);
  set(height);
  fitControls();
})();
