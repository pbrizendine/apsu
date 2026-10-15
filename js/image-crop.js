// Crop locally before upload. No image leaves the browser until Save/Upload completes.
window.APSUImageCrop = (() => {
  let active = false;

  function sourceRect(width, height, zoom, x, y) {
    const side = Math.min(width, height) / zoom;
    return { x: (width - side) * x, y: (height - side) * y, side };
  }

  async function choose(file, options = {}) {
    if (active) return null;

    active = true;
    const url = URL.createObjectURL(file),
      previousFocus = document.activeElement;
    let dialog;

    try {
      const image = new Image();
      image.src = url;
      await image.decode();

      return await new Promise((resolve) => {
        dialog = document.createElement('dialog');
        dialog.className = 'apsu-image-crop';
        if (options.circle) dialog.classList.add('circle-crop');

        dialog.setAttribute('aria-label', 'Adjust image framing');
        dialog.innerHTML =
          '<h2>Adjust image framing</h2><p>Drag the image to frame it. You can also use the position sliders.</p><canvas width="600" height="600" aria-label="Image crop preview"></canvas><label>Zoom<input data-zoom type="range" min="1" max="4" step="0.01" value="1"></label><label>Horizontal position<input data-x type="range" min="0" max="1" step="0.01" value="0.5"></label><label>Vertical position<input data-y type="range" min="0" max="1" step="0.01" value="0.5"></label><p role="status"></p><div class="crop-actions"><button type="button" data-cancel>Cancel</button><button type="button" data-save>Use this framing</button></div>';
        const canvas = dialog.querySelector('canvas'),
          ctx = canvas.getContext('2d');
        const zoom = dialog.querySelector('[data-zoom]'),
          x = dialog.querySelector('[data-x]'),
          y = dialog.querySelector('[data-y]');

        if (options.framing) {
          zoom.value = options.framing.zoom || 1;
          x.value = options.framing.x ?? 0.5;
          y.value = options.framing.y ?? 0.5;
        }

        const draw = () => {
          const crop = sourceRect(
            image.naturalWidth,
            image.naturalHeight,
            +zoom.value,
            +x.value,
            +y.value,
          );
          ctx.clearRect(0, 0, 600, 600);
          ctx.drawImage(image, crop.x, crop.y, crop.side, crop.side, 0, 0, 600, 600);
        };

        for (const slider of [zoom, x, y]) slider.addEventListener('input', draw);

        let drag = null,
          result = null;
        canvas.addEventListener('pointerdown', (event) => {
          drag = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            fx: +x.value,
            fy: +y.value,
          };
          canvas.setPointerCapture(event.pointerId);
        });
        canvas.addEventListener('pointermove', (event) => {
          if (!drag || drag.id !== event.pointerId) return;

          const side = Math.min(image.naturalWidth, image.naturalHeight) / +zoom.value;
          const scale = side / canvas.getBoundingClientRect().width;

          const clamp = (n) => Math.max(0, Math.min(1, n));

          if (image.naturalWidth > side)
            x.value = clamp(
              drag.fx - ((event.clientX - drag.x) * scale) / (image.naturalWidth - side),
            );
          if (image.naturalHeight > side)
            y.value = clamp(
              drag.fy - ((event.clientY - drag.y) * scale) / (image.naturalHeight - side),
            );

          draw();
        });
        canvas.addEventListener('pointerup', () => {
          drag = null;
        });
        canvas.addEventListener('pointercancel', () => {
          drag = null;
        });
        dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
        dialog.querySelector('[data-save]').onclick = async () => {
          const button = dialog.querySelector('[data-save]');
          button.disabled = true;
          const crop = sourceRect(
            image.naturalWidth,
            image.naturalHeight,
            +zoom.value,
            +x.value,
            +y.value,
          );

          if (options.framingOnly) {
            result = { zoom: +zoom.value, x: +x.value, y: +y.value };
            dialog.close();
            return;
          }

          const output = document.createElement('canvas');
          output.width = output.height = Math.min(1024, Math.max(1, Math.floor(crop.side)));
          output
            .getContext('2d')
            .drawImage(
              image,
              crop.x,
              crop.y,
              crop.side,
              crop.side,
              0,
              0,
              output.width,
              output.height,
            );
          const blob = await new Promise((done) => output.toBlob(done, 'image/png'));

          if (!dialog.open) return;
          if (!blob || blob.size > 5242880) {
            dialog.querySelector('[role=status]').textContent =
              'Could not prepare this image. Try a smaller image.';
            button.disabled = false;
            return;
          }

          result = blob;
          dialog.close();
        };
        dialog.addEventListener('close', () => resolve(result), { once: true });
        document.body.append(dialog);
        dialog.showModal();
        draw();
      });
    } finally {
      dialog?.remove();
      URL.revokeObjectURL(url);
      active = false;
      previousFocus?.focus();
    }
  }

  return { choose, sourceRect };
})();

window.APSUAvatar = {
  frame(image, framing) {
    const z = Math.max(1, Math.min(4, Number(framing?.zoom) || 1));
    const x = Math.max(0, Math.min(1, Number(framing?.x ?? 0.5))) * 100;
    const y = Math.max(0, Math.min(1, Number(framing?.y ?? 0.5))) * 100;
    image.style.objectPosition = x + '% ' + y + '%';
    image.style.transformOrigin = x + '% ' + y + '%';
    image.style.transform = 'scale(' + z + ')';
  },
};
