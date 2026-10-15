// Positions and edges come from saved world data; no room labels are hardcoded.
function renderWorldMap(container, rooms, current, options = {}) {
  if (options.explorer) return renderFloorPlan(container, rooms, current, options);

  container.replaceChildren();
  let visible = Object.keys(rooms);

  if (options.nearby && rooms[current]) {
    // The minimap shows only the current room and directly connected neighbors.
    // The expanded map keeps the complete network.
    visible = [...new Set([current, ...(rooms[current].exits || [])])].filter((id) => rooms[id]);
  }

  const entries = visible.map((id) => [id, { ...rooms[id] }]);

  if (!entries.length) return;
  if (new Set(entries.map(([, r]) => r.mapX + ',' + r.mapY)).size !== entries.length) {
    const columns = Math.ceil(Math.sqrt(entries.length));
    entries.forEach(([, r], i) => {
      r.mapX = i % columns;
      r.mapY = Math.floor(i / columns);
    });
  }

  const placed = Object.fromEntries(entries);
  const ns = 'http://www.w3.org/2000/svg',
    svg = document.createElementNS(ns, 'svg');
  const xs = entries.map(([, r]) => r.mapX),
    ys = entries.map(([, r]) => r.mapY),
    minX = Math.min(...xs),
    minY = Math.min(...ys);
  const width = (Math.max(...xs) - minX) * 140 + 140,
    height = (Math.max(...ys) - minY) * 85 + 75;

  if (options.nearby) {
    const center = placed[current];
    const x = (center.mapX - minX) * 140 + 70;
    const y = (center.mapY - minY) * 85 + 37;
    // Fixed scale: distant branches are clipped instead of shrinking every label.
    const nearbyWidth = Math.min(430, Math.max(280, width));
    const nearbyHeight = Math.min(250, Math.max(110, height));
    const left = width <= 430 ? (width - nearbyWidth) / 2 : x - nearbyWidth / 2;
    const top = height <= 250 ? (height - nearbyHeight) / 2 : y - nearbyHeight / 2;
    svg.setAttribute('viewBox', `${left} ${top} ${nearbyWidth} ${nearbyHeight}`);
    svg.classList.add('nearby-map');
  } else svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    'Location map. ' +
      entries
        .map(
          ([id, r]) =>
            r.name +
            (id === current ? ' (you are here)' : '') +
            ' connects to ' +
            r.exits
              .map((e) => rooms[e]?.name)
              .filter(Boolean)
              .join(', '),
        )
        .join('. '),
  );

  const position = (r) => [(r.mapX - minX) * 140 + 70, (r.mapY - minY) * 85 + 37];

  const seen = new Set();

  for (const [id, room] of entries)
    for (const to of room.exits) {
      if (!placed[to]) continue;

      const key = [id, to].sort().join(':');

      if (seen.has(key)) continue;

      seen.add(key);
      const [x1, y1] = position(room),
        [x2, y2] = position(placed[to]);
      const line = document.createElementNS(ns, 'line');

      for (const [k, v] of Object.entries({ x1, y1, x2, y2 })) line.setAttribute(k, v);

      line.setAttribute('class', 'map-edge');
      svg.append(line);
    }
  for (const [id, r] of entries) {
    const [x, y] = position(r),
      g = document.createElementNS(ns, 'g'),
      rect = document.createElementNS(ns, 'rect'),
      text = document.createElementNS(ns, 'text');

    for (const [k, v] of Object.entries({ x: x - 60, y: y - 20, width: 120, height: 40, rx: 6 }))
      rect.setAttribute(k, v);

    rect.setAttribute('class', id === current ? 'map-node current' : 'map-node');
    text.setAttribute('x', x);
    text.setAttribute('y', y + 4);
    text.setAttribute('text-anchor', 'middle');
    const limit = options.nearby ? 11 : 17;
    text.textContent = r.name.length > limit ? r.name.slice(0, limit - 1) + '…' : r.name;
    const title = document.createElementNS(ns, 'title');
    title.textContent = r.name;
    g.append(title, rect, text);
    svg.append(g);
  }

  container.append(svg);
}

