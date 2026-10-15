// Opt-in image generation. Keys remain in tab memory; no calls on room changes.
window.createSoloImagine = (getWorld, getDialogueKey = () => '') => {
  const $ = (id) => document.getElementById(id);

  let key = '',
    model = '',
    url = '',
    busy = false,
    attempts = 0,
    receipts = 0,
    total = 0;
  let imagePurpose = 'scene',
    surroundingsUrl = '';
  let pendingImage = null,
    kept = [],
    galleryWorld = null,
    galleryIndex = 0,
    galleryUrl = '';
  let surroundingsZoom = 1,
    requestOrigin = null,
    requestError = '',
    saving = false;

  function zoomSurroundings(change) {
    surroundingsZoom = change === 0 ? 1 : Math.max(1, Math.min(4, surroundingsZoom + change));
    $('surroundings-expanded').style.width = surroundingsZoom * 100 + '%';
    $('surroundings-zoom-level').textContent = Math.round(surroundingsZoom * 100) + '%';
    $('surroundings-zoom-out').disabled = surroundingsZoom === 1;
    $('surroundings-zoom-in').disabled = surroundingsZoom === 4;
  }

  if ($('surroundings-viewer')) {
    const open = () => {
      if (!surroundingsUrl) return;

      $('surroundings-expanded').src = surroundingsUrl;
      $('surroundings-expanded').alt = $('surroundings-image').alt;
      zoomSurroundings(0);
      $('surroundings-viewer').showModal();
    };

    const openScene = (preview = false) => {
      const source = preview ? url : galleryUrl;

      if (!source) return;

      $('surroundings-expanded').src = source;
      $('surroundings-expanded').alt = preview ? 'Generated scene preview' : $('kept-scene').alt;
      zoomSurroundings(0);
      $('surroundings-viewer').showModal();
    };

    $('kept-scene').onclick = () => openScene();
    $('image-preview').onclick = () => openScene(true);
    $('image-preview').tabIndex = 0;
    $('image-preview').setAttribute('role', 'button');
    $('image-preview').setAttribute('aria-label', 'Enlarge generated image');
    $('image-preview').onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openScene(true);
      }
    };
    $('kept-scene').tabIndex = 0;
    $('kept-scene').setAttribute('role', 'button');
    $('kept-scene').setAttribute('aria-label', 'Enlarge Imagine picture');
    $('kept-scene').onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openScene();
      }
    };
    $('surroundings-image').onclick = open;
    $('surroundings-image').tabIndex = 0;
    $('surroundings-image').setAttribute('role', 'button');
    $('surroundings-image').setAttribute('aria-label', 'Enlarge surroundings image');
    $('surroundings-image').onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    };
    $('surroundings-zoom-in').onclick = () => zoomSurroundings(0.25);
    $('surroundings-zoom-out').onclick = () => zoomSurroundings(-0.25);
    $('surroundings-zoom-reset').onclick = () => zoomSurroundings(0);
    $('surroundings-viewer-close').onclick = () => $('surroundings-viewer').close();
  }

  function renderSurroundings() {
    const el = $('surroundings-image');

    if (!el) return;

    const w = getWorld(),
      matches = (r) =>
        r?.purpose === 'surroundings' && r.world === w?.id && r.roomId === w?.player.room,
      preview = matches(pendingImage) ? pendingImage : null,
      loading = busy && matches(requestOrigin),
      error = matches(requestOrigin) ? requestError : '',
      row = preview || kept.find(matches);

    if ($('surroundings-loading')) {
      $('surroundings-loading').hidden = !loading;
      $('surroundings-decision').hidden = !preview;
      $('surroundings-image-status').hidden = !preview && !error;
      $('surroundings-image-status').textContent =
        error || (preview ? 'Preview · Keep this image or discard it.' : '');
      $('keep-surroundings').disabled = saving;
      $('discard-surroundings').disabled = saving;
    }
    if ($('surroundings-viewer')?.open) $('surroundings-viewer').close();
    if (surroundingsUrl) URL.revokeObjectURL(surroundingsUrl);

    surroundingsUrl = '';
    el.hidden = !row;
    if (row) {
      surroundingsUrl = URL.createObjectURL(row.blob);
      el.src = surroundingsUrl;
      el.alt =
        row.room +
        (preview ? ' · unsaved surroundings preview' : ' · saved surroundings illustration');
    } else el.removeAttribute('src');
  }

  function renderGallery() {
    renderSurroundings();
    const scenes = kept.filter((r) => r.purpose !== 'surroundings');

    if (galleryUrl) URL.revokeObjectURL(galleryUrl);

    galleryUrl = '';
    $('scene-gallery').hidden = !scenes.length;
    if (!scenes.length) return;

    galleryIndex = Math.max(0, Math.min(galleryIndex, scenes.length - 1));
    galleryUrl = URL.createObjectURL(scenes[galleryIndex].blob);
    $('kept-scene').src = galleryUrl;
    $('kept-scene').alt = 'Kept illustration: ' + scenes[galleryIndex].room;
    $('scene-position').textContent = galleryIndex + 1 + ' / ' + scenes.length;
    $('scene-previous').disabled = scenes.length < 2;
    $('scene-next').disabled = scenes.length < 2;
  }

  async function refresh() {
    const id = getWorld()?.id;

    if (!id) return;
    if (galleryWorld === id) {
      renderSurroundings();
      return;
    }

    galleryWorld = id;
    try {
      kept = (await APSUSoloGallery.list(id)).sort((a, b) => a.at.localeCompare(b.at));
      galleryIndex = kept.length - 1;
      renderGallery();
    } catch (e) {
      $('image-status').textContent = e.message;
      galleryWorld = null;
    }
  }

  $('scene-previous').onclick = () => {
    galleryIndex =
      (galleryIndex - 1 + kept.filter((r) => r.purpose !== 'surroundings').length) %
      kept.filter((r) => r.purpose !== 'surroundings').length;
    renderGallery();
  };
  $('scene-next').onclick = () => {
    galleryIndex = (galleryIndex + 1) % kept.filter((r) => r.purpose !== 'surroundings').length;
    renderGallery();
  };

  function discard() {
    pendingImage = null;
    requestError = '';
    if (url) URL.revokeObjectURL(url);

    url = '';
    $('image-preview').removeAttribute('src');
    $('image-preview').hidden = true;
    $('image-decision').hidden = true;
    $('download-image').hidden = true;
    renderSurroundings();
  }

  $('discard-image').onclick = () => {
    if (saving) return;

    discard();
    $('image-status').textContent = 'Discarded.';
  };
  $('keep-image').onclick = async () => {
    if (!pendingImage || saving) return;

    saving = true;
    const imageToKeep = pendingImage;
    $('keep-image').disabled = true;
    $('discard-image').disabled = true;
    renderSurroundings();
    try {
      if (globalThis.APSUSoloStore && !(await APSUSoloStore.get(imageToKeep.world)))
        throw Error('This world was deleted. The image cannot be kept.');

      await APSUSoloGallery.keep(imageToKeep);
      kept = kept.filter((r) => r.id !== imageToKeep.id);
      kept.push(imageToKeep);
      galleryIndex = kept.length - 1;
      renderGallery();
      discard();
      $('image-status').textContent =
        imagePurpose === 'surroundings'
          ? 'Saved to this room on this device.'
          : 'Kept in your Imagine panel.';
      $('solo-imagine-dialog').close();
    } catch (e) {
      $('image-status').textContent = e.message;
      requestError = e.message;
    } finally {
      saving = false;
      $('keep-image').disabled = false;
      $('discard-image').disabled = false;
      renderSurroundings();
    }
  };
  if ($('keep-surroundings')) {
    $('keep-surroundings').onclick = () => $('keep-image').onclick();
    $('discard-surroundings').onclick = () => $('discard-image').onclick();
  }

  const showUsage = () => {
    $('image-usage').textContent =
      attempts +
      ' image requests this tab · $' +
      total.toFixed(4) +
      ' reported (' +
      receipts +
      ' cost receipts). Missing receipts are unknown.';
  };

  const clear = () => {
    key = '';
    model = '';
    $('image-key').value = '';
    $('image-connection').textContent = 'Images disconnected';
  };

  $('image-reuse-key').onchange = () => {
    const fields = $('image-key-fields');

    if (fields) fields.hidden = $('image-reuse-key').checked;

    model = '';
    $('image-connection').textContent = 'Reconnect the image model after changing the key option.';
  };
  $('image-model').onchange = () => {
    model = '';
    $('image-connection').textContent = 'Connect the selected image model.';
    $('image-custom-model').hidden = $('image-model').value !== 'custom';
  };
  $('connect-image').onclick = () => {
    const next = $('image-reuse-key').checked
        ? getDialogueKey()
        : $('image-key').value.trim() || key,
      name =
        $('image-model').value === 'custom'
          ? $('image-custom-model').value.trim()
          : $('image-model').value;

    if (
      !/^sk-or-v1-[\w-]{20,250}$/.test(next) ||
      !/^[a-z0-9-]+\/[a-z0-9][a-z0-9._:-]*$/i.test(name) ||
      name.length > 160
    ) {
      $('image-connection').textContent =
        'Connect dialogue first to reuse its key, or uncheck the shared-key option and enter an image key.';
      return;
    }

    key = $('image-reuse-key').checked ? '' : next;
    model = name;
    $('image-key').value = '';
    $('image-connection').textContent = 'Connected for this tab: ' + model;
  };
  $('disconnect-image').onclick = clear;
  $('solo-ai-dialog').addEventListener('close', () => {
    $('image-key').value = '';
  });

  function openImage(purpose = 'scene') {
    if (busy || pendingImage) {
      $('solo-imagine-dialog').showModal();
      statusPending();
      return;
    }

    imagePurpose = purpose;
    const s = getWorld();

    if (!s) return;

    refresh();
    const rooms = APSUSoloEngine.roomsFor(s);
    const room = rooms[s.player.room];
    $('image-prompt').value =
      'Illustrate a scene in ' +
      s.title +
      '. Environment: ' +
      room.name +
      '. ' +
      room.description.slice(0, 700) +
      '\nFocus on ' +
      s.player.name +
      ': ' +
      s.player.description.slice(0, 500) +
      '\nAlso present: ' +
      APSUSoloEngine.actors(s)
        .filter((n) => n.room === s.player.room)
        .map((n) => n.name + ': ' + n.description.slice(0, 500))
        .join('; ') +
      '\nVisible objects may include: ' +
      APSUSoloEngine.inventory(s, s.player.room)
        .map((i) => APSUItems.name(i, { rooms }))
        .join(', ') +
      '. Do not add text or interface elements.' +
      '\nRecent scene context (latest last; dialogue is not proof of an item transfer):\n' +
      (globalThis.APSUSoloTimeline?.summary(s) || '');
    if (purpose === 'surroundings')
      $('image-prompt').value =
        'Illustrate the environment of ' +
        room.name +
        ' in ' +
        s.title +
        '. ' +
        room.description +
        '. Architectural surroundings only, no named characters, no captions or interface. Preserve the room layout and setting.';

    $('image-approve').checked = false;
    $('image-status').textContent = '';
    $('solo-imagine-dialog').showModal();
  }

  $('open-imagine').onclick = () => openImage('scene');
  if ($('generate-surroundings'))
    $('generate-surroundings').onclick = () => openImage('surroundings');

  $('close-imagine').onclick = () => $('solo-imagine-dialog').close();

  function statusPending() {
    $('image-status').textContent = busy
      ? 'Generating one image… Close this dialog and keep playing; it will appear in the room panel when ready. Keep this browser page open.'
      : 'Your image is ready. Keep or discard the preview before generating another.';
    if (pendingImage && url) {
      $('image-preview').src = url;
      $('image-preview').hidden = false;
      $('image-decision').hidden = false;
    }
  }

  $('generate-image').onclick = async () => {
    if (busy) return;
    if (pendingImage) {
      statusPending();
      return;
    }

    const status = $('image-status');
    const requestKey = $('image-reuse-key').checked ? getDialogueKey() : key;

    if (!requestKey || !model) {
      status.textContent = 'Choose and connect an image model in AI connection first.';
      return;
    }
    if (!$('image-approve').checked) {
      status.textContent = 'Review the prompt and approve this optional image request.';
      return;
    }

    const prompt = $('image-prompt').value.trim();

    if (!prompt) {
      status.textContent = 'Enter a scene to illustrate.';
      return;
    }

    busy = true;
    $('generate-image').disabled = true;
    $('image-approve').checked = false;
    status.textContent =
      'Generating one image… You can close this dialog and keep playing. Keep this browser page open.';
    const originWorld = getWorld();
    const origin = {
      world: originWorld.id,
      roomId: originWorld.player.room,
      room: APSUSoloEngine.roomsFor(originWorld)[originWorld.player.room].name,
      purpose: imagePurpose,
    };
    requestOrigin = origin;
    requestError = '';
    renderSurroundings();
    try {
      attempts++;
      showUsage();
      const response = await fetch('/api/solo-imagine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: requestKey, model, prompt, adult: true, approveCharge: true }),
        signal: AbortSignal.timeout(160000),
      });

      if (!response.headers.get('content-type')?.includes('application/json'))
        throw Error('Image relay unavailable. Use the local solo development server.');

      const data = await response.json();

      if (typeof data.cost === 'number' && Number.isFinite(data.cost) && data.cost >= 0) {
        receipts++;
        total += data.cost;
      }

      showUsage();
      if (!response.ok) throw Error(data.error || 'Image request failed.');

      const image = data.data?.[0];

      if (!image || !['image/png', 'image/jpeg', 'image/webp'].includes(image.media_type))
        throw Error('Unsupported image response.');

      const bytes = Uint8Array.from(atob(image.b64_json), (c) => c.charCodeAt(0));

      if (url) URL.revokeObjectURL(url);

      const blob = new Blob([bytes], { type: image.media_type });
      url = URL.createObjectURL(blob);
      pendingImage = {
        id:
          origin.purpose === 'surroundings'
            ? origin.world + ':surroundings:' + origin.roomId
            : crypto.randomUUID(),
        ...origin,
        at: new Date().toISOString(),
        blob,
      };
      $('image-decision').hidden = false;
      $('image-preview').src = url;
      $('image-preview').hidden = false;
      $('download-image').href = url;
      $('download-image').download =
        'apsu-scene.' +
        { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[image.media_type];
      $('download-image').hidden = false;
      status.textContent =
        typeof data.cost === 'number'
          ? 'Provider reported $' + data.cost.toFixed(4) + '.'
          : 'Image ready. Cost not reported; check provider usage.';
    } catch (e) {
      status.textContent =
        e.message + ' No automatic retry. Check provider usage before trying again.';
      requestError = status.textContent;
    } finally {
      busy = false;
      $('generate-image').disabled = false;
      renderSurroundings();
    }
  };
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;

    clear();
    if (galleryUrl) URL.revokeObjectURL(galleryUrl);
    if (url) URL.revokeObjectURL(url);
    if (surroundingsUrl) URL.revokeObjectURL(surroundingsUrl);

    url = '';
  });

  return { refresh };
};
