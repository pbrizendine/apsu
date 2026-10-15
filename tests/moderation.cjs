const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/moderation.js'), 'utf8');

async function scenario(skew) {
  let serverNow = Date.parse('2026-10-03T12:00:00.000Z');
  let kickAt = serverNow - 60000;
  let banned = false;
  let failure = null;
  let missingBoundary = false;
  const timers = new Set(),
    calls = [],
    exits = [],
    notices = [];
  const link = { dataset: {} };
  const context = vm.createContext({
    Date: class extends Date {
      constructor(...args) {
        super(...(args.length ? args : [serverNow + skew]));
      }
    },
    document: { getElementById: () => link },
    setInterval(fn) {
      timers.add(fn);
      return fn;
    },
    clearInterval(fn) {
      timers.delete(fn);
    },
  });
  vm.runInContext(source, context);
  const client = {
    async rpc(name, args) {
      assert.equal(name, 'moderation_status');
      calls.push(args);
      if (failure) return { error: failure };
      const since = args.p_since ?? new Date(serverNow).toISOString();
      return {
        data: {
          since: missingBoundary ? undefined : since,
          kicked: kickAt > Date.parse(since),
          banned,
          rank: 1,
          staff: [{ role: 'Admin', characters: ['character'] }],
          notices: args.p_since
            ? [{ id: 'notice', body: 'Private warning', target: 'player' }]
            : [],
        },
      };
    },
  };
  const join = () =>
    context.startWorldModeration(
      client,
      'alska-mogue',
      { addSystem: (...args) => notices.push(args) },
      async (message) => exits.push(message),
    );
  const tick = async () => {
    for (const fn of [...timers]) await fn();
  };

  let session = join();
  await session.ready;
  assert.equal(calls[0].p_since, null, 'Never use the device clock to start a visit');
  assert.equal(exits.length, 0, 'An old kick must not reject a fresh join');
  assert.equal(session.roleFor('character'), 'Admin');
  serverNow += 5000;
  await tick();
  const originalBoundary = calls.at(-1).p_since;
  serverNow += 5000;
  await tick();
  assert.equal(calls.at(-1).p_since, originalBoundary, 'Polling cannot reset the kick boundary');
  assert.equal(notices.length, 1, 'Notices remain deduplicated');
  failure = new Error('Offline');
  await tick();
  failure = null;
  kickAt = serverNow + 1;
  serverNow += 5000;
  await tick();
  assert.deepEqual(exits, ['An admin disconnected you from this world.']);
  await tick();
  assert.equal(exits.length, 1, 'Exit fires once');
  session.stop();

  session = join();
  await session.ready;
  await tick();
  assert.equal(exits.length, 1, 'Immediate rejoin works without deleting the old kick');
  session.stop();
  banned = true;
  session = join();
  await session.ready;
  assert.equal(exits.at(-1), 'You are banned from this world.');
  session.stop();

  banned = false;
  failure = new Error('Unavailable');
  session = join();
  await assert.rejects(session.ready, /Unavailable/);
  assert.equal(timers.size, 0, 'A failed initial check must not leave an unchecked play session');
  failure = null;
  missingBoundary = true;
  session = join();
  await assert.rejects(session.ready, /establish the world session/);
  assert.equal(timers.size, 0, 'An outdated database cannot silently use device time');
}
(async () => {
  await scenario(-86400000);
  await scenario(86400000);
  console.log(
    'PASS: kick/rejoin with clocks ahead or behind, stable session boundary, bans, notices and startup failures',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
