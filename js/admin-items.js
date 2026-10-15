// The same appearance editor is used by the room editor and direct item delivery.
function createItemAppearanceEditor(parent, initial = {}) {
  const area = document.createElement('div');
  area.className = 'item-appearance-editor';
  const label = document.createElement('label');
  label.textContent = 'Item image (optional · up to 5 MB)';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp';
  label.append(input);
  const preview = document.createElement('div'),
    icons = document.createElement('div'),
    legend = document.createElement('p');
  legend.textContent = 'Or choose an icon';
  icons.className = 'item-icon-options';
  icons.setAttribute('role', 'group');
  icons.setAttribute('aria-label', 'Item icon');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Use icon instead';
  let selected = initial.icon || 'box',
    path = initial.image_path || null,
    file = null,
    localUrl = null;
  let uploadedFile = null,
    uploadedPath = null;

  function refresh() {
    preview.replaceChildren(
      APSUItems.visual({ icon: selected, image_path: file ? null : path }, supabaseClient),
    );
    if (file) {
      const image = document.createElement('img');
      image.alt = 'Item image preview';
      image.src = localUrl;
      preview.firstChild.replaceChildren(image);
    }

    remove.hidden = !file && !path;
    for (const button of icons.children)
      button.setAttribute('aria-pressed', String(button.dataset.icon === selected));
  }

  for (const [value, name] of Object.entries(APSUItems.labels)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.icon = value;
    button.title = name;
    button.append(APSUItems.icon(value), document.createTextNode(name));
    button.onclick = () => {
      selected = value;
      refresh();
    };
    icons.append(button);
  }

  input.onchange = () => {
    if (localUrl) URL.revokeObjectURL(localUrl);

    file = input.files[0] || null;
    localUrl = file ? URL.createObjectURL(file) : null;
    refresh();
  };
  remove.onclick = () => {
    if (localUrl) URL.revokeObjectURL(localUrl);

    localUrl = null;
    file = null;
    path = null;
    input.value = '';
    refresh();
  };
  area.append(label, preview, remove, legend, icons);
  parent.append(area);
  refresh();

  return {
    async value() {
      const chosenFile = file,
        icon = selected;
      let imagePath = path;

      if (chosenFile) {
        if (
          !['image/jpeg', 'image/png', 'image/webp'].includes(chosenFile.type) ||
          chosenFile.size > 5242880
        )
          throw Error('Choose an item image in JPEG, PNG or WebP, no larger than 5 MB.');
        if (uploadedFile !== chosenFile) {
          const nextPath = worldId + '/' + crypto.randomUUID();
          const upload = await supabaseClient.storage
            .from('item-images')
            .upload(nextPath, chosenFile, { contentType: chosenFile.type });

          if (upload.error) throw upload.error;

          uploadedFile = chosenFile;
          uploadedPath = nextPath;
        }

        imagePath = uploadedPath;
      }

      return { icon, image_path: imagePath };
    },
    dispose() {
      if (localUrl) URL.revokeObjectURL(localUrl);
    },
  };
}

const spawnAppearance = createItemAppearanceEditor($('spawn-appearance'));

function showDeliveryControls() {
  const character = $('spawn-destination').value === 'character';
  $('spawn-room').closest('label').hidden = character;
  $('spawn-character').closest('label').hidden = !character;
  $('spawn-character').disabled = !character;
  $('spawn-room').disabled = character;
  $('spawn-custom').hidden = $('spawn-kind').value !== 'custom';
  $('spawn-name').required = $('spawn-kind').value === 'custom';
  $('spawn-key-room').disabled = $('spawn-kind').value !== 'key';
  $('spawn-key-room').closest('label').hidden = $('spawn-kind').value !== 'key';
  $('issue-items').textContent = character ? 'Give items' : 'Place items';
}

$('spawn-destination').onchange = showDeliveryControls;
$('spawn-kind').onchange = showDeliveryControls;
showDeliveryControls();
