const vm = require('node:vm'),
  fs = require('node:fs'),
  assert = require('node:assert/strict');
const scope = { window: {} };
vm.createContext(scope);
vm.runInContext(fs.readFileSync('js/chat-attention.js', 'utf8'), scope);
const m = scope.window.APSUAttention.mentioned;
assert(m('Hey @Baby Snug (Tyler), hello', 'Baby Snug', 'Tyler'));
assert(m('@tyler can you hear me?', 'Baby Snug', 'Tyler'));
assert(!m('@TylerTwo hello', 'Baby Snug', 'Tyler'));
assert(!m('mail@example.com', 'example', 'Tyler'));
assert(!m('@Other (Jacob)', 'Baby Snug', 'Tyler'));
assert(!m('@Baby Snug Junior (Tyler)', 'Baby Snug', 'Tyler'));
assert(!m('@Other (Tyler)', 'Baby Snug', 'Tyler'));
// Session appearance survives navigation without enabling persistent preferences.
const local = new Map(),
  session = new Map();
const storage = (m) => ({
  getItem: (k) => m.get(k) || null,
  setItem: (k, v) => m.set(k, v),
  removeItem: (k) => m.delete(k),
});
function page() {
  const c = {
    window: {},
    localStorage: storage(local),
    sessionStorage: storage(session),
    document: { addEventListener() {} },
  };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('js/privacy.js', 'utf8'), c);
  return c.window.APSUStorage;
}
page().setItem('apsu-theme', 'midnight');
assert.equal(page().getItem('apsu-theme'), 'midnight');
assert.equal(local.has('apsu-theme'), false);
console.log(
  'PASS: username/character mentions respect boundaries; session theme survives navigation without persistent consent.',
);
