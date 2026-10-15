const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const data = new Map(),
  events = {};
const sandbox = {
  window: { addEventListener: (n, fn) => (events[n] = fn) },
  document: {
    documentElement: { dataset: {} },
    addEventListener: () => {},
    querySelectorAll: () => [],
  },
  APSUStorage: { getItem: (k) => data.get(k) || null, setItem: (k, v) => data.set(k, v) },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('js/theme.js', 'utf8'), sandbox);
const t = sandbox.window.APSUTheme;
assert.equal(
  t.inferWorld({ blueprint: { premise: 'An Art Deco hotel in 1987 New York' } }),
  'deco',
);
assert.equal(t.inferWorld({ blueprint: { premise: 'A cyberpunk megacorp city' } }), 'cyberpunk');
assert.equal(t.inferWorld({ blueprint: { premise: 'An enchanted medieval kingdom' } }), 'fantasy');
t.setWorld({ id: 'one', blueprint: { premise: 'Art deco' } });
assert.equal(sandbox.document.documentElement.dataset.theme, 'deco');
data.set('apsu-world-themes-v1', JSON.stringify({ two: 'forest' }));
t.setWorld({ id: 'two', blueprint: { premise: 'cyberpunk' } });
assert.equal(sandbox.document.documentElement.dataset.theme, 'forest');
t.setWorld({ id: 'one', blueprint: { premise: 'Art deco' } });
assert.equal(sandbox.document.documentElement.dataset.theme, 'deco');
assert(!data.has('apsu-theme'));
console.log(
  'PASS: world-derived themes, per-world manual overrides and independent global preference.',
);
