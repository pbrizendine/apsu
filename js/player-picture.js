// Shared public player picture and badges, with an owner-only upload form.
function createPlayerPicture(container, client) {
  container.classList.add('player-profile');
  container.innerHTML =
    '<div class="player-masthead"><div class="player-cover"></div><div class="player-identity"><div class="player-avatar"><span class="player-initials" aria-hidden="true"></span><img class="character-portrait player-portrait" alt="Player profile picture" hidden></div><div class="player-summary"><p class="profile-eyebrow">APSU member</p><h2 class="player-display-name"></h2><p class="player-badges" aria-label="APSU badges"></p></div></div></div><details class="profile-image-editor" hidden><summary>Edit profile images</summary><div class="profile-image-controls"><form hidden novalidate><label>Profile picture<input type="file" accept="image/jpeg,image/png,image/webp" required></label><p>JPEG, PNG or WebP · up to 5 MB</p><div class="portrait-actions"><button type="button" data-adjust hidden>Adjust framing</button><button type="submit" disabled>Save profile picture</button></div></form><p role="status"></p></div></details>';
  const imageEditor = container.querySelector('.profile-image-editor');
  const title = container.querySelector('.player-display-name');

  if (container.id === 'player-picture') {
    document.getElementById('profile-name')?.remove();
    title.id = 'profile-name';
  }

  const banner = createPlayerBanner(
    container.querySelector('.player-cover'),
    client,
    container.querySelector('.profile-image-controls'),
  );
  const image = container.querySelector('.player-portrait'),
    badges = container.querySelector('.player-badges'),
    form = container.querySelector('form:not(.player-banner-form)'),
    status = form.nextElementSibling,
    button = form.querySelector('[type=submit]'),
    adjust = form.querySelector('[data-adjust]'),
    input = form.querySelector('input');
  const storage = client.storage.from('player-pictures');
  let userId = null,
    own = false,
    currentWorldId = null,
    currentName = 'Player',
    version = 0,
    busy = false,
    sourceFile = null,
    prepared = null,
    previewUrl = null;

  async function load(id, isOwner = false, worldId = null, displayName = currentName) {
    const request = ++version;
    userId = id;
    currentWorldId = worldId;
    own = isOwner;
    currentName = displayName || 'Player';
    title.textContent = currentName;
    container.querySelector('.player-initials').textContent = Array.from(currentName.trim())
      .slice(0, 2)
      .join('')
      .toUpperCase();
    image.alt = currentName + '’s profile picture';
    imageEditor.hidden = !own;
    banner.load(id, isOwner);
    const previousWorld = container.querySelector('.world-profile-extras');

    if (previousWorld) previousWorld.hidden = true;
    if (previewUrl) URL.revokeObjectURL(previewUrl);

    previewUrl = null;
    prepared = null;
    sourceFile = null;
    button.disabled = true;
    adjust.hidden = true;
    image.hidden = true;
    form.hidden = !own;
    badges.textContent = 'Loading badges…';
    status.textContent = '';
    try {
      const { data, error } = await client.rpc('player_profile_extras', { p_user: id });

      if (request !== version) return;
      if (error || !data) throw error || Error('Unavailable');

      badges.replaceChildren();
      if (!data.badges.length) badges.textContent = 'No badges yet.';

      data.badges.forEach((label) => {
        const badge = document.createElement('span');
        badge.className = 'player-badge';
        badge.textContent = label;
        if (label === 'APSU Founder') {
          const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          icon.setAttribute('viewBox', '0 0 24 24');
          icon.setAttribute('width', '20');
          icon.setAttribute('height', '20');
          icon.setAttribute('aria-label', 'Construction cap');
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', 'M3 16v-3a9 9 0 0 1 7-9v8h4V4a9 9 0 0 1 7 9v3h1v4H2v-4z');
          path.setAttribute('fill', '#efbd44');
          path.setAttribute('stroke', '#725415');
          icon.append(path);
          badge.prepend(icon);
        }

        badges.append(badge);
      });
      let worldExtras = container.querySelector('.world-profile-extras');

      if (!worldExtras) {
        worldExtras = document.createElement('section');
        worldExtras.className = 'world-profile-extras';
        container.append(worldExtras);
      }

      worldExtras.replaceChildren();
      worldExtras.hidden = true;
      if (worldId) {
        const response = await client.rpc('player_world_profile', { p_world: worldId, p_user: id });

        if (request !== version) return;
        if (response.data && !response.error) {
          const data = response.data,
            heading = document.createElement('h3'),
            joined = document.createElement('p'),
            list = document.createElement('p');
          heading.textContent = 'World badges · ' + data.world_name;
          joined.textContent =
            'World member since: ' +
            (data.joined_at
              ? new Date(data.joined_at).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })
              : 'Not joined');
          if (!data.badges.length) list.textContent = 'No world badges yet.';
          for (const item of data.badges) {
            const badge = document.createElement('span');
            badge.className = 'player-badge';
            badge.textContent = item.name;
            badge.title = item.description;
            badge.style.borderColor = item.color;
            list.append(badge);
          }

          worldExtras.append(joined, heading, list);
          worldExtras.hidden = false;
        }
      }
      if (data.photo_path) {
        const result = await storage.createSignedUrl(data.photo_path, 3600);

        if (request !== version) return;
        if (result.error) throw result.error;

        image.src = result.data.signedUrl + '&v=' + Date.now();
        image.hidden = false;
        adjust.hidden = !own;
      }
    } catch {
      if (request === version) {
        badges.textContent = 'Badges unavailable.';
        status.textContent = 'Could not load profile picture and badges.';
      }
    }
  }

  async function frame(file) {
    if (!own || busy) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5242880) {
      status.textContent = 'Choose a JPEG, PNG or WebP image no larger than 5 MB.';
      return;
    }

    const request = version;
    busy = true;
    try {
      const cropped = await APSUImageCrop.choose(file, { circle: true });

      if (!cropped || request !== version) return;

      sourceFile = file;
      prepared = cropped;
      if (previewUrl) URL.revokeObjectURL(previewUrl);

      previewUrl = URL.createObjectURL(cropped);
      image.src = previewUrl;
      image.hidden = false;
      adjust.hidden = false;
      button.disabled = false;
      status.textContent = 'Preview ready. Save profile picture to upload it.';
    } catch (error) {
      status.textContent = error.message || 'Could not open this image.';
    } finally {
      busy = false;
    }
  }

  input.addEventListener('change', () => {
    const file = input.files[0];

    if (file) frame(file);
  });
  adjust.onclick = async () => {
    try {
      // The selected original remains available while editing this profile.
      const file = sourceFile || (await (await fetch(image.src)).blob());
      await frame(file);
    } catch {
      status.textContent = 'Could not load this picture. Choose the original file again.';
    }
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!own || busy || !prepared) return;

    const id = userId,
      request = version;
    busy = true;
    button.disabled = true;
    status.textContent = 'Uploading…';
    try {
      const { data, error } = await client.auth.getUser();

      if (error || data.user?.id !== id) throw Error('Sign in as this profile owner to upload.');

      const upload = await storage.upload(id + '/portrait', prepared, {
        upsert: true,
        contentType: prepared.type,
        cacheControl: '0',
      });

      if (upload.error) throw upload.error;

      const saved = await client.rpc('save_player_picture');

      if (saved.error) throw saved.error;
      if (request !== version) return;

      form.reset();
      await load(id, true, currentWorldId);
      status.textContent = 'Profile picture saved.';
    } catch (error) {
      if (request === version)
        status.textContent = error.message || 'Unable to upload. Please try again.';
    } finally {
      busy = false;
      button.disabled = !prepared;
    }
  });

  return { load };
}

