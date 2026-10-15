const fs = require('node:fs'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  path = require('node:path');
const source = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const context = { window: {}, Map };
vm.createContext(context);
vm.runInContext(source('js/item-display.js'), context);
const display = context.window.APSUItems;
const watch = {
  kind: 'custom',
  capacity: 100,
  appearance: { name: 'Watch', icon: 'watch', description: 'Silver', image_path: 'world/image' },
};
assert.equal(display.name(watch, { rooms: {} }), 'Watch');
assert.equal(display.stackKey(watch), display.stackKey(JSON.parse(JSON.stringify(watch))));
assert.notEqual(
  display.stackKey(watch),
  display.stackKey({ ...watch, appearance: { ...watch.appearance, image_path: 'world/other' } }),
);
assert.notEqual(
  display.stackKey(watch),
  display.stackKey({ ...watch, appearance: { ...watch.appearance, name: 'Book' } }),
);
assert.equal(display.name({ kind: 'lockpick', capacity: 0 }, { rooms: {} }), 'Broken lockpick');
const room = source('js/room-page.js');
const cancel = room.slice(
  room.indexOf('async function cancelLockpick('),
  room.indexOf("document.getElementById('cancel-lockpick')"),
);
function cancellation(inserted, completing = false) {
  const writes = [],
    messages = [];
  const ctx = {
    cancelingLock: false,
    completingLock: completing,
    lockpickFrame: {},
    insertedPickId: inserted,
    lockpickBroke: false,
    wearFailed: false,
    wearSave: Promise.resolve(),
    saveWear: (id, capacity) => writes.push({ id, capacity }),
    closeLockpick() {
      ctx.lockpickFrame = null;
      ctx.insertedPickId = null;
    },
    lockStatus: {
      set textContent(value) {
        messages.push(value);
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(cancel, ctx);
  return { ctx, writes, messages };
}
(async () => {
  let check = cancellation(null);
  await check.ctx.cancelLockpick();
  assert.equal(check.writes.length, 0);
  check = cancellation('pick-two');
  await Promise.all([check.ctx.cancelLockpick(), check.ctx.cancelLockpick()]);
  assert.deepEqual(check.writes, [{ id: 'pick-two', capacity: 0 }]);
  assert.deepEqual(check.messages, ['Your lockpick broke.']);
  check = cancellation('pick-three', true);
  await check.ctx.cancelLockpick();
  assert.equal(check.writes.length, 0);
  check = cancellation('idle-pick');
  await check.ctx.cancelLockpick('Canceled after 30 seconds of inactivity.');
  assert.equal(check.writes[0].capacity, 0);
  const adminIds = new Set(
    [...source('admin.html').matchAll(/\bid=["']([^"']+)/g)].map((m) => m[1]),
  );
  for (const m of source('js/admin-items.js').matchAll(/\$\(['"]([^'"]+)/g))
    assert(adminIds.has(m[1]), `Missing item control ${m[1]}`);
  assert(!source('js/profile-page.js').includes('player_world_warnings'));
  assert(!source('profile.html').includes('warning-record'));
  console.log(
    'PASS: item stack identity/names, inserted-pick cancellation and double-click safety, success guard, item controls, global-only full profile.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
