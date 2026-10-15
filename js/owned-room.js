function createOwnedRoomEditor({ client, getCharacter, getWorld, refresh, notify }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Edit your room';
  button.hidden = true;
  document.getElementById('surroundings-description').after(button);
  button.onclick = () => {
    const c = getCharacter(),
      w = getWorld(),
      r = w.rooms[c.location];

    if (r.ownerCharacter !== c.id) return;

    const roomId = c.location,
      dialog = document.createElement('dialog');
    dialog.className = 'workspace-dialog';
    dialog.setAttribute('aria-label', 'Edit your room');
    dialog.innerHTML =
      '<h2>Edit your room</h2><form novalidate><label>Description<textarea maxlength="4000" rows="6"></textarea></label><label>Surroundings image<input type="file" accept="image/jpeg,image/png,image/webp"></label><p>Up to 5 MB. Leave empty to keep the current image.</p><label><input type="checkbox"> Remove current image</label><p role="status"></p><button type="submit">Save changes</button><button type="button">Cancel</button></form>';
    const form = dialog.querySelector('form'),
      description = form.querySelector('textarea'),
      file = form.querySelector('[type=file]'),
      remove = form.querySelector('[type=checkbox]'),
      status = form.querySelector('[role=status]'),
      save = form.querySelector('[type=submit]');
    description.value = r.description;
    form.querySelector('[type=button]').onclick = () => dialog.close();
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (save.disabled) return;

      save.disabled = true;
      try {
        let path = remove.checked ? null : r.imagePath;

        if (file.files[0]) {
          const image = file.files[0];

          if (
            !['image/jpeg', 'image/png', 'image/webp'].includes(image.type) ||
            image.size > 5242880
          )
            throw Error('Choose a JPEG, PNG or WebP up to 5 MB.');

          path = w.id + '/' + roomId + '/' + crypto.randomUUID();
          const result = await client.storage
            .from('room-images')
            .upload(path, image, { contentType: image.type });

          if (result.error) throw result.error;
        }

        const result = await client.rpc('edit_owned_room', {
          p_character: c.id,
          p_room: roomId,
          p_description: description.value,
          p_image: path,
        });

        if (result.error) throw result.error;

        await refresh();
        dialog.close();
        notify('Room description and image saved.');
      } catch (e) {
        status.textContent = e.message || 'Could not save.';
      } finally {
        save.disabled = false;
      }
    };
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  };

  return {
    refresh() {
      const c = getCharacter();
      button.hidden = !c || getWorld().rooms[c.location]?.ownerCharacter !== c.id;
    },
  };
}
