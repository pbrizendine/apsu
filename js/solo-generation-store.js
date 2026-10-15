// One resumable creation draft, separate from playable worlds; no API credentials.
(() => {
  async function transaction(mode, value) {
    const clean = mode === 'readwrite' && value != null ? APSUSoloGeneration.draft(value) : null;
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('apsu-world-creation', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('drafts');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(Error('Creation draft storage is unavailable.'));
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', mode),
        store = tx.objectStore('drafts');
      let result = null;
      const request =
        mode === 'readonly'
          ? store.get('active')
          : value == null
            ? store.delete('active')
            : store.put(clean, 'active');
      request.onsuccess = () => {
        try {
          result =
            mode === 'readonly' && request.result ? APSUSoloGeneration.draft(request.result) : null;
        } catch {
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onabort = () => {
        db.close();
        reject(Error('Could not save creation progress. Free browser storage before continuing.'));
      };
      tx.onerror = () => {};
    });
  }

  globalThis.APSUSoloGenerationStore = {
    load: () => transaction('readonly'),
    clear: () => transaction('readwrite', null),
    save: (value) => transaction('readwrite', value),
  };
})();
