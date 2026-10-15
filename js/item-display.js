// Small hand-drawn SVG icons. Images and text always come from saved item metadata.
window.APSUItems = (() => {
  const shapes = {
    pistol: 'M3 6h18v5H11l-2 3H5l-2-3z M6 14l-1 7h5l2-10 M15 11v4h-4',
    rifle: 'M2 8h15V5h2v3h3v3H12l-2 8H7l1-8H2z',
    bow: 'M6 2q20 10 0 20L6 2 M3 12h18 M18 9l3 3-3 3',
    badge: 'M12 2l8 4v7q-2 6-8 9-6-3-8-9V6z M8 11h8 M12 7v8',
    glass: 'M5 3h14l-2 10H7z M12 13v8 M7 21h10',
    radio: 'M4 7h16v14H4z M7 7L17 2 M7 11h4 M15 11h2 M7 15h10 M7 18h10',
    document: 'M5 2h10l4 4v16H5z M15 2v5h4 M8 11h8 M8 15h8 M8 18h5',

    coin: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0 M12 7v10 M15 9h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9',
    sword: 'M15 3h6v6L9 21l-6-6z M6 12l6 6 M3 21l4-4',
    scroll:
      'M7 4h11a3 3 0 0 1 3 3v2h-5 M7 4a3 3 0 0 0-3 3v10H2v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7 M8 10h6 M8 14h6',
    ring: 'M15 4l-3-2-3 2 3 4z M17 8a7 7 0 1 1-10 0',
    necklace: 'M5 3v6a7 7 0 0 0 14 0V3 M12 16l-3 3 3 3 3-3z',
    flower: 'M12 12v10 M12 18l5-3 M12 19l-5-3 M12 10c-6 4-10-3-4-5-1-6 9-6 8 0 6 2 2 9-4 5',
    food: 'M3 13h18v4a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z M7 9c-3-3 3-3 0-6 M12 9c-3-3 3-3 0-6 M17 9c-3-3 3-3 0-6',
    cup: 'M4 4h12v12a5 5 0 0 1-10 0V4 M16 6h3a3 3 0 0 1 0 6h-3 M4 22h16',
    clothing: 'M8 3l4 3 4-3 6 5-4 5-2-2v10H8V11l-2 2-4-5z',
    boot: 'M7 2h9v12l5 3v4H4v-5h3z M8 7h4 M8 10h4',
    compass: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M16 8l-3 5-5 3 3-5z',
    envelope: 'M2 5h20v14H2z M2 5l10 8L22 5',
    feather: 'M3 21L17 7 M8 16C2 6 12 1 21 3c2 9-3 19-13 13 M12 12h6',
    lantern: 'M7 7h10l2 13H5z M6 7h12 M9 7V4a3 3 0 0 1 6 0v3 M12 12v5',
    instrument:
      'M9 18V4l11-2v13 M9 7l11-2 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M20 15a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    herb: 'M12 22V7 M12 14C2 14 2 5 4 3c7 0 8 4 8 11 M12 18c0-9 4-12 9-12 1 8-2 12-9 12',

    box: 'M3 7l9-4 9 4-9 4z M3 7v10l9 4 9-4V7 M12 11v10 M7 5l10 4',
    watch: 'M9 7V2h6v5 M9 17v5h6v-5 M12 8v4l3 2 M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0',
    key: 'M10 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M9 11l10 10 M14 16l3-3 M17 19l3-3',
    tool: 'M15 3a6 6 0 0 0-7 8L3 17a3 3 0 0 0 4 4l6-6a6 6 0 0 0 8-7l-4 4-5-5z',
    bag: 'M5 8h14l2 13H3z M8 8V6a4 4 0 0 1 8 0v2',
    book: 'M12 5v16 M12 5C8 2 5 3 2 4v15c3-1 6-1 10 2 4-3 7-3 10-2V4c-3-1-6-2-10 1',
    bottle: 'M9 2h6v5l5 7v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5l5-7z M5 14h14 M9 5h6',
    gem: 'M7 3h10l5 7-10 12L2 10z M2 10h20 M7 3l5 19 5-19 M7 3l5 7 5-7',
  };
  const labels = {
    pistol: 'Pistol',
    rifle: 'Rifle',
    bow: 'Bow',
    badge: 'Badge',
    glass: 'Glass',
    radio: 'Radio',
    document: 'Document',
    box: 'Box',
    coin: 'Coin',
    sword: 'Sword',
    scroll: 'Scroll',
    ring: 'Ring',
    necklace: 'Necklace',
    flower: 'Flower',
    food: 'Food',
    cup: 'Cup',
    clothing: 'Clothing',
    boot: 'Boot',
    compass: 'Compass',
    envelope: 'Envelope',
    feather: 'Feather',
    lantern: 'Lantern',
    instrument: 'Instrument',
    herb: 'Herb',
    watch: 'Watch',
    key: 'Key',
    tool: 'Tool',
    bag: 'Bag',
    book: 'Book',
    bottle: 'Bottle',
    gem: 'Gem',
  };
  const cache = new Map();

  function icon(name = 'box') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', shapes[name] || shapes.box);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    svg.append(path);

    return svg;
  }

  function visual(appearance = {}, client, interactive = true) {
    const frame = document.createElement('span');
    frame.className = 'item-visual';
    frame.append(icon(appearance.icon));
    if (appearance.image_path && client) {
      const path = appearance.image_path;

      if (!cache.has(path) || cache.get(path).expires < Date.now())
        cache.set(path, {
          expires: Date.now() + 3000000,
          promise: client.storage.from('item-images').createSignedUrl(path, 3600),
        });

      cache
        .get(path)
        .promise.then(({ data, error }) => {
          if (error || !data) {
            cache.delete(path);
            return;
          }

          const image = document.createElement('img');
          image.alt = appearance.name || 'Item image';
          image.onload = () => frame.replaceChildren(image);
          image.src = data.signedUrl;
        })
        .catch(() => cache.delete(path));
    }
    if (appearance.image_path && interactive) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'item-visual-button';
      button.setAttribute('aria-label', 'Enlarge ' + (appearance.name || 'item image'));
      button.append(frame);
      button.onclick = () => inspect({ kind: 'custom', appearance }, { rooms: {} }, client);

      return button;
    }

    return frame;
  }

  function name(item, world) {
    if (item.kind === 'custom') return item.appearance?.name || 'Custom item';
    if (['key', 'room-c-key'].includes(item.kind))
      return (world.rooms[item.key_room || 'roomC']?.name || item.key_room || 'Room C') + ' Key';

    return item.capacity === 0
      ? 'Broken lockpick'
      : item.capacity === 50
        ? 'Damaged lockpick'
        : 'Lockpick';
  }

  function stackKey(item) {
    const a = item.appearance || {};
    return JSON.stringify([
      item.kind,
      item.valueMinor ?? null,
      item.consumable || false,
      item.abv ?? null,
      item.servingMl ?? null,
      item.capacity,
      item.key_room || '',
      a.name || '',
      a.description || '',
      a.icon || 'box',
      a.image_path || '',
    ]);
  }

  function inspect(item, world, client) {
    const dialog = document.createElement('dialog');
    dialog.className = 'workspace-dialog item-inspect';
    const heading = document.createElement('h2'),
      description = document.createElement('p'),
      close = document.createElement('button');
    heading.textContent = name(item, world);
    heading.id = 'item-title-' + crypto.randomUUID();
    dialog.setAttribute('aria-labelledby', heading.id);
    description.textContent = item.appearance?.description || 'No description added.';
    close.type = 'button';
    close.textContent = 'Close';
    close.onclick = () => dialog.close();
    dialog.append(heading, visual(item.appearance, client, false), description);
    if (item.valueLabel) {
      const value = document.createElement('p');
      value.className = 'item-value';
      value.textContent = item.valueLabel;
      dialog.append(value);
    }

    dialog.append(close);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }

  function iconFor(item) {
    if (item.kind === 'weapon')
      return (
        { pistol: 'pistol', rifle: 'rifle', bow: 'bow', blade: 'sword', blunt: 'tool' }[
          item.template
        ] || 'tool'
      );
    if (item.kind === 'key') return 'key';
    if (item.kind === 'lockpick') return 'tool';
    if (item.kind === 'drink') return /bottle/i.test(item.name) ? 'bottle' : 'glass';

    const name = String(item.name || '').toLowerCase();

    for (const [pattern, icon] of [
      [/watch/, 'watch'],
      [/ring/, 'ring'],
      [/necklace/, 'necklace'],
      [/jewel|gem/, 'gem'],
      [/book|ledger/, 'book'],
      [/clipboard|document|paper|pass/, 'document'],
      [/radio/, 'radio'],
      [/coat|jacket|shirt/, 'clothing'],
      [/bag|case/, 'bag'],
      [/bottle/, 'bottle'],
      [/glass|cup/, 'cup'],
      [/key/, 'key'],
      [/piano|instrument/, 'instrument'],
      [/badge/, 'badge'],
    ])
      if (pattern.test(name)) return icon;

    return 'box';
  }

  return { icon, visual, name, stackKey, inspect, labels, iconFor };
})();
