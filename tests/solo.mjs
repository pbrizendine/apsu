import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { soloChat } from '../worker/solo-chat.mjs';
await import('../js/solo-engine.js');
const E = globalThis.APSUSoloEngine;
let s = E.create('Traveler', 'A patient hotel worker.');
assert.throws(() => E.act(s, 'move', 'archive'), /adjacent/);
s = E.act(s, 'give-pick');
const pick = s.inventory[0].id;
assert.throws(() => E.act(s, 'give-pick'), /already/);
s = E.act(s, 'move', 'office');
assert.equal(s.elias.room, 'office');
assert.throws(() => E.act(s, 'move', 'archive'), /locked/);
assert.equal(E.act(s, 'cancel').inventory[0].capacity, 100);
assert.throws(() => E.act(s, 'unlock', pick), /Insert/);
s = E.act(s, 'insert', pick);
s = E.act(s, 'damage', pick);
const interrupted = E.validate(JSON.parse(JSON.stringify(s)));
assert.equal(E.act(interrupted, 'cancel').inventory[0].capacity, 0);
s = E.act(s, 'cancel');
s = E.act(s, 'give-pick');
const spare = s.inventory[1].id;
s = E.act(s, 'insert', spare);
s = E.act(s, 'unlock', spare);
assert.equal(s.player.room, 'office');
assert.equal(s.doorLocked, false);
const halfway = E.validate(JSON.parse(JSON.stringify(s)));
assert.equal(halfway.elias.room, 'office');
assert.equal(halfway.inventory[0].capacity, 0);
assert.throws(() => E.act(halfway, 'give-pick'));
s = E.act(halfway, 'move', 'archive');
assert.equal(s.elias.room, 'archive');
s = E.act(s, 'take-recording');
assert.throws(() => E.act(s, 'take-recording'));
s = E.act(s, 'give-recording');
assert(s.completed);
assert.equal(s.recording, 'elias');
assert.throws(() => E.act(s, 'give-recording'));
const reply = {
  dialogue: 'I remember your help.',
  memory: 'Traveler recovered my brother’s recording.',
  action: 'none',
  usage: { input: 100, output: 30 },
};
s = E.conversation(s, 'Do you remember?', reply);
assert(s.elias.memory.includes('recording'));
assert.equal(s.usage.calls, 1);
assert.equal(E.validate({ ...s, key: 'secret' }).key, undefined);
assert.throws(() => E.validate({ ...s, version: 999 }));
assert.throws(() => E.validate({ ...s, player: { ...s.player, room: '__proto__' } }));
assert.throws(() => E.validate({ ...s, inventory: [{ id: 'a', capacity: 25 }] }));
assert.throws(() => E.validate({ ...s, completed: false }));
// Runtime-test real store logic with a minimal asynchronous transactional DB double.
const records = new Map();
let failWrite = false;
const db = {
  transaction() {
    let jobs = 0,
      aborted = false;
    const tx = {
      abort() {
        aborted = true;
        queueMicrotask(() => tx.onabort?.());
      },
    };
    const schedule = (fn) => {
      jobs++;
      const req = {};
      queueMicrotask(() => {
        if (aborted) return;
        fn(req);
        jobs--;
        setTimeout(() => {
          if (!jobs && !aborted) tx.oncomplete?.();
        }, 0);
      });
      return req;
    };
    tx.objectStore = () => ({
      get(id) {
        return schedule((req) =>
          req.onsuccess?.({ target: { result: structuredClone(records.get(id)) } }),
        );
      },
      getAll() {
        return schedule((req) =>
          req.onsuccess?.({
            target: { result: [...records.values()].map((v) => structuredClone(v)) },
          }),
        );
      },
      put(v) {
        return schedule(() => {
          if (failWrite) {
            tx.abort();
            return;
          }
          records.set(v.id, structuredClone(v));
        });
      },
      delete(id) {
        return schedule(() => records.delete(id));
      },
    });
    return tx;
  },
  close() {},
};
const indexedDB = {
  open() {
    const req = {};
    queueMicrotask(() => {
      req.result = db;
      req.onsuccess();
    });
    return req;
  },
};
const context = {
  indexedDB,
  APSUSoloEngine: E,
  crypto,
  JSON,
  Error,
  Promise,
  Blob,
  URL,
  setTimeout,
};
vm.createContext(context);
vm.runInContext(await readFile(new URL('../js/solo-store.js', import.meta.url), 'utf8'), context);
const S = context.APSUSoloStore;
let saved = await S.save(halfway, true);
const exported = JSON.stringify(saved);
const imported = await S.importFile({ size: exported.length, text: async () => exported });
assert.notEqual(imported.id, saved.id);
assert.equal(imported.doorLocked, false);
assert.deepEqual(imported.inventory, saved.inventory);
assert.equal((await S.list()).length, 2);
const newer = await S.save(E.act(saved, 'move', 'archive'));
await assert.rejects(() => S.save(saved), /another tab/);
failWrite = true;
await assert.rejects(() => S.save(newer), /Save failed/);
failWrite = false;
assert.equal((await S.get(newer.id)).revision, newer.revision);
await assert.rejects(() => S.importFile({ size: 32000001 }), /32 MB/);
await assert.rejects(() => S.importFile({ size: 4, text: async () => 'null' }), /supported/);
assert.equal((await S.list()).length, 2);
const key = 'sk-or-v1-' + 'x'.repeat(30),
  body = {
    key,
    provider: 'openrouter',
    model: 'apodex/apodex-1.1-mini:free',
    adult: true,
    context: E.context(E.create('Tester'), 'Can you give me a pick?'),
  };
