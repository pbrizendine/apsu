// No analytics or advertising storage. Optional appearance preferences default off.
(() => {
  const consentKey = 'apsu-storage-choice-v1';
  const preferenceKeys = [
    'apsu-theme',
    'apsu-world-themes-v1',
    'apsu-panel-layout-v1',
    'apsu-minimized-panels-v1',
    'apsu-chat-height',
  ];
  const memory = new Map();
  let choice = null;

  try {
    choice = JSON.parse(localStorage.getItem(consentKey));
  } catch {}

  const allowed = () => choice?.preferences === true;

  window.APSUStorage = {
    getItem(key) {
      try {
        return allowed()
          ? localStorage.getItem(key)
          : (sessionStorage.getItem(key) ?? memory.get(key) ?? null);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem(key, value) {
      memory.set(key, String(value));
      try {
        sessionStorage.setItem(key, String(value));
      } catch {}
      if (allowed())
        try {
          localStorage.setItem(key, value);
        } catch {}
    },
    removeItem(key) {
      memory.delete(key);
      try {
        sessionStorage.removeItem(key);
      } catch {}
      try {
        localStorage.removeItem(key);
      } catch {}
    },
  };

  function save(preferences) {
    choice = { version: 1, preferences, savedAt: new Date().toISOString() };
    try {
      localStorage.setItem(consentKey, JSON.stringify(choice));
      if (!preferences) preferenceKeys.forEach((key) => localStorage.removeItem(key));
      else for (const [key, value] of memory) localStorage.setItem(key, value);
    } catch {}

    document.querySelector('.storage-banner')?.remove();
  }

  function showChoices() {
    document.querySelector('.storage-banner')?.remove();
    const panel = document.createElement('section');
    panel.className = 'storage-banner';
    panel.setAttribute('aria-label', 'Cookie and storage choices');
    panel.innerHTML =
      '<h2>Your storage choices</h2><p>APSU uses essential browser storage to keep you signed in and save solo worlds you create or import. Your theme and layout last for this tab. You can also let this browser remember them between visits. We do not use advertising or analytics cookies.</p><div class="storage-actions"><button type="button" data-essential>Essential only</button><button type="button" data-preferences>Remember preferences</button><a href="cookies.html">Read the cookie policy</a></div>';
    panel.querySelector('[data-essential]').onclick = () => save(false);
    panel.querySelector('[data-preferences]').onclick = () => save(true);
    document.body.append(panel);
  }

  window.APSUPrivacy = { showChoices, preferencesAllowed: allowed, policyVersion: '2026-10-04' };
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.body.classList.contains('app-page')) return;

    const main = document.querySelector('main');

    if (main) {
      main.id ||= 'main-content';
      main.tabIndex = -1;
      const skip = document.createElement('a');
      skip.className = 'skip-link';
      skip.href = '#' + main.id;
      skip.textContent = 'Skip to content';
      document.body.prepend(skip);
    }

    let footer = document.querySelector('body > footer');

    if (!footer) {
      footer = document.createElement('footer');
      document.body.append(footer);
    }

    footer.classList.add('site-footer');
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'Policies and account controls');
    for (const [name, path] of [
      ['Privacy', 'privacy.html'],
      ['Terms', 'terms.html'],
      ['Cookies', 'cookies.html'],
      ['Privacy & deletion requests', 'privacy-requests.html'],
    ]) {
      const a = document.createElement('a');
      a.href = path;
      a.textContent = name;
      nav.append(a);
    }

    const manage = document.createElement('button');
    manage.type = 'button';
    manage.textContent = 'Storage settings';
    manage.onclick = showChoices;
    nav.append(manage);
    footer.append(nav);
    if (!choice) showChoices();
  });
})();
