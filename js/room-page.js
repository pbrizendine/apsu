// Supabase supplies the player identity after we verify the login.
let player = null;
const roomChat = createRoomChat(supabaseClient);

// Rooms, their connections, and locks belong to the world.
const world = {
  id: 'alska-mogue',
  name: 'Alska Mogue',
  regions: { moonCrossing: { name: 'Moon Crossing' } },
  rooms: {
    roomA: {
      name: 'Room A',
      regionId: 'moonCrossing',
      description: 'Description of Room A.',
      exits: ['roomB'],
    },
    roomB: {
      name: 'Room B',
      regionId: 'moonCrossing',
      description: 'Description of Room B.',
      exits: ['roomA', 'roomC'],
    },
    roomC: {
      name: 'Room C',
      regionId: 'moonCrossing',
      description: 'Description of Room C.',
      exits: ['roomB'],
      locked: true,
    },
  },
};

// Loaded from Supabase after verifying its owner and world.
let character = null;
let doors = [];

function hasKey(door) {
  return items.some(
    (i) => ['key', 'room-c-key'].includes(i.kind) && (i.key_room || 'roomC') === door,
  );
}

function doorBetween(from, to) {
  return doors.find(
    (d) =>
      (d.inside_room === to && d.outside_room === from) ||
      (d.inside_room === from && d.outside_room === to),
  );
}

// These variables track the popup, not saved player or world data.
let items = [];
let itemBusy = false;
let wearSave = Promise.resolve();
let wearFailed = false;
let lockToken = null;
let idleTimer = null;
let leaseTimer = null;
let lastLockActivity = 0;
let lastLeaseRequest = 0;
let renewingLease = false;
let completingLock = false;
let pendingRoom = null;
let lockpickFrame = null;
let lockpickBroke = false;
let insertedPickId = null;
let cancelingLock = false;
let failureTimer = null;
const lockpickDialog = document.getElementById('lockpick-dialog');
const lockpickContainer = document.getElementById('lockpick-container');
// Gameplay notices are private entries in this user's chat, never broadcasts.
const lockStatus = {
  set textContent(text) {
    if (text) roomChat.addSystem(text);
  },
};
const lockRoomButton = document.getElementById('lock-room-button');
const unlockRoomButton = document.getElementById('unlock-room-button');

// Display the current room and build a button for each available exit.
function renderRoom() {
  roomChat.showRoom(character);
  document.getElementById('world-name').textContent =
    world.name + ' / ' + world.regions[world.rooms[character.location].regionId].name;
  const room = world.rooms[character.location];
  document.getElementById('room-name').textContent = room.name;

  document.getElementById('surroundings-description').textContent = room.description;
  document.getElementById('room-owner').textContent = room.ownerName
    ? 'Owned by ' + room.ownerName
    : 'No character owner';
  const image = document.getElementById('surroundings-image');
  image.hidden = true;
  if (room.imagePath)
    supabaseClient.storage
      .from('room-images')
      .createSignedUrl(room.imagePath, 3600)
      .then(({ data }) => {
        if (data && world.rooms[character.location] === room) {
          image.src = data.signedUrl;
          image.hidden = false;
        }
      });

  const objects = document.getElementById('room-objects');
  objects.replaceChildren();
  for (const object of room.objects || []) {
    const box = document.createElement('article'),
      title = document.createElement('strong'),
      description = document.createElement('p');
    title.textContent = object.name;
    description.textContent = object.description;
    box.append(APSUItems.visual(object, supabaseClient), title, description);
    if (object.script && object.script !== 'none') {
      const pickup = document.createElement('button');
      pickup.type = 'button';
      pickup.textContent = 'Pick up';
      pickup.onclick = async () => {
        if (itemBusy) return;

        itemBusy = true;
        pickup.disabled = true;
        try {
          const { error } = await supabaseClient.rpc('pickup_room_object', {
            p_character: character.id,
            p_object: object.id,
          });

          if (error) throw error;

          await loadItems();
          renderItems();
          roomChat.addSystem('Picked up ' + object.name + '.');
          await refreshWorldMap();
        } catch (error) {
          roomChat.addSystem(error.message || 'Could not pick up item.');
        } finally {
          itemBusy = false;
          pickup.disabled = false;
        }
      };
      box.append(pickup);
    }

    objects.append(box);
  }

  renderWorldMap(document.getElementById('world-map'), world.rooms, character.location, {
    nearby: true,
  });
  workspace.refresh();
  const exitsContainer = document.getElementById('room-exits');
  exitsContainer.replaceChildren();

  for (const destination of room.exits) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = world.rooms[destination].name;
    button.addEventListener('click', function () {
      moveToRoom(destination);
    });
    exitsContainer.appendChild(button);
  }

  lockStatus.textContent = '';
  renderItems();
  roomOwnerEditor.refresh();
}