const request = (b = body, origin = 'https://apsu.test') =>
  new Request('https://apsu.test/api/solo-chat', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  });
const env = { SOLO_LIMIT: { limit: async () => ({ success: true }) } };
let calls = 0;
const transport = async (url, options) => {
  calls++;
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  const b = JSON.parse(options.body);
  assert.deepEqual(b.provider.max_price, { prompt: 0, completion: 0 });
  assert.equal(b.max_tokens, 4096);
  assert.deepEqual(b.reasoning, { enabled: true, exclude: true });
  assert(!options.body.includes(key));
  return Response.json({
    choices: [
      {
        finish_reason: 'stop',
        message: { content: JSON.stringify({ ...reply, action: 'give_pick' }) },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 30 },
  });
};
let res = await soloChat(request(), env, transport);
assert.equal(res.status, 200);
const result = await res.json();
assert.equal(result.action, 'give_pick');
const gifted = E.conversation(E.create('Tester'), 'Can I have a pick?', result);
assert.equal(gifted.inventory.length, 1);
assert.deepEqual(
  gifted.messages.slice(-3).map((m) => m.who),
  ['Player', 'Story', 'Elias'],
);
const repeated = E.conversation(gifted, 'Another?', result);
assert.equal(repeated.inventory.length, 1);
assert.equal((await soloChat(request(body, 'https://other.test'), env, transport)).status, 403);
assert.equal((await soloChat(request({ ...body, adult: false }), env, transport)).status, 400);
assert.equal((await soloChat(request({ ...body, context: {} }), env, transport)).status, 400);
assert.equal(
  (await soloChat(request({ ...body, junk: 'x'.repeat(1100000) }), env, transport)).status,
  400,
);
assert.equal(
  (
    await soloChat(
      request(),
      { SOLO_LIMIT: { limit: async () => ({ success: false }) } },
      transport,
    )
  ).status,
  429,
);
assert.equal(calls, 1);
assert.equal(
  (await soloChat(request(), env, async () => Response.json({ status: 'incomplete' }))).status,
  502,
);
assert.equal(
  (await soloChat(request(), env, async () => new Response('', { status: 401 }))).status,
  401,
);
console.log(
  'PASS: solo objective, adjacency, follow, damage, interrupted insertion, recovery, save roundtrip, import copy, stale revisions, storage failure, invalid imports, bounded guest relay and provider failures. No paid API call.',
);
const routerBody = {
  ...body,
  key: 'sk-or-v1-' + 'x'.repeat(40),
  provider: 'openrouter',
  model: 'apodex/apodex-1.1-mini:free',
};
let routerCalls = 0;
const routerTransport = async (url, options) => {
  routerCalls++;
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(options.headers.Authorization, 'Bearer ' + routerBody.key);
  const payload = JSON.parse(options.body);
  assert.equal(payload.model, routerBody.model);
  assert.equal(payload.max_tokens, 4096);
  assert.equal(payload.provider.require_parameters, true);
  assert.equal(payload.provider.data_collection, 'deny');
  assert.equal(payload.provider.allow_fallbacks, false);
  assert.deepEqual(payload.response_format, { type: 'json_object' });
  assert(payload.messages[0].content.includes('OUTPUT_SCHEMA='));
  assert(!options.body.includes(routerBody.key));
  return Response.json({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply) } }],
    usage: { prompt_tokens: 123, completion_tokens: 45 },
  });
};
const routerResult = await soloChat(request(routerBody), env, routerTransport);
assert.equal(routerResult.status, 200);
assert.deepEqual((await routerResult.json()).usage, { input: 123, output: 45, cost: null });
for (const bad of [
  { provider: 'elsewhere' },
  { model: 'https://evil.test' },
  { key: 'sk-invalid' },
  { model: '' },
]) {
  assert.equal(
    (await soloChat(request({ ...routerBody, ...bad }), env, routerTransport)).status,
    400,
  );
}
assert.equal(routerCalls, 1);
for (const status of [401, 402, 403, 404, 429]) {
  const failed = await soloChat(
    request(routerBody),
    env,
    async () => new Response('secret upstream details', { status }),
  );
  assert.equal(failed.status, status);
  assert(!(await failed.text()).includes('secret upstream'));
}
for (const content of [
  'not json',
  JSON.stringify({ ...reply, action: 'unlock' }),
  JSON.stringify({ ...reply, dialogue: '' }),
]) {
  assert.equal(
    (
      await soloChat(request(routerBody), env, async () =>
        Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] }),
      )
    ).status,
    502,
  );
}
assert.equal(
  (
    await soloChat(request(routerBody), env, async () =>
      Response.json({
        choices: [{ finish_reason: 'length', message: { content: JSON.stringify(reply) } }],
      }),
    )
  ).status,
  502,
);
console.log(
  'PASS: OpenRouter routing, private credentials, schema constraints, token accounting, model validation, credit errors and malformed/truncated replies. No paid API call.',
);

