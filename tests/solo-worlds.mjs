import assert from 'node:assert/strict';
import '../js/solo-engine.js';
import '../js/solo-mercer.js';
import '../js/solo-blueprint.js';
import '../js/solo-generated.js';
import '../js/solo-timeline.js';
import { soloCreate } from '../worker/solo-create.mjs';
import { soloChat } from '../worker/solo-chat.mjs';
const E = globalThis.APSUSoloEngine;
export const design = {
  title: 'The Glass Station',
  premise: 'Two travelers disagree about opening the sealed archive.',
  start: 'hall',
  rooms: [
    {
      id: 'hall',
      name: 'Hall',
      description: 'A quiet tiled hall.',
      exits: ['street', 'archive'],
      locked: false,
    },
    {
      id: 'street',
      name: 'Street',
      description: 'Rain over tram rails.',
      exits: ['hall'],
      locked: false,
    },
    {
      id: 'archive',
      name: 'Archive',
      description: 'Shelves behind a locked door.',
      exits: ['hall'],
      locked: true,
    },
  ],
  characters: [
    {
      id: 'ada',
      name: 'Ada',
      description: 'A conductor in a worn coat.',
      personality: 'Cautious.',
      goal: 'Protect the records.',
      room: 'hall',
    },
    {
      id: 'ivo',
      name: 'Ivo',
      description: 'A traveler with a satchel.',
      personality: 'Curious.',
      goal: 'Read the records.',
      room: 'hall',
    },
  ],
  items: [
    { id: 'pick', kind: 'lockpick', name: 'Lockpick', description: 'A steel pick.', owner: 'ada' },
    {
      id: 'letter',
      kind: 'prop',
      name: 'Letter',
      description: 'A folded letter.',
      owner: 'archive',
    },
  ],
};
const modify = (fn) => {
  const d = structuredClone(design);
  fn(d);
  return d;
};
assert.throws(() =>
  E.createGenerated(
    modify((d) => (d.rooms[1].exits = ['archive'])),
    'Tester',
  ),
);
assert.doesNotThrow(() =>
  E.createGenerated(
    modify((d) => (d.items[0].owner = 'archive')),
    'Tester',
  ),
);
assert.throws(() =>
  E.createGenerated(
    modify((d) => (d.items[0].kind = 'script')),
    'Tester',
  ),
);
assert.throws(() =>
  E.createGenerated(
    modify((d) => (d.characters[0].id = 'constructor')),
    'Tester',
  ),
);
let s = E.createGenerated(design, 'Tester');
const say = (world, text, action, id = 'ada') =>
  E.conversation(world, text, { dialogue: '*Ada nods.*', memory: '', action }, id);
