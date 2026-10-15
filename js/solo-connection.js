// Optional device credentials are separate from worlds, exports and chat logs.
(() => {
  const storageKey = 'apsu-solo-connection-v1';

  function validate(value) {
    if (
      !value ||
      value.provider !== 'openrouter' ||
      !/^sk-or-v1-[\w-]{20,250}$/.test(value.key) ||
      typeof value.model !== 'string' ||
      value.model.length > 160 ||
      !/^[a-z0-9-]+\/[a-z0-9][a-z0-9._:-]*$/i.test(value.model) ||
      value.model === 'openrouter/auto' ||
      value.consent !== true
    )
      throw Error('The saved AI settings are invalid. Re-enter your key and model.');

    return { provider: value.provider, key: value.key, model: value.model, consent: true };
  }

  globalThis.APSUSoloConnection = {
    load() {
      const raw = localStorage.getItem(storageKey);
      return raw ? validate(JSON.parse(raw)) : null;
    },
    save(value) {
      localStorage.setItem(storageKey, JSON.stringify(validate(value)));
    },
    forget() {
      localStorage.removeItem(storageKey);
    },
  };
})();