// Cost receipts survive a rejected model reply; unchanged memory does not need regeneration.
const costContext = {
  ...routerBody.context,
  elias: { ...routerBody.context.elias, memory: 'Player likes quiet places.' },
  recent: Array.from({ length: 16 }, (_, i) => ({
    who: 'Elias',
    text: String(i) + 'x'.repeat(2300),
  })),
  memories: Array.from({ length: 6 }, (_, i) => ({
    who: 'Player',
    text: String(i) + 'y'.repeat(900),
  })),
};
let sentCharacters = 0;
const economical = await soloChat(
  request({ ...routerBody, context: costContext }),
  env,
  async (url, options) => {
    const b = JSON.parse(options.body),
      c = JSON.parse(b.messages[1].content);
    assert(JSON.stringify(c.recent).length < 6100);
    assert(JSON.stringify(c.relevantEarlierConversation).length < 2100);
    assert.equal(c.memory, 'Player likes quiet places.');
    assert.equal(c.doorLocked, true);
    sentCharacters = JSON.stringify(c).length;
    return Response.json({
      choices: [
        { finish_reason: 'stop', message: { content: JSON.stringify({ ...reply, memory: null }) } },
      ],
      usage: { prompt_tokens: 500, completion_tokens: 100, cost: 0.002 },
    });
  },
);
assert.equal(economical.status, 200);
const cheapReply = await economical.json();
assert.equal(cheapReply.memory, 'Player likes quiet places.');
assert.equal(cheapReply.usage.cost, 0.002);
const chargedFailure = await soloChat(request(routerBody), env, async () =>
  Response.json({
    choices: [{ finish_reason: 'length', message: { content: '' } }],
    usage: { cost: 0.01 },
  }),
);
assert.equal(chargedFailure.status, 502);
assert.equal((await chargedFailure.json()).usage.cost, 0.01);
console.log(
  'PASS: bounded paid history, retained world facts, unchanged memory, and cost receipts on success/failure. Stress fixture context characters: ' +
    sentCharacters,
);