async function moveToRoom(destination) {
  if (!player || !character || pendingRoom !== null || itemBusy) return;

  const movingCharacter = character;
  itemBusy = true;
  let lockedOutside = null;

  try {
    const { data, error } = await supabaseClient.rpc('save_character_location', {
      p_character: character.id,
      p_from: character.location,
      p_to: destination,
    });

    if (leavingPage || character !== movingCharacter) return;
    if (error) {
      if (error.message === 'The door is locked') {
        const door = doorBetween(character.location, destination);
        lockedOutside = door && character.location === door.outside_room ? door.door_id : null;
        if (!lockedOutside)
          lockStatus.textContent =
            'The door to ' +
            (world.rooms[door?.inside_room]?.name || 'that room') +
            ' is locked. Use its matching key to unlock it from inside.';
      } else lockStatus.textContent = 'Could not move. ' + error.message;

      return;
    }

    character.location = data;
    renderRoom();
  } catch {
    lockStatus.textContent = 'Could not confirm movement. Reload to check your saved room.';
  } finally {
    itemBusy = false;
    await syncRoom();
    if (lockedOutside && !leavingPage) {
      try {
        await loadItems();
        openLockpick(lockedOutside);
      } catch {
        lockStatus.textContent = 'Could not check your inventory.';
      }
    }
  }
}

let moderation = null;
let snapshotBusy = false,
  peopleSignature = '';

async function syncRoom() {
  if (!character || leavingPage || snapshotBusy || itemBusy || completingLock) return;

  snapshotBusy = true;
  const currentCharacter = character,
    previousRoom = character.location;

  try {
    const { data, error } = await supabaseClient.rpc('room_snapshot', {
      p_character: character.id,
    });

    if (error) throw error;
    if (
      leavingPage ||
      character !== currentCharacter ||
      itemBusy ||
      completingLock ||
      character.location !== previousRoom
    )
      return;

    const moved = character.location !== data.room_id;
    const changed = JSON.stringify(doors) !== JSON.stringify(data.doors || []);
    character.location = data.room_id;
    doors = data.doors || [];
    if (pendingRoom && (moved || !doors.find((d) => d.door_id === pendingRoom)?.locked)) {
      closeLockpick();
      roomChat.addSystem(
        moved
          ? 'Your location changed. The lock session ended.'
          : 'The door was unlocked. Your lock session ended.',
      );
    }
    if (moved || changed) renderRoom();
    if (!pendingRoom && !inventoryUI.isBusy()) {
      const previous = JSON.stringify(items);
      await loadItems();
      if (previous !== JSON.stringify(items)) renderItems();
    }

    inventoryUI.refreshGround();
    const list = document.getElementById('room-characters');
    const signature =
      JSON.stringify(data.characters) +
      JSON.stringify(data.characters.map((p) => moderation?.roleFor(p.id)));

    if (signature !== peopleSignature) {
      peopleSignature = signature;
      list.replaceChildren();
      for (const person of data.characters) {
        const row = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.characterId = person.id;
        button.dataset.playerId = person.player_id;
        button.dataset.characterName = person.name;
        button.dataset.chatNumber = person.number;
        button.className = 'character-presence';
        const avatar = document.createElement('span');
        avatar.className = 'avatar-frame room-avatar';
        avatar.textContent = person.name.slice(0, 1).toUpperCase();
        if (person.portrait) loadRoomPortrait(avatar, person);

        const label = document.createElement('span');
        label.textContent = (person.number ? '[' + person.number + '] ' : '') + person.name;
        button.append(avatar, label);
        if (person.typing && person.id !== character.id) {
          const hint = document.createElement('small');
          hint.className = 'typing-indicator';
          hint.textContent = 'is typing…';
          button.append(hint);
        }

        const role = moderation?.roleFor(person.id)?.replace('Server Owner', 'World Owner');

        if (role) {
          button.classList.add('staff-name');

          button.title = role;
        }

        button.setAttribute('aria-haspopup', 'dialog');
        button.addEventListener('click', () =>
          openPlayerPreview({ p_character: person.id }, person.name),
        );
        row.appendChild(button);
        list.appendChild(row);
      }
    }

    document.getElementById('presence-status').textContent = data.characters.length
      ? ''
      : 'No connected characters yet.';
  } catch {
    document.getElementById('presence-status').textContent = 'Could not refresh room information.';
  } finally {
    snapshotBusy = false;
  }
}

