const fs = require('node:fs'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  path = require('node:path');
const source = (name) => fs.readFileSync(path.join(__dirname, '../js', name), 'utf8');
function element() {
  return {
    value: '',
    disabled: false,
    children: [],
    handlers: {},
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 100,
    addEventListener(name, fn) {
      this.handlers[name] = fn;
    },
    setAttribute() {},
    append(...rows) {
      this.children.push(...rows);
    },
    appendChild(row) {
      this.children.push(row);
    },
    replaceChildren() {
      this.children = [];
    },
  };
}
async function authChecks() {
  const nodes = new Map(),
    el = (id) => {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    };
  let callback,
    updates = 0;
  const context = {
    document: { getElementById: el },
    window: { apsuRecoveryReady: false },
    history: { replaceState() {} },
    location: { pathname: '/reset-password.html' },
    supabaseClient: {
      auth: {
        onAuthStateChange(fn) {
          callback = fn;
        },
        async updateUser() {
          updates++;
          return {};
        },
        async signOut() {
          return {};
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(source('reset-password.js'), context);
  await el('auth-form').handlers.submit({ preventDefault() {} });
  assert.equal(updates, 0, 'Normal visit cannot enable recovery form');
  callback('PASSWORD_RECOVERY', { user: { id: 'test' } });
  el('password').value = 'example-test-only';
  el('confirm-password').value = 'different';
  await el('auth-form').handlers.submit({ preventDefault() {} });
  assert.equal(updates, 0);
  el('confirm-password').value = el('password').value;
  await el('auth-form').handlers.submit({ preventDefault() {} });
  assert.equal(updates, 1);
  assert.equal(el('auth-form').hidden, true);
  const crop = { window: {} };
  vm.createContext(crop);
  vm.runInContext(source('image-crop.js'), crop);
  const rect = crop.window.APSUImageCrop.sourceRect(1600, 800, 1, 1, 0.5);
  assert.equal(rect.x, 800);
  assert.equal(rect.y, 0);
  assert.equal(rect.side, 800);
  const zoomed = crop.window.APSUImageCrop.sourceRect(800, 1600, 2, 0.5, 1);
  assert.equal(zoomed.x, 200);
  assert.equal(zoomed.y, 1200);
  assert.equal(zoomed.side, 400);
}
(async () => {
  // Chat delivery is covered by chat-delivery.cjs after the optimistic-send revision.
  await authChecks();
  console.log('PASS: recovery-only password updates and crop bounds.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
