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

let world, inventoryOptions;
const requests = [];
const events = {};
const sandbox = {
  document: {
    getElementById: get,
    querySelector: () => new El(),
    querySelectorAll: () => [],
    createElement: () => new El(),
    createTextNode: (t) => t,
    createDocumentFragment: () => new El(),
  },
  crypto: globalThis.crypto,
  structuredClone,
  Date,
  APSUItems: { name: (i) => i.name || i.appearance?.name || 'Lockpick' },
  APSUSoloStore: { get: async () => world, save: async (s) => (world = s) },
  createPanelLayout: () => ({ panels: new Map() }),
  createSoloImagine: () => ({ refresh() {} }),
  createInventoryUI: (options) => {
    inventoryOptions = options;
    return { render() {}, refreshGround() {} };
  },
  renderWorldMap() {},
  window: { addEventListener: (name, fn) => (events[name] = fn) },
  location: { search: '', origin: 'http://local' },
  URLSearchParams,
  AbortSignal,
  AbortController,
  setTimeout,
  clearTimeout,
  fetch: (url, options) =>
    new Promise((resolve) => requests.push({ body: JSON.parse(options.body), resolve })),
};
vm.createContext(sandbox);
for (const file of ['solo-engine', 'solo-mercer', 'action-text', 'chat-commands'])
  vm.runInContext(fs.readFileSync('js/' + file + '.js', 'utf8'), sandbox);
sandbox.APSUCommands = sandbox.window.APSUCommands;
const E = sandbox.APSUSoloEngine;
world = E.createMercer('Tester');
vm.runInContext(fs.readFileSync('js/solo-page.js', 'utf8'), sandbox);
const tick = () => new Promise((r) => setImmediate(r));
const reply = async (action = 'none', dialogue = 'A reply') => {
  const req = requests.shift();
  assert(req, 'expected request');
  req.resolve({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ action, dialogue, memory: '', usage: { cost: 0 } }),
  });
  await tick();
  await tick();
  return req.body;
};
const send = async (text) => {
  get('solo-message').value = text;
  get('solo-chat-form').onsubmit({ preventDefault() {} });
  await tick();
};
(async () => {
  await tick();
  get('solo-provider').value = 'openrouter';
  get('solo-model').value = 'test/free:free';
  get('solo-api-key').value = 'sk-or-v1-' + 'x'.repeat(40);
  get('solo-ai-consent').checked = true;
  get('solo-ai-form').onsubmit({ preventDefault() {} });
  get('solo-recipient').value = 'all';
  get('solo-recipient').onchange();
  await send('/me I pick up a cloth');
  assert.equal(requests[0].body.context.message, '/me picks up a cloth');
  await reply();
  assert.equal(requests[0].body.context.actor.id, 'leon');
  assert(requests[0].body.context.recent.some((m) => m.who === 'Mara Vale'));
  await reply();
  assert.equal(world.messages.filter((m) => m.who === 'Player').length, 1);
  assert.equal(world.usage.calls, 2);
  get('solo-recipient').value = 'mara';
  get('solo-recipient').onchange();
  get('solo-reactions').checked = true;
  await send('/w 2 Secret');
  await reply();
  assert.equal(requests.length, 0, 'whispers must not trigger bystander replies');
  await send('A public exchange');
  await reply('none', 'The first reply survives.');
  assert.equal(requests[0].body.context.trigger, 'reaction');
  assert(requests[0].body.context.recent.some((m) => m.text === 'The first reply survives.'));
  requests.shift().resolve({
    ok: false,
    status: 502,
    headers: { get: () => 'application/json' },
    json: async () => ({ error: 'The model returned malformed reply JSON.' }),
  });
  await tick();
  await tick();
  assert(world.messages.some((m) => m.text === 'The first reply survives.'));
  assert.match(get('solo-error').textContent, /could not chime in/);
  assert(!JSON.stringify(get('solo-chat').children).includes('Not delivered'));
  assert.match(get('connection-status').textContent, /ready to send/);
  get('solo-reactions').checked = false;
  await send('Bad draft');
  requests.shift().resolve({
    ok: false,
    headers: { get: () => 'application/json' },
    json: async () => ({ error: 'Test failure' }),
  });
  await tick();
  await tick();
  assert(JSON.stringify(get('solo-chat').children).includes('Not delivered'));
  await send('/emphasis/');
  assert(!JSON.stringify(get('solo-chat').children).includes('Not delivered'));
  await reply('move:street');
  assert.equal(world.npcs.mara.room, 'street');
  await get('solo-exits')
    .children.find((b) => b.textContent === 'Mercer Street')
    .onclick();
  await send('Still connected?');
  assert.equal(requests[0].body.key, 'sk-or-v1-' + 'x'.repeat(40));
  await reply();
  const before = world.messages.filter((m) => m.who === 'Player').length;
  inventoryOptions.onGiven({ target: 'mara', message: '', itemName: 'A coat', quantity: 1 });
  await tick();
  assert.equal(requests[0].body.context.trigger, 'handover');
  await reply();
  assert.equal(
    world.messages.filter((m) => m.who === 'Player').length,
    before,
    'empty handover reaction must not fabricate player speech',
  );
  const beforeUndo = structuredClone(world);
  await send('A message to undo');
  await reply('move:workshop');
  assert.equal(get('solo-undo').hidden, false);
  const usageBeforeUndo = structuredClone(world.usage);
  get('solo-undo').onclick();
  await tick();
  await tick();
  assert.equal(JSON.stringify(world.messages), JSON.stringify(beforeUndo.messages));
  assert.equal(JSON.stringify(world.npcs), JSON.stringify(beforeUndo.npcs));
  assert.equal(JSON.stringify(world.usage), JSON.stringify(usageBeforeUndo));
  assert.equal(get('solo-message').value, 'A message to undo');
  assert.equal(get('solo-undo').hidden, true);
  await send('Cancel this');
  get('solo-undo').onclick();
  await reply(); // Late provider response must not mutate the cancelled turn.
  assert.equal(JSON.stringify(world.messages), JSON.stringify(beforeUndo.messages));
  assert.equal(get('solo-message').value, 'Cancel this');
  console.log(
    'PASS: action replies, third-person /me, two-person bounded group, private whisper, stale failure clearing, room movement retains key, handover reactions without fake player speech. No live inference.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