setInterval(syncRoom, 3000);

async function openLockpick(destination) {
  if (wearFailed) {
    lockStatus.textContent = 'Reload to verify your lockpick condition before another attempt.';
    return;
  }
  if (pendingRoom !== null || !character || cancelingLock) return;

  pendingRoom = destination;
  const openingCharacter = character.id;

  try {
    const { data: token, error } = await supabaseClient.rpc('acquire_door_use', {
      p_character: openingCharacter,
      p_door: destination,
    });

    if (error) throw error;
    if (
      leavingPage ||
      !character ||
      character.id !== openingCharacter ||
      pendingRoom !== destination
    ) {
      if (token) await supabaseClient.rpc('release_lock_use', { p_token: token });

      return;
    }
    if (!token) {
      pendingRoom = null;
      lockStatus.textContent = 'Someone is using the lock.';
      return;
    }

    lockToken = token;
  } catch {
    pendingRoom = null;
    lockStatus.textContent = 'Could not reserve the lock. Please try again.';
    return;
  }

  lockpickBroke = false;
  insertedPickId = null;
  lockpickDialog.setAttribute(
    'aria-label',
    'Door to ' + (world.rooms[destination]?.name || destination),
  );
  lockpickDialog.showModal();

  // An iframe keeps the mechanic's styles and keys separate from the room page.
  lockpickFrame = document.createElement('iframe');
  lockpickFrame.title = 'Lockpicking mechanic';
  const picks = items.filter((item) => item.kind === 'lockpick' && item.capacity > 0).slice(0, 3);
  const matchingKey = hasKey(destination);
  const params = new URLSearchParams({
    picks: JSON.stringify(
      picks.map((item) => ({ id: item.id, capacity: item.capacity, slot: item.slot })),
    ),
    key: matchingKey ? '1' : '0',
    difficulty: 'moderate',
  });
  lockpickFrame.src = 'lockpick.html?' + params.toString();
  lockpickFrame.addEventListener('load', function () {
    if (lockpickFrame) lockpickFrame.focus();
  });
  lockpickContainer.appendChild(lockpickFrame);
  recordLockActivity();
  leaseTimer = setInterval(renewLockLease, 5000);
}

function recordLockActivity() {
  if (!lockToken || completingLock) return;
  // Don't allow a delayed input event to revive an already idle attempt.
  if (lastLockActivity && Date.now() - lastLockActivity >= 30000) {
    expireLockAttempt();
    return;
  }

  lastLockActivity = Date.now();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(expireLockAttempt, 30000);
  // Renew promptly when a player resumes just before expiry.
  if (Date.now() - lastLeaseRequest >= 1000) renewLockLease();
}

function expireLockAttempt() {
  if (!lockToken) return;

  cancelLockpick('Canceled after 30 seconds of inactivity.');
}

async function renewLockLease() {
  if (!lockToken || renewingLease || completingLock) return;

  const token = lockToken;
  const idle = Date.now() - lastLockActivity;

  if (idle >= 30000) {
    expireLockAttempt();
    return;
  }

  renewingLease = true;
  lastLeaseRequest = Date.now();
  try {
    const { data, error } = await supabaseClient.rpc('renew_lock_use', {
      p_token: token,
      p_idle_ms: idle,
    });

    if (lockToken !== token || completingLock) return;
    if (error || !data) {
      closeLockpick();
      lockStatus.textContent = 'The lock session ended. Please try again.';
    }
  } catch {
    if (lockToken === token && !completingLock) {
      closeLockpick();
      lockStatus.textContent = 'The lock session ended. Please try again.';
    }
  } finally {
    renewingLease = false;
  }
}