// Place adjacent rooms beside one another, independent of model array coordinates.
function floorPlanLayout(rooms, current) {
  const ids = Object.keys(rooms),
    placed = {},
    occupied = new Set(),
    tree = new Set();
  const roots = [current, ...ids].filter((id, i, a) => rooms[id] && a.indexOf(id) === i);
  const directions = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];

  const edgeKey = (a, b) => [a, b].sort().join(':');

  for (const root of roots) {
    if (placed[root]) continue;

    let x = 0;

    while (occupied.has(x + ',0')) x++;

    placed[root] = { x, y: 0 };
    occupied.add(x + ',0');
    const queue = [root];

    for (const id of queue)
      for (const next of rooms[id].exits || []) {
        if (!rooms[next] || placed[next]) continue;

        const at = placed[id];
        const candidates = [];

        for (let radius = 1; radius <= ids.length + 1 && !candidates.length; radius++)
          for (let dx = -radius; dx <= radius; dx++)
            for (let dy = -radius; dy <= radius; dy++) {
              if (Math.abs(dx) + Math.abs(dy) !== radius) continue;

              const x = at.x + dx,
                y = at.y + dy;

              if (!occupied.has(x + ',' + y)) candidates.push({ x, y });
            }

        candidates.sort((a, b) => {
          const score = (p) =>
            (rooms[next].exits || [])
              .filter((e) => placed[e])
              .reduce((s, e) => s + Math.abs(p.x - placed[e].x) + Math.abs(p.y - placed[e].y), 0) *
              10 +
            Math.abs(p.x) +
            Math.abs(p.y) +
            4 *
              Math.max(
                Math.max(p.x, ...Object.values(placed).map((n) => n.x)) -
                  Math.min(p.x, ...Object.values(placed).map((n) => n.x)),
                Math.max(p.y, ...Object.values(placed).map((n) => n.y)) -
                  Math.min(p.y, ...Object.values(placed).map((n) => n.y)),
              );

          return score(a) - score(b) || b.x - a.x || b.y - a.y;
        });
        placed[next] = candidates[0];
        occupied.add(candidates[0].x + ',' + candidates[0].y);
        tree.add(edgeKey(id, next));
        queue.push(next);
      }
  }

  const interior = ids.filter((id) => !rooms[id].portal);

  if (interior.length) {
    const outsideX = Math.max(...interior.map((id) => placed[id].x)) + 2;
    ids
      .filter((id) => rooms[id].portal)
      .forEach((id, i) => {
        placed[id] = { x: outsideX, y: i * 2 };
      });
  }

  const nodes = Object.fromEntries(
    ids.map((id) => [id, { ...placed[id], cx: placed[id].x * 12, cy: placed[id].y * 9 }]),
  );
  const minX = Math.min(...ids.map((id) => nodes[id].cx)) - 7,
    maxX = Math.max(...ids.map((id) => nodes[id].cx)) + 7;
  const minY = Math.min(...ids.map((id) => nodes[id].cy)) - 6,
    maxY = Math.max(...ids.map((id) => nodes[id].cy)) + 6;
  const edges = [],
    seen = new Set();

  for (const id of ids)
    for (const to of rooms[id].exits || []) {
      const key = edgeKey(id, to);

      if (!nodes[to] || seen.has(key)) continue;

      seen.add(key);
      const start = nodes[id],
        end = nodes[to],
        queue = [[start.cx, start.cy]],
        prev = new Map([[start.cx + ',' + start.cy, null]]);
      let found = false;

      for (let i = 0; i < queue.length && i < 50000; i++) {
        const [x, y] = queue[i];

        if (x === end.cx && y === end.cy) {
          found = true;
          break;
        }

        const ds = [...directions].sort(
          (a, b) =>
            Math.abs(x + a[0] - end.cx) +
            Math.abs(y + a[1] - end.cy) -
            (Math.abs(x + b[0] - end.cx) + Math.abs(y + b[1] - end.cy)),
        );

        for (const [dx, dy] of ds) {
          const nx = x + dx,
            ny = y + dy,
            k = nx + ',' + ny;

          if (nx < minX || nx > maxX || ny < minY || ny > maxY || prev.has(k)) continue;
          if (
            ids.some(
              (other) =>
                other !== id &&
                other !== to &&
                Math.abs(nx - nodes[other].cx) <= 4 &&
                Math.abs(ny - nodes[other].cy) <= 3,
            )
          )
            continue;

          prev.set(k, [x, y]);
          queue.push([nx, ny]);
        }
      }

      const points = [];

      if (found) {
        let p = [end.cx, end.cy];

        while (p) {
          points.push(p);
          p = prev.get(p.join(','));
        }

        points.reverse();
      }

      edges.push({ from: id, to, points, extra: !tree.has(key) });
    }

  return { nodes, edges, minX, minY, maxX, maxY };
}

