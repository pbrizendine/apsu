// Apply the saved palette before paint. Only this browser's preference changes.
(() => {
  const key = 'apsu-theme';
  const themes = [
    ['light', 'Light', 'Cool blue and soft panels'],
    ['dark', 'Dark', 'Charcoal and soft white'],
    ['parchment', 'Parchment', 'Warm cream and brown'],
    ['white', 'White', 'Clean white and soft silver'],
    ['forest', 'Forest', 'Deep evergreen and sage'],
    ['fantasy', 'High Fantasy', 'Moonlit citadel, dragon silhouettes and heraldic details'],
    ['cyberpunk', 'Night District', 'Layered towers, neon signage and technical framing'],
    ['deco', 'Art Deco', 'Stepped skyline, brass fanwork and geometric borders'],
    ['midnight', 'Midnight Blue', 'Ink blue, silver and quiet stars'],
  ];

  const normalize = (value) => (themes.some(([id]) => id === value) ? value : 'light');

  let picker,
    trigger,
    worldId = null,
    worldTheme = null,
    worldOverride = null,
    autoButton;
  const worldKey = 'apsu-world-themes-v1';

  function overrides() {
    try {
      const v = JSON.parse(APSUStorage.getItem(worldKey) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  }

  function inferWorld(world) {
    const bp = world.blueprint || {};
    const setting = [world.title, bp.premise, ...(bp.zones || []).map((z) => z.name)]
      .join(' ')
      .toLowerCase();

    if (/art[ -]?deco|jazz|roaring twenties/.test(setting)) return 'deco';
    if (/cyberpunk|cybernetic|megacorp|neon[- ]lit|dystopian.*city/.test(setting))
      return 'cyberpunk';
    if (/fantasy|dragon|sorcer|elven|wizard|enchanted|medieval/.test(setting)) return 'fantasy';
    if (/woodland|forest|wilderness/.test(setting)) return 'forest';
    if (/space|starship|galaxy|orbital/.test(setting)) return 'midnight';
    if (/victorian|historical|ancient/.test(setting)) return 'parchment';

    return 'dark';
  }

  function saveWorldChoice(value) {
    const map = overrides();

    if (value) map[worldId] = value;
    else delete map[worldId];
    try {
      APSUStorage.setItem(worldKey, JSON.stringify(map));
    } catch {}

    worldOverride = value;
    apply(value || worldTheme);
  }

  window.APSUTheme = {
    inferWorld,
    setWorld(world) {
      if (!world?.id) return;

      const next = inferWorld(world);

      if (worldId === world.id && worldTheme === next) return;

      worldId = world.id;
      worldTheme = next;
      const stored = overrides()[worldId];
      worldOverride = themes.some(([id]) => id === stored) ? stored : null;
      document.documentElement.dataset.worldTheme = 'true';
      apply(worldOverride || worldTheme);
      if (autoButton) autoButton.hidden = false;
    },
  };

  function apply(value) {
    const theme = normalize(value);
    document.documentElement.dataset.theme = theme;
    if (trigger)
      trigger.textContent =
        (worldId && !worldOverride ? 'World theme · ' : 'Theme · ') +
        themes.find(([id]) => id === theme)[1] +
        ' ▾';
    if (autoButton) {
      autoButton.hidden = !worldId;
      autoButton.setAttribute('aria-pressed', String(!!worldId && !worldOverride));
    }

    document.querySelectorAll('[data-theme-option]').forEach((button) => {
      const active = button.dataset.themeOption === theme;
      button.setAttribute('aria-pressed', String(active));
      button.querySelector('.theme-selected').textContent = active ? 'Selected' : '';
    });
    document.querySelectorAll('#lockpick-dialog iframe').forEach((frame) => {
      try {
        frame.contentDocument.documentElement.dataset.theme = theme;
      } catch {}
    });
  }

  let saved = 'light';

  try {
    saved = APSUStorage.getItem(key);
  } catch {}

  apply(saved);
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.body.classList.contains('app-page')) return;

    const header = document.querySelector('body > header');

    if (!header) return;

    picker = document.createElement('details');
    picker.className = 'theme-picker';
    trigger = document.createElement('summary');
    const panel = document.createElement('div');
    panel.className = 'theme-options';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', 'Choose a theme');
    for (const [value, name, description] of themes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.themeOption = value;
      button.setAttribute('aria-label', name + ' theme: ' + description);
      const preview = document.createElement('span');
      preview.className = 'theme-preview';
      preview.setAttribute('aria-hidden', 'true');
      // A miniature room layout: sidebar, chat panel, and message lines.
      for (const part of ['preview-sidebar', 'preview-chat']) {
        const block = document.createElement('span');
        block.className = part;
        for (let i = 0; i < 3; i++) block.append(document.createElement('i'));

        preview.append(block);
      }

      const text = document.createElement('span');
      text.className = 'theme-option-copy';
      const label = document.createElement('strong');
      label.textContent = name;
      const detail = document.createElement('small');
      detail.textContent = description;
      const selected = document.createElement('small');
      selected.className = 'theme-selected';
      text.append(label, detail, selected);
      button.append(preview, text);
      button.addEventListener('click', () => {
        if (worldId) saveWorldChoice(value);
        else {
          apply(value);
          try {
            APSUStorage.setItem(key, value);
          } catch {}
        }

        picker.open = false;
        trigger.focus();
      });
      panel.append(button);
    }

    autoButton = document.createElement('button');
    autoButton.type = 'button';
    autoButton.textContent = 'Use this world’s theme';
    autoButton.hidden = !worldId;
    autoButton.onclick = () => {
      saveWorldChoice(null);
      picker.open = false;
      trigger.focus();
    };
    panel.prepend(autoButton);
    picker.append(trigger, panel);
    header.prepend(picker);
    apply(document.documentElement.dataset.theme);
    document.addEventListener('click', (event) => {
      if (!picker.contains(event.target)) picker.open = false;
    });
    picker.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        picker.open = false;
        trigger.focus();
      }
    });
  });
  window.addEventListener('storage', (event) => {
    if (!window.APSUPrivacy?.preferencesAllowed()) return;
    if (worldId && (event.key === worldKey || event.key === null)) {
      worldOverride = overrides()[worldId] || null;
      apply(worldOverride || worldTheme);
    } else if (!worldId && (event.key === key || event.key === null)) apply(event.newValue);
  });
})();