function closeLockpick() {
  const token = lockToken;
  insertedPickId = null;
  lockToken = null;
  lastLockActivity = 0;
  completingLock = false;
  clearTimeout(idleTimer);
  clearInterval(leaseTimer);
  // A disconnected browser's reservation also expires on the server.
  if (token)
    Promise.resolve(supabaseClient.rpc('release_lock_use', { p_token: token })).catch(() => {});

  clearTimeout(failureTimer);
  failureTimer = null;
  pendingRoom = null;
  lockpickFrame = null;
  // Removing the iframe stops its animation and discards the attempt.
  lockpickContainer.replaceChildren();
  lockpickDialog.close();
}

async function cancelLockpick(reason = '') {
  if (cancelingLock || completingLock || !lockpickFrame) return;

  cancelingLock = true;
  const broke = !!insertedPickId && !lockpickBroke;

  if (broke) {
    lockpickBroke = true;
    saveWear(insertedPickId, 0);
  }
  // Stop accepting iframe messages immediately, while the saved wear finishes.

  closeLockpick();
  await wearSave;
  cancelingLock = false;
  if (wearFailed) {
    lockStatus.textContent = 'Could not save lockpick wear. Reload before another attempt.';
    return;
  }
  if (broke) lockStatus.textContent = 'Your lockpick broke.';
  else if (typeof reason === 'string' && reason) lockStatus.textContent = reason;
}

document.getElementById('cancel-lockpick').addEventListener('click', cancelLockpick);
lockpickDialog.addEventListener('cancel', function (event) {
  event.preventDefault();
  cancelLockpick();
});

window.addEventListener('message', async function (event) {
  // Accept results only from the currently open mechanic, not other windows.
  // Local file pages have an opaque origin, so check the sending window.
  if (!lockpickFrame || event.source !== lockpickFrame.contentWindow) return;
  if (event.data?.type === 'apsu-lockpick-inserted') {
    if (
      items.some(
        (item) => item.id === event.data.itemId && item.kind === 'lockpick' && item.capacity > 0,
      )
    )
      insertedPickId = event.data.itemId;

    return;
  }
  if (event.data?.type === 'apsu-lock-activity') {
    recordLockActivity();
    return;
  }
  if (event.data?.type === 'apsu-lockpick-damaged') {
    saveWear(event.data.itemId, 50);
    return;
  }
  if (event.data?.type === 'apsu-lockpick-broken') {
    if (!items.some((item) => item.id === event.data.itemId && item.kind === 'lockpick')) return;
    if (lockpickBroke) return;

    lockpickBroke = true;
    saveWear(event.data.itemId, 0);
    lockStatus.textContent = 'Your lockpick broke.';
    // Keep the existing 650 ms break animation visible before closing.
    failureTimer = setTimeout(closeLockpick, 700);

    return;
  }
  if (event.data?.type === 'apsu-lockpick-cancel') {
    cancelLockpick();
    return;
  }

  const keySuccess = event.data?.type === 'apsu-key-success';

  if (
    (!keySuccess && event.data?.type !== 'apsu-lockpick-success') ||
    pendingRoom === null ||
    lockpickBroke
  )
    return;

  if (!lockToken || completingLock) return;
  if (Date.now() - lastLockActivity >= 30000) {
    expireLockAttempt();
    return;
  }

  const token = lockToken;
  const destination = pendingRoom;
  await wearSave;
  if (
    wearFailed ||
    pendingRoom !== destination ||
    !character ||
    completingLock ||
    lockToken !== token
  )
    return;
  if (keySuccess) {
    if (!hasKey(destination)) return;
  } else if (
    !items.some(
      (item) => item.id === event.data.itemId && item.kind === 'lockpick' && item.capacity > 0,
    )
  )
    return;
  if (!doors.some((d) => d.door_id === destination && d.outside_room === character.location))
    return;

  completingLock = true;
  let released = false,
    releaseError = null;

  try {
    const response = await supabaseClient.rpc('change_door', {
      p_character: character.id,
      p_door: destination,
      p_locked: false,
      p_token: token,
      p_item: keySuccess ? null : event.data.itemId,
      p_key: keySuccess,
    });
    released = response.data === false && !response.error;
    releaseError = response.error;
  } catch (error) {
    releaseError = error;
  }
  if (lockToken !== token) return;
  if (releaseError || !released) {
    closeLockpick();
    lockStatus.textContent = 'The lock session ended. Please try again.';
    return;
  }

  lockToken = null;
  const door = doors.find((d) => d.door_id === destination);

  if (door) door.locked = false;

  closeLockpick();
  renderRoom();
  lockStatus.textContent = 'The door is unlocked';
});

