// Mentions are plain chat text. The online world roster only supplies suggestions.
window.APSUAttention = (() => {
  const folded = (s) =>
    String(s || '')
      .normalize('NFKC')
      .toLocaleLowerCase();

  function mentioned(body, username, character) {
    let explicit = false;
    const text = folded(body).replace(/(^|\s)@([^@()\n]+?) \([^()\n]+\)/g, (all, space, name) => {
      if (name.trim() === folded(username)) explicit = true;

      return space;
    });

    if (explicit) return true;

    return [username, character].filter(Boolean).some((name) => {
      const token = '@' + folded(name);
      let at = text.indexOf(token);

      while (at !== -1) {
        const before = text[at - 1],
          after = text[at + token.length];

        if ((!before || /\s|[([{]/.test(before)) && (!after || /\s|[.,!?;:)\]}]/.test(after)))
          return true;

        at = text.indexOf(token, at + token.length);
      }

      return false;
    });
  }

  function composer(input, { client, context, isOOC }) {
    const menu = document.createElement('div');
    menu.id = 'mention-options';
    menu.className = 'mention-options';
    menu.hidden = true;
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', 'Mention a player');
    input.after(menu);
    input.setAttribute('aria-controls', menu.id);
    input.setAttribute('aria-autocomplete', 'list');
    let roster = [],
      loadedWorld = null,
      loadedAt = 0,
      loading = null,
      matches = [],
      active = 0,
      start = 0;

    function close() {
      menu.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function choose(item) {
      const end = input.selectionStart;
      const token = '@' + item.username + ' (' + item.character + ') ';
      const next = input.value.slice(0, start) + token + input.value.slice(end);

      if (Array.from(next).length > 500) return close();

      input.value = next;
      input.setSelectionRange(start + token.length, start + token.length);
      close();
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function paint() {
      menu.replaceChildren();
      matches.forEach((item, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.id = 'mention-option-' + i;
        b.setAttribute('role', 'option');
        b.setAttribute('aria-selected', String(i === active));
        b.textContent = item.username + ' (' + item.character + ')';
        b.onpointerdown = (e) => e.preventDefault();
        b.onclick = () => choose(item);
        menu.append(b);
      });
      menu.hidden = !matches.length;
      input.setAttribute('aria-expanded', String(!!matches.length));
      if (matches.length) input.setAttribute('aria-activedescendant', 'mention-option-' + active);
    }

    async function suggest() {
      if (!isOOC()) return close();

      const prefix = input.value.slice(0, input.selectionStart);
      const match = prefix.match(/(?:^|\s)@([^@\n()]{0,60})$/);

      if (!match) return close();

      start = prefix.lastIndexOf('@');
      const c = context();

      if (!c) return close();

      const world = c.worldId;

      if (loadedWorld !== world || Date.now() - loadedAt > 15000) {
        if (!loading)
          loading = client
            .rpc('world_online_players', { p_world: world })
            .then(({ data, error }) => {
              if (!error) {
                roster = data || [];
                loadedWorld = world;
                loadedAt = Date.now();
              }
            })
            .catch(() => {})
            .finally(() => (loading = null));

        await loading;
        if (
          input.value.slice(0, input.selectionStart) !== prefix ||
          context()?.worldId !== world ||
          !isOOC()
        )
          return;
      }

      const q = folded(match[1]);
      matches = roster
        .flatMap((p) => (p.character_names || []).map((character) => ({ ...p, character })))
        .filter(
          (p) =>
            p.player_id !== c.playerId &&
            (folded(p.username).includes(q) || folded(p.character).includes(q)),
        )
        .slice(0, 8);
      active = 0;
      paint();
    }

    input.addEventListener('input', suggest);
    input.addEventListener(
      'keydown',
      (e) => {
        if (menu.hidden || e.isComposing) return;
        if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          active = (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
          paint();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          e.stopImmediatePropagation();
          choose(matches[active]);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          close();
        }
      },
      true,
    );
    input.addEventListener('blur', close);

    return { close };
  }

  return { mentioned, composer };
})();
