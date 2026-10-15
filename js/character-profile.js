// Reused by the room preview and the full character profile page.
function createCharacterProfile(container, client) {
  container.innerHTML = `<p class="character-profile-status" role="status"></p><div class="character-profile-body" hidden>
    <div class="avatar-frame character-portrait-frame"><img class="character-portrait" alt="Character portrait" hidden></div><h2 class="character-profile-name"></h2>
    <h3>Physical description</h3><p class="character-description"></p>
    <form class="description-form" novalidate hidden><label>Physical description<textarea name="description" maxlength="4000" rows="5"></textarea></label><button type="submit">Save description</button></form>
    <h3>Character images</h3>
    <div class="character-gallery"></div>
    <form class="image-upload" novalidate hidden><label>Image file<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required></label><p>JPEG, PNG or WebP · up to 5 MB · 3 images per character</p><label><input name="portrait" type="checkbox"> Use as character profile picture</label><button type="submit">Upload image</button></form>
    <p><a class="button-link character-full-link" target="_blank" rel="noopener">Open full character profile ↗</a></p>
  </div>`;

  const $ = (selector) => container.querySelector(selector),
    status = $('.character-profile-status');

  let data,
    generation = 0,
    busy = false,
    pendingUpload = null;
  const storage = client.storage.from('character-images');

  async function load(id) {
    const version = ++generation;
    status.textContent = 'Loading character…';
    $('.character-profile-body').hidden = true;
    try {
      const result = await client.rpc('character_profile', { p_character: id });

      if (version !== generation) return;
      if (result.error || !result.data) throw result.error || Error('Character unavailable');

      data = result.data;
      if (data.images.length) {
        const signed = await storage.createSignedUrls(
          data.images.map((i) => i.path),
          3600,
        );

        if (version !== generation) return;
        if (signed.error) throw signed.error;

        data.images.forEach((i) => {
          i.url = signed.data.find((s) => s.path === i.path)?.signedUrl;
        });
      }

      $('.character-profile-name').textContent = data.name;
      $('.character-description').textContent =
        data.description || 'No physical description added yet.';
      $('.description-form textarea').value = data.description;
      $('.description-form').hidden = $('.image-upload').hidden = !data.is_owner;
      $('.character-full-link').href = 'character.html?id=' + encodeURIComponent(id);
      const portrait = data.images.find((i) => i.id === data.avatar_id);
      $('.character-portrait').hidden = !portrait?.url;
      if (portrait?.url) {
        $('.character-portrait').src = portrait.url;
        window.APSUAvatar.frame($('.character-portrait'), data.avatar_framing);
      }

      $('.character-portrait-frame').hidden = !portrait?.url;
      $('.character-profile-body').hidden = false;
      status.textContent = '';
      $('.image-upload [name=portrait]').checked = !data.avatar_id;
      gallery();
    } catch {
      if (version === generation)
        status.textContent = 'Could not load the character profile. Close and try again.';
    }
  }

  function gallery() {
    const list = $('.character-gallery');
    list.replaceChildren();
    const matches = data.images;

    if (!matches.length) {
      list.textContent = 'No images uploaded yet.';
      return;
    }
    for (const item of matches) {
      const card = document.createElement('article');
      card.className = 'character-image-card';
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'image-view';
      view.setAttribute('aria-label', 'View character photo');
      const img = document.createElement('img');
      img.alt = 'Character photo';
      if (item.url) img.src = item.url;

      img.loading = 'lazy';
      view.append(img);
      view.onclick = () => {
        const dialog = document.createElement('dialog');
        dialog.className = 'image-lightbox';
        dialog.setAttribute('aria-label', item.title);
        const full = document.createElement('img');
        full.src = item.url;
        full.alt = 'Character photo';
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.onclick = () => dialog.close();
        dialog.append(full, close);
        dialog.addEventListener(
          'close',
          () => {
            dialog.remove();
            view.focus();
          },
          { once: true },
        );
        document.body.append(dialog);
        dialog.showModal();
      };
      card.append(view);
      if (data.is_owner) {
        const avatar = document.createElement('button');
        avatar.type = 'button';
        avatar.textContent = item.id === data.avatar_id ? 'Adjust portrait' : 'Use as portrait';
        avatar.disabled = busy;
        avatar.onclick = () =>
          mutate(async () => {
            const file = await (await fetch(item.url)).blob();
            const framing = await APSUImageCrop.choose(file, {
              circle: true,
              framingOnly: true,
              framing: item.id === data.avatar_id ? data.avatar_framing : null,
            });

            if (!framing) return null;

            return client.rpc('set_character_portrait', {
              p_character: data.id,
              p_image: item.id,
              p_zoom: framing.zoom,
              p_x: framing.x,
              p_y: framing.y,
            });
          }, 'Portrait updated.');
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remove image';
        remove.disabled = busy;
        remove.onclick = async () => {
          if (
            !(await APSUUI.confirm({
              title: 'Remove image?',
              message: 'Remove this image from the character gallery?',
              confirmLabel: 'Remove image',
            }))
          )
            return;

          await mutate(async () => {
            const r = await client.rpc('remove_character_image', {
              p_character: data.id,
              p_image: item.id,
            });

            if (!r.error) {
              const deleted = await storage.remove([item.path]);

              if (deleted.error) throw deleted.error;
            }

            return r;
          }, 'Image removed.');
        };
        card.append(avatar, remove);
      }

      list.append(card);
    }
  }

  async function mutate(action, success) {
    if (busy || !data?.is_owner) return;

    busy = true;
    const id = data.id,
      version = generation;
    status.textContent = 'Saving…';
    container.querySelectorAll('form button').forEach((b) => (b.disabled = true));
    gallery();
    try {
      const result = await action();

      if (result?.error) throw result.error;
      if (result === null) {
        status.textContent = '';
        return;
      }
      if (version !== generation) return;

      await load(id);
      status.textContent = success;
    } catch (error) {
      if (version === generation)
        status.textContent = error?.message || 'Could not save. Please try again.';
    } finally {
      busy = false;
      container.querySelectorAll('form button').forEach((b) => (b.disabled = false));
      if (data) gallery();
    }
  }

  $('.description-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const description = $('.description-form textarea').value;
    mutate(
      () =>
        client.rpc('save_character_description', {
          p_character: data.id,
          p_description: description,
        }),
      'Description saved.',
    );
  });
  $('.image-upload').addEventListener('submit', (event) => {
    event.preventDefault();
    const file = $('.image-upload [name=image]').files[0],
      title = 'Character photo';

    if (!file || !title) return;
    if (data.images.length >= 3) {
      status.textContent =
        'Maximum 3 images per character. Remove a photo before uploading another.';
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5242880) {
      status.textContent = 'Choose a JPEG, PNG or WebP image no larger than 5 MB.';
      return;
    }

    const id = data.id,
      owner = data.player_id;
    mutate(async () => {
      if (!pendingUpload || pendingUpload.file !== file || pendingUpload.character !== id) {
        const cropped = file; // Keep the original for the gallery and future reframing.
        const framing = $('.image-upload [name=portrait]').checked
          ? await APSUImageCrop.choose(file, { circle: true, framingOnly: true })
          : null;

        if ($('.image-upload [name=portrait]').checked && !framing) return null;
        if (data?.id !== id) throw Error('The profile changed. Please upload again.');

        const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[file.type];
        const path = owner + '/' + id + '/' + crypto.randomUUID() + '.' + ext;
        const result = await storage.upload(path, cropped, {
          contentType: cropped.type,
          upsert: false,
        });

        if (result.error) throw result.error;

        pendingUpload = { file, path, character: id, framing };
      }

      const result = await client.rpc('add_character_image', {
        p_character: id,
        p_path: pendingUpload.path,
        p_title: title,
      });

      if (!result.error && pendingUpload.framing) {
        const f = pendingUpload.framing;
        const portrait = await client.rpc('set_character_portrait', {
          p_character: id,
          p_image: result.data,
          p_zoom: f.zoom,
          p_x: f.x,
          p_y: f.y,
        });

        if (portrait.error) throw portrait.error;
      }
      if (!result.error) {
        pendingUpload = null;
        $('.image-upload').reset();
      }

      return result;
    }, 'Image uploaded. Use “Adjust portrait” to change its framing at any time.');
  });

  return {
    load,
    clear() {
      generation++;
      data = null;
      $('.character-profile-body').hidden = true;
      status.textContent = '';
    },
  };
}