let paidCalls = 0;
for (const b of [
  { ...routerBody, model: 'anthropic/claude-sonnet-5.5' },
  { ...routerBody, provider: 'openai', model: 'gpt-4.1-mini' },
  { ...routerBody, model: 'openrouter/auto' },
]) {
  const denied = await soloChat(request(b), env, async () => {
    paidCalls++;
    throw Error('Must not call provider');
  });
  assert.equal(denied.status, 400);
  assert.match((await denied.json()).error, /explicit OpenRouter/);
}
assert.equal(paidCalls, 0);
console.log(
  'PASS: unapproved paid models, direct providers, and automatic routing blocked before inference.',
);

const narrating = E.act(E.create('Narrator'), 'emote', 'gives the recording to Elias.');
assert.equal(narrating.recording, 'archive');
assert.equal(narrating.completed, false);
assert.deepEqual(narrating.inventory, []);
assert.equal(narrating.messages.at(-1).text, '/me gives the recording to Elias.');
assert.equal(narrating.usage.calls, 0);
console.log(
  'PASS: narrated transfers do not move items, complete objectives, or consume AI calls.',
);
for (const cmd of [
  '/me gives away the case.',
  '/my hand offers the case.',
  '/do The case is offered.',
]) {
  const narrated = E.act(E.create('Tester'), 'narrate', cmd);
  assert.equal(narrated.recording, 'archive');
  assert.equal(narrated.completed, false);
  assert.equal(narrated.usage.calls, 0);
}
const distant = E.act(E.create('Tester'), 'move', 'office');
const heard = E.conversation(distant, '/shout Hello?', { ...reply, action: 'none' });
assert.equal(heard.elias.room, 'lobby');
assert.throws(() => E.conversation(distant, 'Hello?', reply), /cannot hear/);
let remoteSchema;
const remoteReply = await soloChat(
  request({ ...routerBody, context: E.context(distant, '/shout Hello?') }),
  env,
  async (url, options) => {
    remoteSchema = JSON.parse(
      JSON.parse(options.body).messages[0].content.split('OUTPUT_SCHEMA=')[1],
    );
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: JSON.stringify({ ...reply, action: 'none' }) },
        },
      ],
    });
  },
);
assert.equal(remoteReply.status, 200);
assert.deepEqual(remoteSchema.properties.action.enum, ['none']);
const sneaking = E.act(E.create('Tester'), 'move', { room: 'office', quiet: true });
assert.equal(sneaking.player.room, 'office');
assert.equal(sneaking.messages.length, E.create('Tester').messages.length);
console.log(
  'PASS: local narration, adjacent-room shouts, remote item-transfer denial, and quiet movement.',
);

