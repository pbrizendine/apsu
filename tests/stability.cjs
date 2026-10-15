const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict');
const root = path.join(__dirname, '..'),
  source = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const admin = source('admin.html');
const ids = new Set([...admin.matchAll(/\bid=["']([^"']+)/g)].map((m) => m[1]));
for (const name of ['js/admin.js', 'js/admin-tools.js'])
  for (const m of source(name).matchAll(/\$\(['"]([^'"]+)/g))
    assert(ids.has(m[1]), `Missing admin control: ${m[1]}`);
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source('js/database-api.js'), context);
(async () => {
  const invoke = context.window.APSUDatabase.call;
  let calls = [],
    code = 'PGRST202';
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return calls.length === 1 ? { error: { code } } : { data: 'ok' };
    },
  };
  const args = {
    p_id: 'one-message',
    p_visit: 'visit',
    p_body: 'Hello',
    p_kind: 'ic',
    p_images: [],
  };
  await invoke(client, 'send_chat_message', args);
  assert.equal(calls[1].name, 'send_visit_message');
  assert.equal(calls[1].args.p_id, args.p_id);
  calls = [];
  code = '42501';
  await invoke(client, 'send_chat_message', args);
  assert.equal(calls.length, 1, 'Permissions must never trigger fallback');
  calls = [];
  code = 'PGRST202';
  await invoke(client, 'send_chat_message', { ...args, p_images: ['image'] });
  assert.equal(calls.length, 1, 'Image content must never be silently dropped');
  calls = [];
  await invoke(client, 'create_owned_world_room', { p_request: 'same-id', p_owner: 'owner' });
  assert.equal(calls.length, 1, 'Ownership must never be silently dropped');
  calls = [];
  await invoke(client, 'create_owned_world_room', { p_request: 'same-id', p_owner: null });
  assert.equal(calls[1].name, 'create_world_room');
  assert.equal(calls[1].args.p_request, 'same-id');
  const element = () => ({
    attributes: {},
    children: [],
    classList: { add() {} },
    setAttribute(k, v) {
      this.attributes[k] = v;
    },
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren() {
      this.children = [];
    },
  });
  const mapContext = { document: { createElementNS: element } };
  vm.createContext(mapContext);
  vm.runInContext(source('js/world-map.js'), mapContext);
  const rooms = {
    a: { name: 'Room A', mapX: 0, mapY: 0, exits: ['b'] },
    b: { name: 'Room B', mapX: 1, mapY: 0, exits: ['a', 'c'] },
    c: { name: 'Room C', mapX: 2, mapY: 0, exits: ['b', 'far'] },
    far: { name: 'Far away', mapX: 100, mapY: 0, exits: ['c'] },
  };
  const el = element();
  mapContext.renderWorldMap(el, rooms, 'b', { nearby: true });
  const before = el.children[0].attributes.viewBox;
  const text = el.children[0].attributes['aria-label'];
  assert(!text.includes('Far away connects'), 'Minimap excludes nonadjacent rooms');
  rooms.far.mapX = 999;
  mapContext.renderWorldMap(el, rooms, 'b', { nearby: true });
  assert.equal(
    el.children[0].attributes.viewBox,
    before,
    'Distant rooms cannot shrink the minimap',
  );
  mapContext.renderWorldMap(el, rooms, 'b');
  assert.notEqual(el.children[0].attributes.viewBox, before, 'Expanded map retains all rooms');
  console.log(
    'PASS: admin controls exist, version fallback retains IDs/content/permissions, minimap stays local at fixed scale.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