function renderFloorPlan(container, rooms, current, options) {
  const all = rooms;

  if (options.nearby && rooms[current])
    rooms = Object.fromEntries(
      [current, ...rooms[current].exits].filter((id) => rooms[id]).map((id) => [id, rooms[id]]),
    );

  const ids = Object.keys(rooms);
  container.replaceChildren();
  if (!ids.length) return;

  container.classList.remove('room-explorer');
  container.classList.add('floorplan');
  const layout = floorPlanLayout(rooms, current),
    ns = 'http://www.w3.org/2000/svg';

  const element = (tag, attrs = {}, text) => {
    const el = document.createElementNS(ns, tag);

    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text) el.textContent = text;

    return el;
  };

  const width = (layout.maxX - layout.minX) * 20,
    height = (layout.maxY - layout.minY) * 20;
  const svg = element('svg', {
    viewBox: `${layout.minX * 20} ${layout.minY * 20} ${width} ${height}`,
    role: options.nearby ? 'img' : 'group',
    'aria-label':
      'Room floor plan. Passages show actual connections. Crossing passages are not extra exits.',
  });
  const defs = element('defs'),
    patternId = 'floor-' + Math.random().toString(36).slice(2);
  const pattern = element('pattern', {
    id: patternId,
    width: 20,
    height: 20,
    patternUnits: 'userSpaceOnUse',
  });
  pattern.append(element('path', { d: 'M 20 0 L 0 0 0 20', class: 'floor-grid' }));
  defs.append(pattern);
  svg.append(defs);
  svg.append(
    element('rect', {
      x: layout.minX * 20,
      y: layout.minY * 20,
      width,
      height,
      fill: `url(#${patternId})`,
    }),
  );
  if (options.building) {
    const inner = ids.filter((id) => !rooms[id].portal).map((id) => layout.nodes[id]);

    if (inner.length) {
      const left = Math.min(...inner.map((n) => n.cx)) * 20 - 100,
        top = Math.min(...inner.map((n) => n.cy)) * 20 - 95;
      const right = Math.max(...inner.map((n) => n.cx)) * 20 + 100,
        bottom = Math.max(...inner.map((n) => n.cy)) * 20 + 80;
      svg.append(
        element('rect', {
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
          class: 'floor-building-boundary',
        }),
      );
      svg.append(
        element(
          'text',
          { x: left + 10, y: top + 22, class: 'floor-building-title' },
          options.building.name,
        ),
      );
    }
  }

  const passages = [];
  layout.edges.forEach((edge, index) => {
    if (!edge.points.length) return;

    const points = edge.points.map((p) => p.map((v) => v * 20).join(',')).join(' ');
    const group = element('g', { 'data-from': edge.from, 'data-to': edge.to });
    group.append(
      element('polyline', { points, class: 'floor-corridor-wall' }),
      element('polyline', { points, class: 'floor-corridor' }),
    );
    svg.append(group);
    passages.push(group);
  });
  const status = document.createElement('p');
  status.className = 'floorplan-status';
  status.textContent =
    (options.overview
      ? 'Select a building or outdoor location to trace its routes.'
      : 'Select a room to trace its passages.') +
    ' Drag to pan; use + and − to zoom. Crossings do not create exits.';
  for (const id of ids) {
    const n = layout.nodes[id],
      x = n.cx * 20,
      y = n.cy * 20;
    const group = element('g', {
      class:
        'floor-room' +
        (id === current ? ' current' : '') +
        (rooms[id].portal ? ' exterior-portal' : '') +
        (rooms[id].outdoor ? ' outdoor-room' : ''),
      ...(options.nearby
        ? {}
        : {
            role: 'button',
            tabindex: 0,
            'aria-label': rooms[id].name + (id === current ? ' · You are here' : ''),
          }),
    });
    group.append(element('title', {}, rooms[id].name));
    group.append(
      element('rect', { x: x - 80, y: y - 60, width: 160, height: 120, class: 'floor-wall' }),
      element('rect', { x: x - 72, y: y - 52, width: 144, height: 104, class: 'floor-surface' }),
    );
    // Door thresholds are drawn only where a real passage crosses this room's wall.
    for (const edge of layout.edges.filter((e) => e.from === id || e.to === id)) {
      const points = edge.from === id ? edge.points : [...edge.points].reverse();
      const p = points.find((p) => Math.abs(p[0] - n.cx) >= 4 || Math.abs(p[1] - n.cy) >= 3);

      if (p) {
        const vertical = Math.abs(p[0] - n.cx) >= 4;
        group.append(
          element('line', {
            x1: p[0] * 20 - (vertical ? 0 : 9),
            x2: p[0] * 20 + (vertical ? 0 : 9),
            y1: p[1] * 20 - (vertical ? 9 : 0),
            y2: p[1] * 20 + (vertical ? 9 : 0),
            class: 'floor-door',
          }),
        );
      }
    }

    const words = rooms[id].name.split(/\s+/),
      lines = [''];

    for (const word of words) {
      if ((lines.at(-1) + ' ' + word).trim().length > 15 && lines.at(-1)) lines.push('');

      lines[lines.length - 1] = (lines.at(-1) + ' ' + word).trim();
    }

    lines.slice(0, 4).forEach((line, i) =>
      group.append(
        element(
          'text',
          {
            x,
            y: y - (Math.min(lines.length, 4) - 1) * 10 + i * 20,
            'text-anchor': 'middle',
            class: 'floor-label',
          },
          line,
        ),
      ),
    );
    if (id === current)
      group.append(element('circle', { cx: x, cy: y + 39, r: 5, class: 'floor-position' }));

    const select = () => {
      for (const g of svg.querySelectorAll('.floor-room')) g.classList.remove('selected');

      group.classList.add('selected');
      passages.forEach((g) =>
        g.classList.toggle('traced', g.dataset.from === id || g.dataset.to === id),
      );
      status.textContent =
        rooms[id].name +
        (id === current ? ' · You are here' : '') +
        ' — passages to ' +
        (rooms[id].exits || [])
          .map((e) => all[e]?.name)
          .filter(Boolean)
          .join(', ');
    };

    if (!options.nearby) {
      group.onclick = select;
      group.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select();
        }
      };
    }

    svg.append(group);
  }

  const viewport = document.createElement('div');
  viewport.className = 'floorplan-viewport';
  viewport.append(svg);
  if (options.nearby) {
    container.append(viewport);
    return;
  }

  const toolbar = document.createElement('div');
  toolbar.className = 'floorplan-tools';
  let zoom = 1;

  const apply = () => {
    svg.style.width = zoom * 100 + '%';
    svg.style.height = zoom * Math.min(window.innerHeight * 0.5, 500) + 'px';
    svg.style.maxWidth = 'none';
  };

  for (const [label, title, action] of [
    ['−', 'Zoom out', () => (zoom = Math.max(0.6, zoom - 0.25))],
    ['+', 'Zoom in', () => (zoom = Math.min(4, zoom + 0.25))],
    [
      'Fit',
      'Fit map',
      () => {
        zoom = 1;
        viewport.scrollTo(0, 0);
      },
    ],
  ]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-label', title);
    b.onclick = () => {
      action();
      apply();
    };
    toolbar.append(b);
  }

  let drag = null;
  viewport.onpointerdown = (e) => {
    if (e.target.closest('[role="button"]')) return;

    drag = { x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(e.pointerId);
  };
  viewport.onpointermove = (e) => {
    if (drag) {
      viewport.scrollLeft = drag.left + drag.x - e.clientX;
      viewport.scrollTop = drag.top + drag.y - e.clientY;
    }
  };
  viewport.onpointerup = viewport.onpointercancel = () => (drag = null);
  container.append(toolbar, viewport, status);
  apply();
}