async function setDoorLocked(locked, doorId = 'roomC') {
  if (!character || pendingRoom || itemBusy) return;

  const location = character.location;
  const door = doors.find((d) => d.door_id === doorId);

  if (!door || ![door.inside_room, door.outside_room].includes(location)) return;

  itemBusy = true;
  try {
    // Recheck saved ownership, rather than trusting a visible button.
    await loadItems();
    if (!character || leavingPage || character.location !== location) return;
    if (!hasKey(doorId)) {
      renderRoom();
      return;
    }

    const { data, error } = await supabaseClient.rpc('change_door', {
      p_character: character.id,
      p_door: doorId,
      p_locked: locked,
      p_key: true,
    });

    if (error) throw error;

    door.locked = data;
    renderRoom();
    lockStatus.textContent =
      location === door.inside_room ? (locked ? 'The door is locked' : 'The door is unlocked') : '';
  } catch (error) {
    lockStatus.textContent = 'Could not change the door. ' + (error.message || 'Try again.');
  } finally {
    itemBusy = false;
    await syncRoom();
  }
}

lockRoomButton.addEventListener('click', () => setDoorLocked(true));
unlockRoomButton.addEventListener('click', () => setDoorLocked(false));

async function loadItems() {
  const owner = character?.id;

  if (!owner) return;

  const collected = [];
  // Supabase pages table reads; don't mistake the first 1,000 rows for an inventory cap.

  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseClient
      .from('character_items')
      .select('id, kind, capacity, slot, key_room, appearance')
      .eq('character_id', owner)
      .order('slot')
      .order('id')
      .range(offset, offset + 999);

    if (error) throw error;
    if (character?.id !== owner) return;

    collected.push(...data);
    if (data.length < 1000) break;
  }

  items = [...new Map(collected.map((item) => [item.id, item])).values()];
}

function renderDoorControls() {
  lockRoomButton.hidden = true;
  unlockRoomButton.hidden = true;
  let controls = document.getElementById('door-controls');

  if (!controls) {
    controls = document.createElement('div');
    controls.id = 'door-controls';
    document.getElementById('room-exits').after(controls);
  }

  controls.replaceChildren();
  for (const door of doors) {
    if (
      ![door.inside_room, door.outside_room].includes(character.location) ||
      !hasKey(door.door_id)
    )
      continue;
    if (door.locked && character.location !== door.inside_room) continue;

    const button = document.createElement('button');
    button.textContent =
      (door.locked ? 'Unlock' : 'Lock') +
      ' Door [' +
      (world.rooms[door.inside_room]?.name || door.inside_room) +
      ']';
    button.onclick = () => setDoorLocked(!door.locked, door.door_id);
    controls.append(button);
  }
}

function renderItems() {
  if (!character) return;

  const inventory = document.getElementById('inventory');
  inventory.replaceChildren();
  inventoryUI.render();
  renderDoorControls();
  const ground = document.getElementById('room-items');
  ground.replaceChildren();
  // Prototype supplies are retired; existing inventory is preserved.
}

function saveWear(itemId, capacity) {
  const pick = items.find((item) => item.id === itemId && item.kind === 'lockpick');

  if (!pick) return;

  pick.capacity = Math.min(pick.capacity, capacity);
  renderItems();
  wearSave = wearSave
    .then(async function () {
      const { error } = await supabaseClient.rpc('wear_lockpick_item', {
        p_item: itemId,
        p_capacity: capacity,
      });

      if (error) throw error;
    })
    .catch(function () {
      wearFailed = true;
      lockStatus.textContent = 'Could not save lockpick wear. Reload before another attempt.';
    });
}

const accountMenu = document.getElementById('account-menu');
const accountStatus = document.getElementById('account-status');
const roomContent = document.getElementById('room-content');
const profileDialog = document.getElementById('profile-dialog');
const logoutButton = document.getElementById('log-out');
let leavingPage = false;

