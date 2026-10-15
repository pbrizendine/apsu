// Small, private chat images share the witnessed-message permissions and 24-hour deletion.
// Decode and re-encode locally: original metadata and arbitrary embedded file content are not sent.
window.APSUChatImages = (() => {
  async function prepare(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10485760)
      throw Error('Choose JPEG, PNG or WebP images up to 10 MB each.');

    const url = URL.createObjectURL(file);

    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.84, 0.7, 0.55, 0.4, 0.25]) {
        const result = canvas.toDataURL('image/jpeg', quality);

        if (result.length <= 350000) return result;
      }

      throw Error('This image is too detailed. Choose a smaller image.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function composer(input, preview, notify) {
    let images = [],
      busy = false,
      generation = 0;

    function render() {
      preview.replaceChildren();
      images.forEach((data, index) => {
        const card = document.createElement('div'),
          image = document.createElement('img'),
          remove = document.createElement('button');
        image.src = data;
        image.alt = 'Attachment ' + (index + 1);
        remove.type = 'button';
        remove.textContent = 'Remove';
        remove.onclick = () => {
          images.splice(index, 1);
          render();
        };
        card.append(image, remove);
        preview.append(card);
      });
    }

    input.onchange = async () => {
      if (busy) return;

      const files = [...input.files];
      input.value = '';
      if (files.length + images.length > 3) return notify('Attach up to 3 images per message.');

      const version = generation;
      busy = true;
      try {
        const prepared = await Promise.all(files.map(prepare));

        if (version === generation) {
          images.push(...prepared);
          render();
        }
      } catch (e) {
        notify(e.message);
      } finally {
        busy = false;
      }
    };

    return {
      get: () => [...images],
      busy: () => busy,
      clear() {
        generation++;
        images = [];
        render();
      },
    };
  }

  function lightbox(src) {
    const dialog = document.createElement('dialog'),
      image = document.createElement('img'),
      close = document.createElement('button');
    dialog.className = 'image-lightbox';
    dialog.setAttribute('aria-label', 'Chat image');
    image.src = src;
    image.alt = 'Chat attachment';
    close.textContent = 'Close';
    close.onclick = () => dialog.close();
    dialog.append(image, close);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }

  function view(row, sources) {
    const gallery = document.createElement('div');
    gallery.className = 'chat-attachments';
    for (const src of sources) {
      const button = document.createElement('button'),
        image = document.createElement('img');
      button.type = 'button';
      button.setAttribute('aria-label', 'Expand chat image');
      image.src = src;
      image.alt = 'Chat attachment';
      image.loading = 'lazy';
      button.append(image);
      button.onclick = () => lightbox(src);
      gallery.append(button);
    }

    row.append(gallery);
  }

  return { prepare, composer, view };
})();