// Banners belong to players, never characters. Both player views reuse this component.
function createPlayerBanner(container, client, controls) {
  container.innerHTML =
    '<img class="player-banner" alt="Player profile banner" hidden><form class="player-banner-form" hidden novalidate><label>Profile banner<input type="file" accept="image/png,image/jpeg,image/webp"></label><p>One player banner · JPEG, PNG or WebP · up to 5 MB</p><button type="submit" disabled>Save banner</button><button type="button" data-remove hidden>Remove banner</button><p role="status"></p></form>';
  const image = container.querySelector('img'),
    form = container.querySelector('form'),
    input = form.querySelector('input'),
    save = form.querySelector('[type=submit]'),
    remove = form.querySelector('[data-remove]'),
    status = form.querySelector('[role=status]'),
    storage = client.storage.from('player-banners');
  // Keep owner controls below the portrait/badges, with only the banner at the top.
  controls.append(form);
  let userId,
    own = false,
    generation = 0,
    busy = false,
    file = null,
    preview = null;

  function releasePreview() {
    if (preview) URL.revokeObjectURL(preview);

    preview = null;
  }

  async function load(id, isOwner) {
    const request = ++generation;
    userId = id;
    own = isOwner;
    file = null;
    releasePreview();
    form.reset();
    form.hidden = !own;
    image.hidden = true;
    remove.hidden = true;
    save.disabled = true;
    status.textContent = '';
    try {
      const result = await client.rpc('player_banner', { p_user: id });

      if (result.error) throw result.error;
      if (request !== generation || !result.data) return;

      const signed = await storage.createSignedUrl(result.data, 3600);

      if (signed.error) throw signed.error;
      if (request !== generation) return;

      image.src = signed.data.signedUrl + '&v=' + Date.now();
      image.hidden = false;
      remove.hidden = !own;
    } catch {
      if (request === generation) status.textContent = 'Banner unavailable. Try again later.';
    }
  }

  input.onchange = () => {
    if (busy) return;

    file = input.files[0] || null;
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5242880) {
      file = null;
      save.disabled = true;
      status.textContent = 'Choose a JPEG, PNG or WebP no larger than 5 MB.';

      return;
    }

    releasePreview();
    preview = URL.createObjectURL(file);
    image.src = preview;
    image.hidden = false;
    save.disabled = false;
    status.textContent = 'Preview ready. Save banner to upload it.';
  };

  async function persist(clear = false) {
    if (!own || busy || (!clear && !file)) return;

    const id = userId,
      request = generation,
      selected = file;
    busy = true;
    save.disabled = true;
    input.disabled = true;
    remove.disabled = true;
    status.textContent = clear ? 'Removing…' : 'Uploading…';
    try {
      const current = await client.auth.getUser();

      if (current.error || current.data.user?.id !== id)
        throw Error('Sign in as this profile owner.');
      if (!clear) {
        const uploaded = await storage.upload(id + '/banner', selected, {
          upsert: true,
          contentType: selected.type,
          cacheControl: '0',
        });

        if (uploaded.error) throw uploaded.error;
      }

      const saved = await client.rpc('save_player_banner', { p_remove: clear });

      if (saved.error) throw saved.error;
      if (request !== generation) return;

      await load(id, true);
      status.textContent = clear ? 'Banner removed.' : 'Banner saved.';
    } catch (error) {
      if (request === generation) status.textContent = error.message || 'Could not save banner.';
    } finally {
      busy = false;
      input.disabled = false;
      remove.disabled = false;
      save.disabled = !file;
    }
  }

  form.onsubmit = (event) => {
    event.preventDefault();
    persist();
  };
  remove.onclick = () => persist(true);

  return { load };
}