// Only leave after confirmation; the account stays signed in.
document.querySelectorAll('[data-leave-room]').forEach((link) => {
  link.addEventListener('click', async (event) => {
    event.preventDefault();
    if (leavingPage) return;

    const destination =
      link.dataset.leaveRoom === 'APSU Home'
        ? 'APSU Home'
        : link.dataset.leaveRoom === 'Disconnect'
          ? 'the launchpad'
          : 'World Home';

    if (
      !(await APSUUI.confirm({
        message: 'Return to ' + destination + '? Your character will be disconnected from play.',
        confirmLabel: 'Leave room',
      }))
    )
      return;
    if (leavingPage) return;

    leavingPage = true;
    link.setAttribute('aria-disabled', 'true');
    // Let presence cleanup finish before unloading the page. If the
    // network stalls, the server's existing presence timeout handles it.
    const cleanup = roomChat.stop();
    closeLockpick();
    await Promise.race([cleanup, new Promise((resolve) => setTimeout(resolve, 3000))]);
    window.location.assign(link.href);
  });
});

function returnToLogin() {
  roomChat.stop();
  leavingPage = true;
  player = null;
  character = null;
  roomContent.hidden = true;
  accountMenu.hidden = true;
  profileDialog.close();
  closeLockpick();
  window.location.replace('login.html');
}

const playerPicture = createPlayerPicture(
  document.getElementById('player-picture-preview'),
  supabaseClient,
);
const characterPreview = createCharacterProfile(
  document.getElementById('character-preview'),
  supabaseClient,
);

function chooseProfile(kind) {
  profileDialog.dataset.profileKind = kind;
  document.getElementById('character-preview').hidden = kind !== 'character';
  document.getElementById('player-preview').hidden = kind !== 'player';
  document
    .getElementById('character-tab')
    .setAttribute('aria-pressed', String(kind === 'character'));
  document.getElementById('player-tab').setAttribute('aria-pressed', String(kind === 'player'));
}

document.getElementById('character-tab').onclick = () => chooseProfile('character');
document.getElementById('player-tab').onclick = () => chooseProfile('player');
profileDialog.addEventListener('close', () => characterPreview.clear());
let previewRequest = 0;
profileDialog.addEventListener('close', () => {
  previewRequest++;
});

async function openPlayerPreview(parameters, characterName = '') {
  const request = ++previewRequest;
  document.getElementById('profile-tabs').hidden = !parameters.p_character;
  chooseProfile(parameters.p_character ? 'character' : 'player');
  if (parameters.p_character) characterPreview.load(parameters.p_character);

  document.getElementById('profile-heading').textContent = characterName
    ? characterName + ' · Profiles'
    : 'Player Profile';
  const previewStatus = document.getElementById('preview-status');
  const link = document.getElementById('full-profile-link');
  link.hidden = true;
  profileDialog.querySelector('[data-dm-profile]')?.remove();
  for (const id of ['profile-name', 'profile-joined', 'preview-about'])
    document.getElementById(id).textContent = '';

  previewStatus.textContent = 'Loading profile…';
  if (!profileDialog.open) profileDialog.showModal();
  try {
    const { data, error } = await supabaseClient.rpc('player_profile', parameters);

    if (request !== previewRequest || leavingPage) return;
    if (error) throw error;

    const profile = data?.[0];

    if (!profile) {
      previewStatus.textContent = 'Profile unavailable.';
      return;
    }

    document.getElementById('profile-name').textContent = profile.username;
    document.getElementById('profile-joined').textContent = new Date(
      profile.joined,
    ).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('preview-about').textContent = profile.about || 'No bio added yet.';
    playerPicture.load(profile.id, profile.id === player.id, world.id, profile.username);
    link.href = 'profile.html?id=' + encodeURIComponent(profile.id);
    link.hidden = false;
    window.APSUMessages?.bind(profileDialog, profile.id);
    previewStatus.textContent = '';
  } catch {
    if (request === previewRequest && !leavingPage)
      previewStatus.textContent = 'Could not load this profile. Close and try again.';
  }
}

document.getElementById('view-profile').addEventListener('click', function () {
  accountMenu.open = false;
  openPlayerPreview({ p_user: player.id });
});

// Native details provides keyboard support; also close on Escape or outside clicks.
document.addEventListener('click', function (event) {
  if (!accountMenu.contains(event.target)) accountMenu.open = false;
});
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && accountMenu.open) {
    accountMenu.open = false;
    accountMenu.querySelector('summary').focus();
  }
});