// Item ownership is code-owned across transfers, drops and save imports.
let tracked = E.create('Inventory tester');
const actualPick = E.inventory(tracked, 'elias')[0].id;
tracked = E.act(tracked, 'give-pick');
assert.equal(tracked.inventory[0].id, actualPick);
assert.equal(E.inventory(tracked, 'elias').length, 2);
tracked = E.act(tracked, 'inventory', { ids: [actualPick], verb: 'give', target: 'elias' });
assert.equal(tracked.inventory.length, 0);
assert.equal(E.inventory(tracked, 'elias').length, 3);
assert.throws(
  () => E.act(tracked, 'inventory', { ids: [actualPick], verb: 'give', target: 'elias' }),
  /own/,
);
tracked = E.act(tracked, 'add-prop', { name: 'Old jacket', description: 'Frayed wool.' });
const jacket = E.inventory(tracked).find((i) => i.kind === 'custom').id;
tracked = E.act(tracked, 'inventory', { ids: [jacket], verb: 'drop' });
assert.equal(
  E.inventory(tracked, 'lobby').find((i) => i.id === jacket).appearance.name,
  'Old jacket',
);
tracked = E.act(tracked, 'inventory', { ids: [jacket], verb: 'pickup' });
tracked = E.act(tracked, 'inventory', { ids: [jacket], verb: 'give', target: 'elias' });
assert(
  E.inventory(E.validate(JSON.parse(JSON.stringify(tracked))), 'elias').some(
    (i) => i.id === jacket,
  ),
);
assert.throws(
  () => E.act(tracked, 'add-prop', { name: 'lockpick', description: 'fake' }),
  /existing/,
);
let exhausted = E.create('Finite stock');
for (let n = 0; n < 3; n++) {
  exhausted = E.act(exhausted, 'give-pick');
  exhausted = E.act(exhausted, 'inventory', { ids: [exhausted.inventory[0].id], verb: 'delete' });
}
assert.throws(() => E.act(exhausted, 'give-pick'), /no working/);
const elsewhere = E.validate({ ...tracked, recordingRoom: 'lobby' });
assert(!E.inventory(elsewhere, 'archive').some((i) => i.id === 'recording'));
assert(E.inventory(elsewhere, 'lobby').some((i) => i.id === 'recording'));
console.log(
  'PASS: finite NPC inventory, actual item transfers, rejected duplicate transfers, props, ground ownership and save roundtrip.',
);