assert.throws(() => E.act(s, 'move', 'archive'));
s = say(s, 'May I have the pick?', 'give:pick');
assert.equal(s.items.find((i) => i.id === 'pick').owner, 'player');
assert.throws(() => say(s, 'Again', 'give:pick'));
assert.throws(() => E.act(s, 'unlock', { item: 'pick', room: 'archive' }));
const before = JSON.stringify(s);
s = E.act(s, 'insert', { item: 'pick', room: 'archive' });
assert.equal(E.act(s, 'cancel').items.find((i) => i.id === 'pick').capacity, 0);
s = E.act(s, 'unlock', { item: 'pick', room: 'archive' });
assert.equal(s.doors.archive, false);
assert.equal(E.roomsFor(s).archive.locked, false);
s = say(s, 'Follow me', 'follow');
s = E.act(s, 'move', 'archive');
assert.equal(s.npcs.ada.room, 'archive');
s = E.act(s, 'inventory', { ids: ['letter'], verb: 'pickup' });
s = E.act(s, 'inventory', { ids: ['letter'], verb: 'give', target: 'ada' });
assert(E.context(s, 'Thanks', 'ada').ownedItems.some((i) => i.id === 'letter'));
assert.throws(() => E.act(s, 'inventory', { ids: ['letter'], verb: 'give', target: 'ada' }));
s = E.act(s, 'move', 'hall');
s = say(s, '/w 2 secret', 'none');
assert(!E.context(s, 'Hello', 'ivo').recent.some((m) => m.text.includes('secret')));
s = say(s, 'Go outside', 'move:street');
s = say(s, '/shout Can you hear me?', 'none');
assert(E.context(s, '/shout Hello', 'ada').recent.some((m) => m.text.includes('hear me')));
assert.deepEqual(E.validate(JSON.parse(JSON.stringify(s))), s);
assert.equal(E.validate({ ...s, key: 'never save this' }).key, undefined);
assert.equal(JSON.parse(before).doors.archive, true);
const mixed = [
  { at: '2026-01-01T00:00:03Z', who: 'Story', text: 'third', room: 'hall' },
  { at: '2026-01-01T00:00:01Z', who: 'Player', text: 'first', room: 'hall' },
  { at: '2026-01-01T00:00:02Z', who: 'Ada', text: 'second', room: 'hall' },
];
assert.deepEqual(
  APSUSoloTimeline.ordered(mixed).map((m) => m.text),
  ['first', 'second', 'third'],
);
assert(
  APSUSoloTimeline.summary({ ...s, messages: mixed }).indexOf('first') <
    APSUSoloTimeline.summary({ ...s, messages: mixed }).indexOf('third'),
);
// Mercer can resolve both needs through real items; narration cannot fabricate this outcome.
let m = E.createMercer('Tester');
m = E.act(m, 'move', 'street');
m = E.act(m, 'move', 'roof');
m = E.act(m, 'inventory', { ids: ['battery'], verb: 'pickup' });
m = E.act(m, 'move', 'street');
m = E.act(m, 'move', 'workshop');
m = E.act(m, 'use-battery');
assert(m.generatorPowered);
assert(!m.vanFueled);
assert(m.items.some((i) => i.id === 'fuel'));
assert(!E.validate(m).items.some((i) => i.kind === 'battery'));
m = E.act(m, 'give-pick');
const p = E.inventory(m).find((i) => i.kind === 'lockpick');
m = E.act(m, 'insert', p.id);
m = E.act(m, 'unlock', p.id);
m = E.act(m, 'move', 'supply');
m = E.act(m, 'inventory', { ids: ['fuel'], verb: 'pickup' });
m = E.act(m, 'move', 'workshop');
m = E.act(m, 'move', 'street');
m = E.act(m, 'use-fuel');
assert(m.generatorPowered && m.vanFueled);
assert.deepEqual(E.validate(m), m);
const key = 'sk-or-v1-' + 'a'.repeat(30),
  env = { SOLO_LIMIT: { limit: async () => ({ success: true }) } };
