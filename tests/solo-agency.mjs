import assert from 'node:assert/strict';
import '../js/solo-engine.js';
import '../js/solo-mercer.js';
import { soloChat } from '../worker/solo-chat.mjs';
import { soloImagine } from '../worker/solo-imagine.mjs';
const E = globalThis.APSUSoloEngine;
let s = E.createMercer('Tester');
assert.throws(() => E.act(s, 'move', 'supply'));
s = E.act(s, 'give-pick');
const pick = E.inventory(s)[0].id;
s = E.act(s, 'insert', pick);
s = E.act(s, 'cancel');
assert.equal(E.inventory(s)[0].capacity, 0);
s = E.act(s, 'give-pick');
const second = E.inventory(s).find((i) => i.capacity > 0).id;
s = E.act(s, 'insert', second);
s = E.act(s, 'unlock', second);
assert.equal(s.player.room, 'workshop');
s = E.act(s, 'move', 'supply');
s = E.act(s, 'inventory', { ids: ['fuel'], verb: 'pickup' });
s = E.act(s, 'move', 'workshop');
s = E.conversation(
  s,
  '**I give you the fuel**',
  { dialogue: 'I can take it.', memory: 'Tester offered fuel.', action: 'none' },
  'mara',
);
assert.equal(s.items.find((i) => i.id === 'fuel').owner, 'player');
assert.throws(() =>
  E.conversation(s, 'Take it', { dialogue: 'Done', memory: '', action: 'power' }, 'mara'),
);
s = E.act(s, 'inventory', { ids: ['fuel'], verb: 'give', target: 'mara' });
s = E.conversation(
  s,
  'Go ahead',
  { dialogue: 'We need the light.', memory: 'Tester helped.', action: 'power' },
  'mara',
);
assert(s.generatorPowered);
assert(!s.items.some((i) => i.id === 'fuel'));
assert.equal(s.npcs.leon.memory, '');
assert.deepEqual(E.validate(JSON.parse(JSON.stringify(s))), s);
let privateScene = E.createMercer('Tester');
privateScene = E.conversation(
  privateScene,
  '/w 2 private secret',
  { dialogue: 'Understood.', memory: 'A secret', action: 'none' },
  'mara',
);
assert(!E.context(privateScene, 'Hello', 'leon').recent.some((m) => m.text.includes('secret')));
const key = 'sk-or-v1-' + 'x'.repeat(40),
  env = {
    SOLO_LIMIT: { limit: async () => ({ success: true }) },
    IMAGINE_LIMIT: { limit: async () => ({ success: true }) },
  };
const req = (path, body) =>
  new Request('https://apsu.test' + path, {
    method: 'POST',
    headers: { Origin: 'https://apsu.test', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const response = await soloChat(
  req('/api/solo-chat', {
    key,
    adult: true,
    provider: 'openrouter',
    model: 'test/free:free',
    context: E.context(E.createMercer('Tester'), 'Hello', 'leon'),
  }),
  env,
  async (url, opts) => {
    const b = JSON.parse(opts.body);
    assert(b.messages[0].content.includes('Leon Price'));
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              dialogue: 'I need to reach my sister.',
              action: 'none',
              memory: null,
            }),
          },
        },
      ],
      usage: { cost: 0 },
    });
  },
);
assert.equal(response.status, 200);
let calls = 0;
const img = {
  key,
  adult: true,
  approveCharge: true,
  model: 'inclusionai/ming-image-0.1-design',
  prompt: 'A street',
};
const free = await soloImagine(req('/api/solo-imagine', img), env, async () => {
  calls++;
  return calls === 1
    ? Response.json({ endpoints: [{ pricing: [{ cost_usd: 0 }] }] })
    : Response.json({
        data: [{ b64_json: 'aGVsbG8=', media_type: 'image/png' }],
        usage: { cost: 0 },
      });
});
assert.equal(free.status, 200);
assert.equal(calls, 2);
calls = 0;
const paid = await soloImagine(req('/api/solo-imagine', img), env, async () => {
  calls++;
  return Response.json({ endpoints: [{ pricing: [{ cost_usd: 1 }] }] });
});
assert.equal(paid.status, 409);
assert.equal(calls, 1);
console.log(
  'PASS: Mercer inventories, mechanical outcomes, lockpick cancellation/success, separate memories, private witnesses, save roundtrip, character relay, and free-image price guard. No live inference.',
);

assert.equal(E.context(s, 'Hello', 'mara').verifiedFacts.unlockedBy, 'Tester');
assert(!E.roomsFor(s).supply.description.includes('single sealed fuel can'));
assert(E.roomsFor(s).workshop.description.includes('unlocked'));
