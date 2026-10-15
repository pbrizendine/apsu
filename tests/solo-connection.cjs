const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const data = new Map();
const localStorage = {
  getItem: (k) => data.get(k) || null,
  setItem: (k, v) => data.set(k, v),
  removeItem: (k) => data.delete(k),
};
const load = () => {
  const ctx = vm.createContext({ localStorage });
  vm.runInContext(fs.readFileSync('js/solo-connection.js', 'utf8'), ctx);
  return ctx.APSUSoloConnection;
};
let settings = load();
assert.equal(settings.load(), null);
const saved = {
  key: 'sk-or-v1-' + 'x'.repeat(40),
  provider: 'openrouter',
  model: 'test/model:free',
  consent: true,
};
settings.save({ ...saved, world: 'not stored', messages: ['not stored'] });
settings = load();
assert.equal(settings.load().key, saved.key);
assert.equal(settings.load().model, saved.model);
assert(!JSON.stringify([...data.values()]).includes('not stored'));
assert.throws(() => settings.save({ ...saved, consent: false }));
assert.throws(() => settings.save({ ...saved, model: 'openrouter/auto' }));
settings.forget();
assert.equal(load().load(), null);
data.set('apsu-solo-connection-v1', 'broken');
assert.throws(() => settings.load());
console.log(
  'PASS: opt-in credentials persist across reload, omit world data, require consent, and can be forgotten.',
);