const request = (path, body) =>
  new Request('https://apsu.test/api/' + path, {
    method: 'POST',
    headers: { Origin: 'https://apsu.test', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
let calls = 0;
const transport = async (url, options) => {
  calls++;
  const body = JSON.parse(options.body);
  assert.equal(body.model, 'test/model:free');
  assert.equal(body.provider.allow_fallbacks, false);
  assert.equal(body.max_tokens, 6000);
  assert.deepEqual(body.reasoning, { effort: 'low', exclude: true });
  assert.equal(body.provider.max_price.prompt, 0);
  return Response.json({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(design) } }],
    usage: { cost: 0 },
  });
};
const body = {
  key,
  adult: true,
  model: 'test/model:free',
  prompt: 'A rain-soaked railway station',
};
let response = await soloCreate(request('solo-create', body), env, transport);
assert.equal(response.status, 200);
assert.equal((await response.json()).blueprint.title, design.title);
assert.equal(calls, 1);
response = await soloCreate(
  request('solo-create', { ...body, model: 'test/paid' }),
  env,
  transport,
);
assert.equal(response.status, 400);
assert.equal(calls, 1);
response = await soloCreate(request('solo-create', body), env, async () =>
  Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }),
);
assert.equal(response.status, 422);
// Preserve a complete valid JSON world even if the provider reports the token limit.
let generationAttempts = 0;
const generationReply = async (finish, content, extra = {}) =>
  soloCreate(request('solo-create', body), env, async () => {
    generationAttempts++;
    return Response.json({
      choices: [{ finish_reason: finish, message: { content, ...extra } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 6000,
        completion_tokens_details: { reasoning_tokens: 5900 },
        cost: 0,
      },
    });
  });
response = await generationReply('length', JSON.stringify(design));
assert.equal(response.status, 200);
let outcome = await response.json();
assert.equal(outcome.blueprint.title, design.title);
assert.match(outcome.warning, /complete/);
response = await generationReply('length', '{"title":"cut off');
assert.equal(response.status, 502);
outcome = await response.json();
assert.match(outcome.error, /per-request output limit/);
assert.equal(outcome.usage.reasoning, 5900);
assert.equal(outcome.usage.cost, 0);
assert(!outcome.blueprint);
response = await generationReply('length', '');
assert.equal(response.status, 502);
assert.match((await response.json()).error, /output limit/);
response = await generationReply('content_filter', JSON.stringify(design));
assert.equal(response.status, 422);
assert.match((await response.json()).error, /declined/);
response = await generationReply('stop', JSON.stringify(design), { refusal: 'Declined' });
assert.equal(response.status, 422);
response = await generationReply('error', '');
assert.equal(response.status, 502);
assert.match((await response.json()).error, /provider reported an error/);
response = await generationReply('stop', 'not json');
assert.equal(response.status, 422);
assert.match((await response.json()).error, /malformed/);
response = await generationReply('length', '{}');
assert.equal(response.status, 422); // Complete JSON still must satisfy all world rules.
assert.equal(generationAttempts, 8); // Exactly one provider call per attempt, no retries.
response = await soloChat(
  request('solo-chat', {
    key,
    provider: 'openrouter',
    adult: true,
    model: 'test/model:free',
    context: E.context(s, '/shout Hello', 'ada'),
  }),
  env,
  async (url, options) => {
    const b = JSON.parse(options.body);
    assert(!options.body.includes(key));
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({ dialogue: 'Hello.', memory: null, action: 'none' }),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });
  },
);
assert.equal(response.status, 200, await response.text());
console.log(
  'PASS: generated world validation, tracked transfers, lock script, witnesses, chronological scene summary, Mercer battery alternative, bounded generation and chat relays. No live inference.',
);

// A direct encounter can add one local NPC, never extra rooms or a duplicate person.
const encounterPatch = {
  rooms: [],
  items: [],
  characters: [
    {
      id: 'bartender',
      name: 'Rin Holt',
      room: 'hall',
      description: 'An adult bartender with rolled sleeves.',
      personality: 'Dry humor.',
      goal: 'Keep the station bar open.',
    },
  ],
};
const encounterRequest = {
  ...body,
  mode: 'expand',
  blueprint: design,
  anchor: 'hall',
  encounter: 'bartender',
};
const encounterReply = (patch) =>
  soloCreate(request('solo-create', encounterRequest), env, async () =>
    Response.json({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(patch) } }],
      usage: { cost: 0 },
    }),
  );
let encounterResponse = await encounterReply(encounterPatch);
assert.equal(encounterResponse.status, 200);
assert(
  (await encounterResponse.json()).blueprint.roles.some(
    (r) => r.name === 'bartender' && r.holder === 'bartender',
  ),
);
assert.equal((await encounterReply({ ...encounterPatch, rooms: [{ id: 'extra' }] })).status, 422);
assert.equal(
  (
    await encounterReply({
      ...encounterPatch,
      characters: [{ ...encounterPatch.characters[0], name: 'Ada' }],
    })
  ).status,
  422,
);
console.log('PASS: Missing-character relay constrains additions and rejects duplicate actors.');