logoutButton.addEventListener('click', async function () {
  if (logoutButton.disabled) return;

  logoutButton.disabled = true;
  accountStatus.textContent = 'Logging out…';
  try {
    // Local scope signs out this browser without ending sessions on other devices.
    const { error } = await supabaseClient.auth.signOut({ scope: 'local' });

    if (error) {
      accountStatus.textContent = error.message;
      return;
    }

    returnToLogin();
  } catch (error) {
    accountStatus.textContent = 'Unable to log out. Check your connection and try again.';
  } finally {
    logoutButton.disabled = false;
  }
});

let mapLoading = false,
  mapSignature = '';

async function refreshWorldMap() {
  if (mapLoading || leavingPage) return;

  mapLoading = true;
  try {
    const { data, error } = await supabaseClient.rpc('world_map', { p_world: world.id });

    if (error || !data) throw error || Error('Map unavailable');

    const signature = JSON.stringify(data);

    if (signature === mapSignature) return;

    const rooms = {};

    for (const r of data.rooms)
      rooms[r.id] = {
        name: r.name,
        description: r.description,
        regionId: r.region_id,
        mapX: r.map_x,
        mapY: r.map_y,
        imagePath: r.image_path,
        ownerCharacter: r.owner_character,
        ownerName: r.owner_name,
        objects: r.objects || [],
        exits: data.connections.filter((e) => e.from_room === r.id).map((e) => e.to_room),
        locked: world.rooms[r.id]?.locked,
      };
    if (character && !rooms[character.location]) throw Error('Current location missing from map');

    world.rooms = rooms;
    world.regions = Object.fromEntries(data.regions.map((r) => [r.id, { name: r.name }]));
    mapSignature = signature;
    if (character) renderRoom();
  } finally {
    mapLoading = false;
  }
}

setInterval(() => {
  if (character && !leavingPage) refreshWorldMap().catch(() => {});
}, 15000);

async function initializePlayer() {
  try {
    // Verify the account with Supabase before displaying the room.
    const { data, error } = await supabaseClient.auth.getUser();

    if (leavingPage) return;
    if (error) {
      if (
        error.name === 'AuthSessionMissingError' ||
        error.status === 401 ||
        error.status === 403
      ) {
        returnToLogin();
        return;
      }

      throw error;
    }
    if (!data.user) {
      returnToLogin();
      return;
    }
    if (!(await APSUAccount.require(supabaseClient))) return;

    const requestedWorld = new URLSearchParams(window.location.search).get('world');

    if (requestedWorld && requestedWorld !== world.id) {
      window.location.replace('launchpad.html');
      return;
    }

    const user = data.user;
    const username = user.user_metadata?.username;
    player = {
      id: user.id,
      displayName: typeof username === 'string' && username.trim() ? username : 'Player',
    };
    const characterId = new URLSearchParams(window.location.search).get('character');

    if (!characterId) {
      window.location.replace('world.html?world=' + encodeURIComponent(world.id));
      return;
    }

    const { data: savedCharacter, error: characterError } = await supabaseClient
      .from('characters')
      .select('id, player_id, world_id, name, room_id')
      .eq('id', characterId)
      .eq('player_id', player.id)
      .eq('world_id', world.id)
      .maybeSingle();

    if (leavingPage) return;
    if (characterError) throw characterError;
    if (!savedCharacter) {
      window.location.replace('world.html?world=' + encodeURIComponent(world.id));
      return;
    }

    character = {
      id: savedCharacter.id,
      playerId: savedCharacter.player_id,
      worldId: savedCharacter.world_id,
      name: savedCharacter.name,
      playerName: player.displayName,
      // Each character resumes in their own saved room.
      location: savedCharacter.room_id,
    };
    await refreshWorldMap();
    moderation = startWorldModeration(supabaseClient, world.id, roomChat, async (message) => {
      leavingPage = true;
      closeLockpick();
      await roomChat.stop();
      sessionStorage.setItem('apsu-world-exit', message);
      location.replace('launchpad.html');
    });
    // Establish moderation before joining chat so an old kick cannot end this visit.
    await moderation.ready;
    if (leavingPage) return;

    await loadItems();
    await syncRoom();
    if (leavingPage) return;

    document.getElementById('character-name').textContent = 'Playing as ' + character.name;
    document.getElementById('full-profile-link').href =
      'profile.html?id=' + encodeURIComponent(player.id);
    // textContent displays account text safely instead of treating it as HTML.
    document.getElementById('account-name').textContent = player.displayName;
    document.getElementById('profile-name').textContent = player.displayName;
    const joined = new Date(user.created_at);
    document.getElementById('profile-joined').textContent = Number.isNaN(joined.getTime())
      ? 'Not available'
      : joined.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    renderRoom();
    roomContent.hidden = false;
    accountMenu.hidden = false;
    accountStatus.textContent = '';
  } catch (error) {
    accountStatus.textContent =
      'Unable to load your account or character. Return to the world home page and try again.';
    document.getElementById('account-recovery').hidden = false;
  }
}

