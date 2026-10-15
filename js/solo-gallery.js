// Kept illustrations live locally, separately from lightweight JSON world saves.
(() => {
  let database;

  function open() {
    return (database ||= new Promise((resolve, reject) => {
      const request = indexedDB.open('apsu-solo-images', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('images', { keyPath: 'id' }).createIndex('world', 'world');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        database = null;
        reject(Error('Local image storage is unavailable. Download the image instead.'));
      };
    }));
  }

  async function transaction(mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(
          Error('Could not save the image. Browser storage may be full; download it instead.'),
        );
      const request = work(tx.objectStore('images'));
      request.onsuccess = () => {
        result = request.result;
      };
    });
  }

  globalThis.APSUSoloGallery = {
    list: (world) => transaction('readonly', (s) => s.index('world').getAll(world)),
    keep: (record) => transaction('readwrite', (s) => s.put(record)),
    async removeWorld(world) {
      const rows = await transaction('readonly', (s) => s.index('world').getAll(world));

      for (const row of rows) await transaction('readwrite', (s) => s.delete(row.id));
    },
  };
})();