const contextualWorld = E.createGenerated(design, 'Tester');
const contextualScene = E.context(
  contextualWorld,
  'We have been sitting here with empty glasses for a while.',
  'ada',
);
contextualScene.expansionAllowed = true;
const contextualReply = async (allowed) =>
  soloChat(
    request('solo-chat', {
      key,
      provider: 'openrouter',
      adult: true,
      model: 'test/model:free',
      context: { ...contextualScene, expansionAllowed: allowed },
    }),
    env,
    async (url, options) => {
      const prompt = JSON.parse(options.body).messages[0].content;
      assert(prompt.includes('Infer the intent from the whole exchange'));
      return Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                dialogue: 'Let us see who is serving.',
                memory: null,
                action: 'none',
                newCharacter: {
                  role: 'waiter',
                  reason: 'The lounge scene implies an available member of staff.',
                },
              }),
            },
          },
        ],
        usage: { cost: 0 },
      });
    },
  );
const contextualResult = await contextualReply(true);
assert.equal(contextualResult.status, 200);
assert.equal((await contextualResult.json()).newCharacter.role, 'waiter');
assert.equal((await (await contextualReply(false)).json()).newCharacter, undefined);
console.log(
  'PASS: contextual cast proposals pass through dialogue without trigger phrases and respect expansion eligibility.',
);

const reactionResponse = await soloChat(
  request('solo-chat', {
    key: 'sk-or-v1-' + 'x'.repeat(40),
    provider: 'openrouter',
    model: 'apodex/apodex-1.1-mini:free',
    adult: true,
    context: { ...contextualScene, trigger: 'reaction', expansionAllowed: true },
  }),
  env,
  async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.match(payload.messages[0].content, /brief optional interjection/);
    assert.match(payload.messages[0].content, /do not use an unfamiliar person's name/i);
    const supplied = JSON.parse(payload.messages[1].content);
    assert.equal(supplied.expansionAllowed, false);
    const schema = JSON.parse(payload.messages[0].content.split('OUTPUT_SCHEMA=')[1]);
    assert.deepEqual(schema.required, ['dialogue', 'action', 'memory']);
    assert.deepEqual(payload.reasoning, { enabled: true, exclude: true });
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              dialogue: 'I heard that.',
              action: 'none',
              memory: null,
              newCharacter: { role: 'waiter', reason: 'ignored' },
              goalReflection: { goal: 'ignored', reason: 'ignored' },
            }),
          },
        },
      ],
    });
  },
);
assert.equal(reactionResponse.status, 200, await reactionResponse.clone().text());
const reactionData = await reactionResponse.json();
assert.equal(reactionData.newCharacter, undefined);
assert.equal(reactionData.goalReflection, undefined);
console.log(
  'PASS: interjections use the brief contract, preserve reasoning, and cannot trigger unrelated generation.',
);

// Economy extraction shares the existing dialogue request; relay preserves proposals for local validation.
const paymentProposal = {
  recipient: 'ada',
  amountMinor: 250,
  room: null,
  evidence: 'I hand you two dollars and fifty cents.',
};
let economyCalls = 0;
const economyResponse = await soloChat(
  request('solo-chat', {
    key,
    provider: 'openrouter',
    adult: true,
    model: 'test/model:free',
    context: { ...contextualScene, message: paymentProposal.evidence, expansionAllowed: false },
  }),
  env,
  async (url, options) => {
    economyCalls++;
    const body = JSON.parse(options.body);
    assert(body.messages[0].content.includes('Never silently reduce a claimed payment'));
    assert(body.messages[0].content.includes('hypothetical payments'));
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              dialogue: 'Thank you.',
              memory: null,
              action: 'none',
              payment: paymentProposal,
              rentalOffer: { room: 'archive', priceMinor: 500 },
            }),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0 },
    });
  },
);
assert.equal(economyResponse.status, 200, await economyResponse.clone().text());
const economyResult = await economyResponse.json();
assert.deepEqual(economyResult.payment, paymentProposal);
assert.deepEqual(economyResult.rentalOffer, { room: 'archive', priceMinor: 500 });
assert.equal(economyCalls, 1);
console.log(
  'PASS: contextual payment and rental proposals survive one free-model relay request without extra inference.',
);