// Respond when another tab logs out or switches to a different account.
supabaseClient.auth.onAuthStateChange(function (event, session) {
  if (event === 'SIGNED_OUT') returnToLogin();
  if (player && session?.user && session.user.id !== player.id) {
    leavingPage = true;
    roomContent.hidden = true;
    accountMenu.hidden = true;
    profileDialog.close();
    closeLockpick();
    roomChat.stop();
    window.location.reload();
  }
});
const workspace = createRoomWorkspace({
  openProfile: (id) => openPlayerPreview({ p_user: id }),
  teleport: async (destination) => {
    if (!character || itemBusy || pendingRoom)
      return roomChat.addSystem('Finish your current interaction first.');

    const result = await supabaseClient.rpc('admin_teleport', {
      p_character: character.id,
      p_to: destination,
    });

    if (result.error) throw result.error;

    character.location = result.data;
    renderRoom();
    await syncRoom();
  },
  getWorld: () => world,
  getCharacter: () => character,
  client: supabaseClient,
});
const inventoryUI = createInventoryUI({
  client: supabaseClient,
  getCharacter: () => character,
  getWorld: () => world,
  getItems: () => items,
  reload: async () => {
    await loadItems();
    renderItems();
  },
  notify: (message) => roomChat.addSystem(message),
  isBusy: () => itemBusy || completingLock || !!pendingRoom,
  onUse: (item) => {
    if (!character) return;

    const matching = doors.filter(
      (d) =>
        [d.inside_room, d.outside_room].includes(character.location) &&
        (!['key', 'room-c-key'].includes(item.kind) || (item.key_room || 'roomC') === d.door_id),
    );
    const door = matching.find((d) => d.locked) || matching[0];

    if (!door) {
      roomChat.addSystem('There is no matching door here.');
      return;
    }
    if (
      ['key', 'room-c-key'].includes(item.kind) &&
      (character.location === door.inside_room || !door.locked)
    ) {
      setDoorLocked(!door.locked, door.door_id);
      return;
    }
    if (character.location === door.inside_room) {
      roomChat.addSystem('A matching key is required on this side.');
      return;
    }
    if (!door.locked) {
      roomChat.addSystem('The door is already unlocked.');
      return;
    }

    openLockpick(door.door_id);
  },
});
const roomOwnerEditor = createOwnedRoomEditor({
  client: supabaseClient,
  getCharacter: () => character,
  getWorld: () => world,
  refresh: refreshWorldMap,
  notify: (text) => roomChat.addSystem(text),
});
initializePlayer();

// End the local minigame immediately on network loss; the server lease is the fallback.
window.addEventListener('offline', () => {
  if (pendingRoom) {
    closeLockpick();
    roomChat.addSystem('Connection lost. The lock session ended.');
  }
});

const roomPortraitCache = new Map();

async function loadRoomPortrait(container, person) {
  let entry = roomPortraitCache.get(person.portrait);

  if (!entry || entry.expires < Date.now()) {
    entry = {
      expires: Date.now() + 600000,
      promise: supabaseClient.storage
        .from('character-images')
        .createSignedUrl(person.portrait, 900),
    };
    roomPortraitCache.set(person.portrait, entry);
  }

  const { data, error } = await entry.promise;

  if (error) {
    roomPortraitCache.delete(person.portrait);
    return;
  }
  if (!data) return;

  const img = document.createElement('img');
  img.src = data.signedUrl;
  img.alt = '';
  window.APSUAvatar.frame(img, person.framing);
  container.replaceChildren(img);
}
