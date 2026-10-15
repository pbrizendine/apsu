const fs = require('fs'),
  vm = require('vm'),
  assert = require('assert/strict');
class El {
  constructor() {
    this.value = '';
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
let resolveFetch;
const world = {
  player: { name: 'Tester', room: 'lobby' },
  elias: { room: 'lobby', following: false },
  items: [],
  inventory: [],
  messages: [],
  usage: { calls: 0, input: 0, output: 0 },
  doorLocked: true,
};
const engine = {
  validate: (s) => structuredClone(s),
  rooms: { lobby: { name: 'Lobby', description: '', exits: [] } },
  inventory: () => [],
  context: () => ({}),
  conversation: (s, text, r) => ({
    ...s,
    messages: [...s.messages, { who: 'Player', text }, { who: 'Elias', text: r.dialogue }],
  }),
};
engine.roomsFor = () => engine.rooms;
engine.actors = () => [
  {
    id: 'elias',
    number: 2,
    name: 'Elias',
    room: 'lobby',
    memory: '',
    goal: 'Recover recording',
    description: '',
  },
];
const sandbox = {
  document: {
    getElementById: get,
    querySelector: () => new El(),
    querySelectorAll: () => [],
    createElement: () => new El(),
    createTextNode: (t) => t,
  },
  APSUSoloEngine: engine,
  APSUSoloStore: { get: async () => world, save: async (s) => s },
  createPanelLayout: () => ({ panels: new Map() }),
  createSoloImagine() {},
  createInventoryUI: () => ({ render() {}, refreshGround() {} }),
  renderWorldMap() {},
  APSUCommands: { parse: () => null },
  APSUActionText: { render: (t) => t },
  window: { addEventListener() {} },
  location: { search: '', origin: 'http://local' },
  URLSearchParams,
  AbortSignal,
  AbortController,
  setTimeout,
  clearTimeout,
  fetch: () =>
    new Promise((r) => {
      resolveFetch = r;
    }),
};
vm.runInNewContext(fs.readFileSync('js/solo-page.js', 'utf8'), sandbox);
const tick = () => new Promise((r) => setImmediate(r));
(async () => {
  await tick();
  get('solo-provider').value = 'openrouter';
  get('solo-model').value = 'apodex/apodex-1.1-mini:free';
  get('solo-api-key').value = 'sk-or-v1-' + 'x'.repeat(40);
  get('solo-ai-consent').checked = true;
  get('solo-ai-form').onsubmit({ preventDefault() {} });
  get('solo-message').value = 'Hello';
  get('solo-chat-form').onsubmit({ preventDefault() {} });
  assert.equal(get('solo-message').value, '');
  assert(JSON.stringify(get('solo-chat').children).includes('Hello'));
  assert(!JSON.stringify(get('solo-chat').children).includes('Sending…'));
  assert.equal(get('solo-typing').textContent, 'Elias is typing…');
  get('solo-message').value = 'Next draft';
  await tick();
  resolveFetch({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ dialogue: 'Hello back' }),
  });
  await tick();
  await tick();
  assert.equal(get('solo-message').value, 'Next draft');
  assert(!JSON.stringify(get('solo-chat').children).includes('Sending…'));
  get('solo-chat-form').onsubmit({ preventDefault() {} });
  await tick();
  resolveFetch({
    ok: false,
    headers: { get: () => 'application/json' },
    json: async () => ({ error: 'Rejected' }),
  });
  await tick();
  await tick();
  assert(JSON.stringify(get('solo-chat').children).includes('Not delivered'));
  assert(JSON.stringify(get('solo-chat').children).includes('Restore draft'));
  console.log(
    'PASS: immediate echo, immediate composer clear, success reconciliation, next-draft preservation, failed-message recovery; no provider calls.',
  );
})();