const { soloImagine } = await import('../worker/solo-imagine.mjs');
const imageBody = {
  key: 'sk-or-v1-' + 'x'.repeat(30),
  model: 'example/image-model',
  prompt: 'A hotel lobby',
  adult: true,
  approveCharge: true,
};
const imageRequest = (body, origin = 'https://apsu.test') =>
  new Request('https://apsu.test/api/solo-imagine', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
let imagesCalled = 0;
const imageTransport = async (url, options) => {
  imagesCalled++;
  assert.equal(url, 'https://openrouter.ai/api/v1/images');
  const b = JSON.parse(options.body);
  assert.equal(b.n, 1);
  assert.equal(b.provider.allow_fallbacks, false);
  assert(!('key' in b));
  return Response.json({
    data: [{ b64_json: 'aGVsbG8=', media_type: 'image/png' }],
    usage: { cost: 0.01 },
  });
};
const imageEnv = { IMAGINE_LIMIT: { limit: async () => ({ success: true }) } };
assert.equal(
  (
    await soloImagine(
      imageRequest({ ...imageBody, approveCharge: false }),
      imageEnv,
      imageTransport,
    )
  ).status,
  400,
);
assert.equal(
  (await soloImagine(imageRequest(imageBody, 'https://evil.test'), imageEnv, imageTransport))
    .status,
  403,
);
assert.equal(imagesCalled, 0);
assert.equal((await soloImagine(imageRequest(imageBody), imageEnv, imageTransport)).status, 200);
assert.equal(imagesCalled, 1);
assert.equal(
  (
    await soloImagine(
      imageRequest(imageBody),
      { IMAGINE_LIMIT: { limit: async () => ({ success: false }) } },
      imageTransport,
    )
  ).status,
  429,
);
assert.equal(imagesCalled, 1);
assert.equal(
  (
    await soloImagine(imageRequest(imageBody), imageEnv, async () =>
      Response.json({ data: [{ b64_json: 'aGVsbG8=', media_type: 'image/svg+xml' }] }),
    )
  ).status,
  502,
);
console.log(
  'PASS: optional image consent, origin, rate limiting, single image, no fallback, raster-only output. No paid calls.',
);

const oldSave = E.create('Legacy');
oldSave.version = 1;
delete oldSave.items;
assert.equal(E.validate(oldSave).version, 2);
assert.equal(E.validate(oldSave).items.length, 3);

await import('../js/action-text.js');
assert.deepEqual(globalThis.APSUActionText.parts('Hello **waves** there **smiles**.'), [
  { text: 'Hello ', action: false },
  { text: 'waves', action: true },
  { text: ' there ', action: false },
  { text: 'smiles', action: true },
  { text: '.', action: false },
]);
assert.deepEqual(globalThis.APSUActionText.parts('**unfinished'), [
  { text: '**unfinished', action: false },
]);
assert.deepEqual(globalThis.APSUActionText.parts('**<img onerror=alert(1)>**'), [
  { text: '<img onerror=alert(1)>', action: true },
]);
console.log(
  'PASS: inline action markers, mixed dialogue, unmatched markers and literal HTML text.',
);

let approvedPaid = false;
await soloChat(
  request({ ...routerBody, model: 'anthropic/claude-opus-5.5', allowPaid: true }),
  env,
  async (url, options) => {
    const b = JSON.parse(options.body);
    assert.equal(b.model, 'anthropic/claude-opus-5.5');
    assert.equal(b.provider.allow_fallbacks, false);
    assert.equal(b.provider.max_price, undefined);
    approvedPaid = true;
    return new Response('', { status: 429 });
  },
);
assert(approvedPaid);
console.log(
  'PASS: explicit paid selection reaches the selected model without free-route price limits or fallback. No live calls.',
);

assert.deepEqual(globalThis.APSUActionText.parts('*waves* /quietly/'), [
  { text: 'waves', action: true },
  { text: ' ', action: false },
  { text: 'quietly', action: false, italic: true },
]);
assert.deepEqual(globalThis.APSUActionText.parts('https://example.com/path/'), [
  { text: 'https://example.com/path/', action: false },
]);
assert.equal(globalThis.APSUActionText.actionBody('I give her a nod', 'Jared'), 'gives her a nod');

const deletedImageWorlds = [];
context.APSUSoloGallery = { removeWorld: async (id) => deletedImageWorlds.push(id) };
await S.remove(imported.id);
assert.deepEqual(deletedImageWorlds, [imported.id]);
assert.equal(await S.get(imported.id), null);
assert(await S.get(newer.id));
console.log('PASS: World deletion removes its image gallery and preserves other saves.');

for (const [content, expected, pattern] of [
  ['```json\n' + JSON.stringify(reply) + '\n```', 200, null],
  [JSON.stringify({ ...reply, memory: undefined, action: undefined }), 200, null],
  ['invalid json', 502, /malformed reply JSON/],
  [JSON.stringify({ ...reply, action: 'invented_action' }), 502, /unavailable action/],
  [JSON.stringify({ ...reply, memory: 'x'.repeat(2501) }), 502, /overlong memory/],
]) {
  const response = await soloChat(request(routerBody), env, async () =>
    Response.json({
      choices: [{ finish_reason: 'stop', message: { content } }],
      usage: { cost: 0.012, prompt_tokens: 10, completion_tokens: 20 },
    }),
  );
  assert.equal(response.status, expected);
  const result = await response.json();
  assert.equal(result.usage.cost, 0.012);
  if (pattern) assert.match(result.error, pattern);
}
console.log(
  'PASS: fenced JSON and optional fields accepted, invalid actions/memory rejected with specific errors and usage retained.',
);

assert.deepEqual(APSUActionText.parts('/She taps the card./Two rooms left.'), [
  { text: 'She taps the card.', action: false, italic: true },
  { text: 'Two rooms left.', action: false },
]);
