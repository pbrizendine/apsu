// IndexedDB transactions resolve only after commit. Revision checks reject stale tabs.
(() => {
  let connection;

  function open() {
    if (connection) return connection;

    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open('apsu-solo', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('worlds', { keyPath: 'id' });
      request.onerror = () => {
        connection = null;
        reject(Error('Local saves are unavailable. Check browser storage settings.'));
      };
      request.onblocked = () => {
        connection = null;
        reject(Error('Close other APSU tabs before upgrading local saves.'));
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        resolve(db);
      };
    });
    return connection;
  }

  async function transaction(mode, run) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('worlds', mode);
      let result, failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(
          failure || Error('Save failed. Storage may be full. Download a backup before leaving.'),
        );
      tx.onerror = () => {};
      try {
        run(
          tx.objectStore('worlds'),
          (value) => {
            result = value;
          },
          (error) => {
            failure = error;
            tx.abort();
          },
        );
      } catch (error) {
        failure = error;
        tx.abort();
      }
    });
  }

  const store = {
    list: () =>
      transaction('readonly', (s, done) => {
        s.getAll().onsuccess = (e) => done(e.target.result);
      }),
    get: (id) =>
      transaction('readonly', (s, done) => {
        s.get(id).onsuccess = (e) =>
          done(e.target.result ? APSUSoloEngine.validate(e.target.result) : null);
      }),
    async save(world, fresh = false) {
      const value = APSUSoloEngine.validate(world);
      return transaction('readwrite', (s, done, fail) => {
        s.get(value.id).onsuccess = (e) => {
          const previous = e.target.result;

          if (
            (fresh && previous) ||
            (!fresh && (!previous || previous.revision !== value.revision))
          ) {
            fail(Error('This world changed in another tab. Reopen it before continuing.'));
            return;
          }

          value.revision++;
          value.updatedAt = new Date().toISOString();
          s.put(value);
          done(value);
        };
      });
    },
    async remove(id) {
      if (globalThis.APSUSoloGallery) await APSUSoloGallery.removeWorld(id);

      return transaction('readwrite', (s) => s.delete(id));
    },
    async importFile(file) {
      if (file.size > 32000000) throw Error('Choose an APSU save smaller than 32 MB.');

      let world;

      try {
        world = APSUSoloEngine.validate(JSON.parse(await file.text()));
      } catch {
        throw Error('This is not a supported APSU solo save. Existing worlds have not changed.');
      }

      world.id = crypto.randomUUID();
      world.revision = 0;
      // An interrupted inserted pick must not become a free retry on another device.
      if (world.activePick) world = APSUSoloEngine.act(world, 'cancel');

      return store.save(world, true);
    },
    download(world) {
      const clean = APSUSoloEngine.validate(world);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(clean)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'apsu-' + clean.id + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
  };
  globalThis.APSUSoloStore = store;
})();
