const fs = require('fs'),
  vm = require('vm'),
  assert = require('assert/strict');
class El {
  constructor() {
    this.value = '';
    this.style = {};
    this.children = [];
    this.dataset = {};
    this.classList = {
      add() {},
      contains() {
        return false;
      },
    };
  }
  append(...x) {
    this.children.push(...x);
  }
  replaceChildren(...x) {
    this.children = x;
  }
  setAttribute() {}
  addEventListener() {}
  querySelector() {
    return new El();
  }
  querySelectorAll() {
    return [];
  }
  focus() {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  removeAttribute() {}
}
const elements = new Map(),
  get = (id) => {
    if (!elements.has(id)) elements.set(id, new El());
    return elements.get(id);
  };

let records = [],
  revoked = [],
  urls = 0;
const world = {
  id: 'test-world',
  title: 'Mercer',
  player: { room: 'workshop', name: 'Tester', description: '' },
};
const sandbox = {
  document: { getElementById: get },
  window: { addEventListener() {} },
  APSUSoloGallery: {
    list: async () => records.slice(),
    keep: async (r) => {
      records = records.filter((x) => x.id !== r.id);
      records.push(r);
    },
  },
  APSUSoloEngine: {
    roomsFor: () => ({
      workshop: { name: 'Workshop', description: 'A room' },
      street: { name: 'Street', description: 'Outside' },
    }),
    actors: () => [],
    inventory: () => [],
  },
  APSUItems: { name: (i) => i.name },
  crypto: globalThis.crypto,
  Blob,
  Uint8Array,
  atob,
  AbortSignal,
  URL: { createObjectURL: () => 'blob:' + ++urls, revokeObjectURL: (u) => revoked.push(u) },
  fetch: async () => ({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ data: [{ b64_json: 'aGVsbG8=', media_type: 'image/png' }], cost: 0 }),
  }),
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('js/solo-imagine.js', 'utf8'), sandbox);
const init = () =>
  sandbox.window.createSoloImagine(
    () => world,
    () => 'sk-or-v1-' + 'x'.repeat(40),
  );
(async () => {
  let ui = init();
  await ui.refresh();
  get('image-reuse-key').checked = true;
  get('image-model').value = 'inclusionai/ming-image-0.1-design';
  get('connect-image').onclick();
  get('image-prompt').value = 'A workshop';
  const generate = async () => {
    get('image-approve').checked = true;
    await get('generate-image').onclick();
  };
  await generate();
  assert.equal(get('image-decision').hidden, false);
  await get('keep-image').onclick();
  assert.equal(records.length, 1);
  assert.equal(get('scene-gallery').hidden, false);
  await generate();
  get('discard-image').onclick();
  assert.equal(records.length, 1);
  assert.equal(get('image-preview').hidden, true);
  await generate();
  await get('keep-image').onclick();
  assert.equal(get('scene-position').textContent, '2 / 2');
  get('kept-scene').onclick();
  assert.equal(get('surroundings-viewer').open, true);
  get('surroundings-zoom-in').onclick();
  assert.equal(get('surroundings-expanded').style.width, '125%');
  get('surroundings-viewer-close').onclick();
  get('scene-previous').onclick();
  assert.equal(get('scene-position').textContent, '1 / 2');
  get('scene-next').onclick();
  assert.equal(get('scene-position').textContent, '2 / 2');
  ui = init();
  await ui.refresh();
  assert.equal(get('scene-position').textContent, '2 / 2');
  get('image-reuse-key').checked = true;
  get('image-model').value = 'inclusionai/ming-image-0.1-design';
  get('connect-image').onclick();
  get('generate-surroundings').onclick();
  assert.match(get('image-prompt').value, /Workshop/);
  await generate();
  await get('keep-image').onclick();
  assert.equal(records.length, 3);
  assert.equal(get('surroundings-image').hidden, false);
  assert.equal(get('scene-position').textContent, '2 / 2');
  const first = records.find((r) => r.purpose === 'surroundings');
  assert.equal(first.roomId, 'workshop');
  get('generate-surroundings').onclick();
  await generate();
  get('discard-image').onclick();
  assert.equal(
    records.find((r) => r.purpose === 'surroundings'),
    first,
  );
  await generate();
  await get('keep-image').onclick();
  assert.equal(records.length, 3, 'Replacing a room image does not accumulate orphan images');
  world.player.room = 'street';
  await ui.refresh();
  assert.equal(get('surroundings-image').hidden, true);
  world.player.room = 'workshop';
  ui = init();
  await ui.refresh();
  assert.equal(get('surroundings-image').hidden, false, 'Room image survives reload');
  get('surroundings-image').onclick();
  assert.equal(get('surroundings-viewer').open, true);
  get('surroundings-zoom-in').onclick();
  assert.equal(get('surroundings-expanded').style.width, '125%');
  get('surroundings-zoom-reset').onclick();
  assert.equal(get('surroundings-expanded').style.width, '100%');
  get('surroundings-viewer-close').onclick();
  assert.equal(get('surroundings-viewer').open, false);

  // Closing/reopening the dialog must not imply an unfinished job has a preview.
  get('image-reuse-key').checked = true;
  get('image-model').value = 'inclusionai/ming-image-0.1-design';
  get('connect-image').onclick();
  const immediateFetch = sandbox.fetch;
  let finish;
  let calls = 0;
  sandbox.fetch = () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  get('generate-surroundings').onclick();
  get('image-approve').checked = true;
  const running = get('generate-image').onclick();
  assert.equal(get('surroundings-loading').hidden, false);
  get('close-imagine').onclick();
  assert.equal(get('solo-imagine-dialog').open, false);
  get('generate-surroundings').onclick();
  assert.match(get('image-status').textContent, /Generating one image/);
  assert.doesNotMatch(get('image-status').textContent, /Keep or discard/);
  await get('generate-image').onclick();
  assert.equal(calls, 1);
  get('close-imagine').onclick();
  world.player.room = 'street';
  await ui.refresh();
  assert.equal(get('surroundings-loading').hidden, true);
  finish(await immediateFetch());
  await running;
  assert.equal(get('solo-imagine-dialog').open, false, 'Completion must not interrupt play');
  assert.equal(get('surroundings-decision').hidden, true, 'Preview stays with original room');
  world.player.room = 'workshop';
  await ui.refresh();
  assert.equal(get('surroundings-loading').hidden, true);
  assert.equal(get('surroundings-decision').hidden, false);
  assert.match(get('surroundings-image').alt, /unsaved/);
  get('discard-surroundings').onclick();
  assert.equal(get('surroundings-decision').hidden, true);
  assert.match(get('surroundings-image').alt, /saved surroundings/);
  sandbox.fetch = async () => {
    throw Error('Network interrupted');
  };
  get('generate-surroundings').onclick();
  await generate();
  assert.equal(get('surroundings-loading').hidden, true);
  assert.match(get('surroundings-image-status').textContent, /Network interrupted/);
  assert.equal(get('generate-image').disabled, false);
  sandbox.fetch = immediateFetch;
  await generate();
  await get('keep-surroundings').onclick();
  assert.equal(get('surroundings-decision').hidden, true);
  assert.match(get('surroundings-image').alt, /saved surroundings/);
  assert(revoked.length > 0);
  assert(!JSON.stringify(records).includes('sk-or'));
  console.log(
    'PASS: Keep, Discard, local gallery reload, previous/next, credential exclusion and object URL cleanup. Mocked image generation only.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
