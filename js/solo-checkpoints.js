// Checkpoints use a separate database so existing world storage needs no upgrade.
(() => {
  async function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('apsu-solo-checkpoints', 1);
      request.onupgradeneeded = () =>
        request.result
          .createObjectStore('snapshots', { keyPath: 'id' })
          .createIndex('world', 'world');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(Error('Checkpoint storage is unavailable.'));
    });
  }

  async function transaction(mode, run) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('snapshots', mode);
      let result;
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onabort = () => {
        db.close();
        reject(Error('Checkpoint could not be saved. Check available browser storage.'));
      };
      tx.onerror = () => {};
      run(tx.objectStore('snapshots'), (value) => (result = value));
    });
  }

  const api = {
    async keep(world, label) {
      label = label.trim();
      if (!label || label.length > 60)
        throw Error('Give the checkpoint a name of 1–60 characters.');
      if (world.activePick) throw Error('Finish lockpicking before saving a checkpoint.');

      const value = {
        id: crypto.randomUUID(),
        world: world.id,
        label,
        at: new Date().toISOString(),
        snapshot: APSUSoloEngine.validate(world),
      };
      await transaction('readwrite', (s) => s.put(value));

      return value;
    },
    list: (world) =>
      transaction('readonly', (s, done) => {
        s.index('world').getAll(world).onsuccess = (e) =>
          done(e.target.result.sort((a, b) => b.at.localeCompare(a.at)));
      }),
    remove: (id) => transaction('readwrite', (s) => s.delete(id)),
    async branch(snapshot) {
      const copy = APSUSoloEngine.validate(snapshot);
      copy.id = crypto.randomUUID();
      copy.revision = 0;

      return APSUSoloStore.save(copy, true);
    },
    mount({ getWorld, available, restore }) {
      const $ = (id) => document.getElementById(id),
        status = $('checkpoint-status');

      let working = false;

      const run = async (task) => {
        if (working) return;

        working = true;
        try {
          if (!available()) throw Error('Finish the current action before managing checkpoints.');

          await task();
        } catch (e) {
          status.textContent = e.message;
        } finally {
          working = false;
        }
      };

      async function render() {
        const list = $('checkpoint-list');
        list.replaceChildren();
        for (const row of await api.list(getWorld().id)) {
          const box = document.createElement('section'),
            title = document.createElement('h3');
          title.textContent = row.label;
          box.append(title);
          const date = document.createElement('p');
          date.textContent = new Date(row.at).toLocaleString();
          box.append(date);
          for (const [label, action] of [
            [
              'Restore',
              async () => {
                await restore(row.snapshot);
                status.textContent = 'Restored. The previous state was saved as a checkpoint.';
                await render();
              },
            ],
            [
              'Branch',
              async () => {
                const world = await api.branch(row.snapshot);
                status.replaceChildren(document.createTextNode('Branch saved. '));
                const a = document.createElement('a');
                a.href = 'solo.html?save=' + encodeURIComponent(world.id);
                a.textContent = 'Continue this branch';
                status.append(a);
              },
            ],
            [
              'Delete checkpoint',
              async () => {
                await api.remove(row.id);
                await render();
              },
            ],
          ]) {
            const b = document.createElement('button');
            b.textContent = label;
            b.onclick = () => run(action);
            box.append(b);
          }

          list.append(box);
        }
        if (!list.children.length) list.textContent = 'No checkpoints yet.';
      }

      $('open-checkpoints').onclick = () =>
        run(async () => {
          await render();
          status.textContent = '';
          $('checkpoint-dialog').showModal();
        });
      $('checkpoint-create').onclick = () =>
        run(async () => {
          await api.keep(getWorld(), $('checkpoint-name').value);
          $('checkpoint-name').value = '';
          status.textContent = 'Checkpoint saved.';
          await render();
        });
      $('checkpoint-close').onclick = () => $('checkpoint-dialog').close();
    },
  };
  globalThis.APSUSoloCheckpoints = api;
})();
