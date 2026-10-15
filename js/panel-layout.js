// Shared multiplayer/solo drag, snap, minimize and keyboard layout controls.
function createPanelLayout({
  left,
  right,
  key = 'apsu-panel-layout-v1',
  minimizedKey = 'apsu-minimized-panels-v1',
}) {
  const columns = [left, right];
  const panels = new Map();
  let dragging = null;
  const status = document.createElement('p');
  status.className = 'visually-hidden';
  status.setAttribute('role', 'status');
  document.body.append(status);
  const ids = ['surroundings', 'travel', 'characters', 'objects', 'inventory', 'world'];
  let sequence = 0;

  for (const column of columns)
    for (const panel of [...column.children]) {
      if (!panel.matches('section.panel')) continue;
      if (!panel.dataset.panelId) panel.dataset.panelId = ids[sequence++];

      panels.set(panel.dataset.panelId, panel);
      const heading = panel.querySelector('h2'),
        name = heading.textContent,
        toolbar = document.createElement('div');
      toolbar.className = 'panel-toolbar';
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'panel-grip';
      handle.innerHTML =
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3h1m4 0h1M5 8h1m4 0h1M5 13h1m4 0h1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      handle.draggable = false;
      handle.setAttribute('aria-label', 'Drag ' + name + ' panel');
      handle.title = 'Drag to snap into either sidebar';
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || dragging) return;

        const startX = event.clientX,
          startY = event.clientY,
          id = event.pointerId;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        let ghost = null,
          frame = 0,
          targetX,
          targetY,
          x,
          y,
          offsetX,
          offsetY,
          lastTime = 0;
        let finished = false;
        handle.setPointerCapture(id);

        function follow(time) {
          const blend = reduced
            ? 1
            : 1 - Math.exp(-Math.min(64, time - (lastTime || time - 16)) / 45);
          lastTime = time;
          x += (targetX - x) * blend;
          y += (targetY - y) * blend;
          ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          frame = requestAnimationFrame(follow);
        }

        function destination(px, py) {
          const hit = document.elementFromPoint(px, py);
          const column = hit?.closest('.room-details,.room-sidebar');

          if (!columns.includes(column)) return {};

          const target = hit.closest('[data-panel-id]');

          return { column, target: target === panel ? panel : target };
        }

        const move = (e) => {
          if (e.pointerId !== id) return;
          if (!ghost && Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
          if (!ghost) {
            const rect = panel.getBoundingClientRect();
            offsetX = startX - rect.left;
            offsetY = startY - rect.top;
            x = rect.left;
            y = rect.top;
            ghost = panel.cloneNode(true);
            // The floating copy is visual only: no duplicate IDs, focus stops or form fields.
            for (const node of [ghost, ...ghost.querySelectorAll('*')]) {
              node.removeAttribute('id');
              node.removeAttribute('name');
              node.removeAttribute('data-panel-id');
            }

            ghost.inert = true;
            ghost.setAttribute('aria-hidden', 'true');
            ghost.classList.add('panel-drag-ghost');
            ghost.style.width = rect.width + 'px';
            ghost.style.height = rect.height + 'px';
            ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            document.body.append(ghost);
            dragging = panel;
            panel.classList.add('panel-dragging');
            columns.forEach((c) => c.classList.add('layout-droppable'));
            frame = requestAnimationFrame(follow);
          }

          e.preventDefault();
          targetX = e.clientX - offsetX;
          targetY = e.clientY - offsetY;
          const { column, target } = destination(e.clientX, e.clientY);
          columns.forEach((c) => c.classList.toggle('drop-active', c === column));
          document
            .querySelectorAll('.drop-before')
            .forEach((p) => p.classList.remove('drop-before'));
          if (target && target !== panel) target.classList.add('drop-before');
          // Edge scrolling allows the same drag on a long mobile sidebar.
          if (e.clientY < 50) window.scrollBy(0, -12);
          else if (e.clientY > innerHeight - 50) window.scrollBy(0, 12);
        };

        const finish = (e) => {
          if (finished || (e.pointerId != null && e.pointerId !== id)) return;

          finished = true;
          cancelAnimationFrame(frame);
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', finish);
          handle.removeEventListener('pointercancel', finish);
          handle.removeEventListener('lostpointercapture', finish);
          window.removeEventListener('blur', finish);
          if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
          if (ghost) {
            const before = new Map(
              [...panels.values()]
                .filter((p) => !p.hidden)
                .map((p) => [p, p.getBoundingClientRect()]),
            );

            if (e.type === 'pointerup') {
              const { column, target } = destination(e.clientX, e.clientY);

              if (column) {
                if (target && target !== panel) column.insertBefore(panel, target);
                else if (!target) column.append(panel);

                save();
                status.textContent = 'Panel snapped into place.';
              }
            }

            const to = panel.getBoundingClientRect();
            const duration = reduced ? 0 : 240;

            for (const [p, old] of before) {
              if (p === panel) continue;

              const next = p.getBoundingClientRect();

              if (old.x !== next.x || old.y !== next.y)
                p.animate(
                  [
                    { transform: `translate(${old.x - next.x}px, ${old.y - next.y}px)` },
                    { transform: 'none' },
                  ],
                  { duration, easing: 'cubic-bezier(.2,.8,.2,1)' },
                );
            }

            ghost
              .animate(
                [
                  { transform: `translate3d(${x}px, ${y}px, 0)`, width: ghost.style.width },
                  {
                    transform: `translate3d(${to.left}px, ${to.top}px, 0)`,
                    width: to.width + 'px',
                  },
                ],
                { duration, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
              )
              .finished.finally(() => {
                ghost.remove();
                clearDrag();
              });
          } else clearDrag();
        };

        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', finish);
        handle.addEventListener('lostpointercapture', finish);
        window.addEventListener('blur', finish);
      });
      // Arrow keys provide the same placement choices as dragging.
      handle.title = 'Drag to move; use arrow keys when focused';
      handle.addEventListener('keydown', (event) => {
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;

        event.preventDefault();
        const column = panel.parentElement;

        if (event.key === 'ArrowLeft') left.append(panel);
        if (event.key === 'ArrowRight') right.append(panel);
        if (event.key === 'ArrowUp' && panel.previousElementSibling)
          column.insertBefore(panel, panel.previousElementSibling);
        if (event.key === 'ArrowDown' && panel.nextElementSibling)
          column.insertBefore(panel.nextElementSibling, panel);

        save();
        handle.focus();
        status.textContent = name + ' panel moved.';
      });
      const minimize = document.createElement('button');
      minimize.type = 'button';
      minimize.className = 'panel-minimize';

      const minimizeIcon = (collapsed) =>
        '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 10h12' +
        (collapsed ? 'M10 4v12' : '') +
        '"/></svg>';

      minimize.innerHTML = minimizeIcon(false);
      minimize.title = 'Minimize ' + name;
      minimize.setAttribute('aria-label', 'Minimize ' + name);
      minimize.setAttribute('aria-expanded', 'true');
      minimize.onclick = () => {
        const collapsed = panel.classList.toggle('panel-collapsed');
        minimize.innerHTML = minimizeIcon(collapsed);
        minimize.title = (collapsed ? 'Restore ' : 'Minimize ') + name;
        minimize.setAttribute('aria-label', (collapsed ? 'Restore ' : 'Minimize ') + name);
        minimize.setAttribute('aria-expanded', String(!collapsed));
        APSUStorage.setItem(
          minimizedKey,
          JSON.stringify(
            [...panels]
              .filter(([, p]) => p.classList.contains('panel-collapsed'))
              .map(([id]) => id),
          ),
        );
      };
      toolbar.append(handle, heading, minimize);
      panel.prepend(toolbar);
    }
  try {
    const minimized = JSON.parse(APSUStorage.getItem(minimizedKey)) || [];

    for (const id of minimized) panels.get(id)?.querySelector('.panel-minimize')?.click();
  } catch {}

  const defaults = columns.map((c) =>
    [...c.children].filter((p) => p.dataset.panelId).map((p) => p.dataset.panelId),
  );

  function save() {
    try {
      APSUStorage.setItem(
        key,
        JSON.stringify(
          columns.map((c) =>
            [...c.children].filter((p) => p.dataset.panelId).map((p) => p.dataset.panelId),
          ),
        ),
      );
    } catch {}
  }

  function restore(layout) {
    if (!Array.isArray(layout) || layout.length !== 2) return;

    const seen = new Set();
    layout.forEach((ids, i) => {
      if (!Array.isArray(ids)) return;
      for (const id of ids)
        if (panels.has(id) && !seen.has(id)) {
          seen.add(id);
          columns[i].append(panels.get(id));
        }
    });
  }

  try {
    restore(JSON.parse(APSUStorage.getItem(key)));
  } catch {}

  function clearDrag() {
    dragging?.classList.remove('panel-dragging');
    dragging = null;
    columns.forEach((c) => c.classList.remove('layout-droppable', 'drop-active'));
    document.querySelectorAll('.drop-before').forEach((p) => p.classList.remove('drop-before'));
  }

  return { panels, restore, defaults, save, status };
}
