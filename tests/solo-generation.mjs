import assert from 'node:assert/strict';
import { soloCreate } from '../worker/solo-create.mjs';
const G = APSUSoloGeneration;
const outline = {
  title: 'Port Meridian',
  premise:
    'A harbor city prepares for a storm. People have work, loyalties and secrets of their own.',
  start: 'r0',
  storyMode: 'sandbox',
  zones: [
    { id: 'port', name: 'The waterfront', kind: 'region', parent: null },
    { id: 'guild', name: 'Guild House', kind: 'building', parent: 'port' },
  ],
  currency: { name: 'Crown', symbol: 'crowns', decimals: 0 },
  rooms: Array.from({ length: 8 }, (_, i) => ({
    id: 'r' + i,
    name: [
      'Harbor Steps',
      'Customs Hall',
      'Ropewalk',
      'Glass Market',
      'Guild Foyer',
      'Chart Room',
      'Upper Gallery',
      'Sealed Office',
    ][i],
    description: 'A place with its own history.',
    zone: i < 4 ? 'port' : 'guild',
    locked: i === 7,
    exits: [...(i > 0 ? ['r' + (i - 1)] : []), ...(i < 7 ? ['r' + (i + 1)] : [])],
  })),
  characters: Array.from({ length: 4 }, (_, i) => ({
    id: 'n' + i,
    name: ['Mara', 'Elias', 'Soren', 'Anya'][i],
    description: 'A resident of the port.',
    personality: 'Independent.',
    goal: 'Keep their livelihood.',
    room: 'r' + i,
  })),
  items: [
    {
      id: 'pick',
      name: 'Steel pick',
      description: 'A narrow steel tool.',
      kind: 'lockpick',
      owner: 'n0',
    },
  ],
  lore: [],
};
let world = G.apply('outline', null, outline);
const patch = (stage, w) =>
  stage === 'people'
    ? {
        characters: w.characters.map((c) => ({
          id: c.id,
          description: 'A salt-stained coat and weathered hands.',
          personality: 'Guarded but generous.',
          goal: 'Keep the harbor open through the storm.',
          routine: ['r0', 'r1'],
        })),
        lore: [{ fact: 'The harbor guild owes a debt to the pilots.', knownBy: ['n0', 'n1'] }],
      }
    : {
        rooms: G.scope(stage, w).map((r) => ({
          id: r.id,
          description: 'Rain taps the windows; the smell of tar lingers.',
          name: 'Must not replace',
          exits: [],
        })),
        items: [
          {
            id: stage + 'lamp',
            name: 'Oil lamp',
            description: 'A brass lamp.',
            kind: 'prop',
            owner: G.scope(stage, w)[0].id,
          },
        ],
      };
const before = structuredClone(world);
assert.throws(() => G.apply('places', world, { rooms: [], items: [] }), /assigned rooms/);
assert.deepEqual(world, before);
const env = { SOLO_LIMIT: { limit: async () => ({ success: true }) } };
const body = {
  key: 'sk-or-v1-' + 'x'.repeat(30),
  adult: true,
  model: 'test/model:free',
  prompt: 'A harbor city with competing guilds.',
};
const req = (b) =>
  new Request('https://apsu.test/api/solo-create', {
    method: 'POST',
    headers: { Origin: 'https://apsu.test', 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  });
let calls = 0;
for (const stage of G.stages) {
  const payload = stage.id === 'outline' ? outline : patch(stage.id, world);
  const response = await soloCreate(
    req({ ...body, stage: stage.id, blueprint: stage.id === 'outline' ? undefined : world }),
    env,
    async (url, options) => {
      calls++;
      const request = JSON.parse(options.body);
      assert.equal(request.provider.max_price.completion, 0);
      assert.equal(request.provider.allow_fallbacks, false);
      if (stage.id === 'outline') assert.match(request.messages[0].content, /8–12 connected/);
      else assert.match(request.messages[0].content, /Enrich one stage/);
      return Response.json({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }],
        usage: { cost: 0 },
      });
    },
  );
  assert.equal(response.status, 200, await response.clone().text());
  world = (await response.json()).blueprint;
}
assert.equal(calls, 4);
assert.equal(world.rooms[0].name, 'Harbor Steps');
assert.deepEqual(world.rooms[0].exits, ['r1']);
assert.equal(world.characters[0].name, 'Mara');
assert.equal(world.items.length, 3);
assert.equal(world.lore.length, 1);
const draft = G.draft({
  prompt: body.prompt,
  step: 2,
  blueprint: world,
  receipts: [{ cost: 0, key: 'FAKE_API_CREDENTIAL_0123456789' }],
  key: 'FAKE_API_CREDENTIAL_0123456789',
});
assert(!JSON.stringify(draft).includes('FAKE_API_CREDENTIAL_0123456789'));
assert.equal(G.draft(JSON.parse(JSON.stringify(draft))).step, 2);
assert.throws(
  () => G.apply('people', world, { characters: world.characters.slice(1), lore: [] }),
  /cast/,
);
assert.throws(
  () =>
    G.apply('interiors', world, { ...patch('interiors', world), items: [{ ...world.items[0] }] }),
  /unique/,
);
const invalid = await soloCreate(req({ ...body, stage: 'nope' }), env, () => {
  throw Error('must not call provider');
});
assert.equal(invalid.status, 400);
console.log(
  'PASS: four-stage world creation, preserved canonical IDs/topology, complete stage coverage, safe resumable drafts, invalid stages and no provider fallback. No live inference.',
);

// Regression for the production failure: optional reasoning consumed 5,094 of 6,000 tokens.
// Default free generation now requests no reasoning, JSON mode, and output headroom.
let freeCalls = 0;
const freeResponse = await soloCreate(
  req({ ...body, model: 'apodex/apodex-1.1-mini:free', stage: 'outline' }),
  env,
  async (url, options) => {
    freeCalls++;
    const sent = JSON.parse(options.body);
    assert.deepEqual(sent.reasoning, { enabled: false, exclude: true });
    assert.equal(sent.max_tokens, 12000);
    assert.deepEqual(sent.response_format, { type: 'json_object' });
    assert.deepEqual(sent.provider.max_price, { prompt: 0, completion: 0 });
    assert.equal(sent.provider.allow_fallbacks, false);
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(outline) } }],
      usage: {
        completion_tokens: 8000,
        completion_tokens_details: { reasoning_tokens: 5094 },
        cost: 0,
      },
    });
  },
);
assert.equal(freeResponse.status, 200, await freeResponse.clone().text());
assert.equal((await freeResponse.json()).blueprint.rooms.length, 8);
assert.equal(freeCalls, 1);
const paidResponse = await soloCreate(
  req({ ...body, model: 'test/paid', allowPaid: true, stage: 'outline' }),
  env,
  async (url, options) => {
    const sent = JSON.parse(options.body);
    assert.equal(sent.max_tokens, 6000);
    assert(!sent.response_format);
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(outline) } }],
    });
  },
);
assert.equal(paidResponse.status, 200);
console.log(
  'PASS: default free generator disables optional reasoning, requests JSON, preserves world size, and reserves headroom without raising paid-model budgets or retrying.',
);

// Missing reverse links are mechanical omissions, not reasons to waste a generation.
const oneWay = structuredClone(outline);
oneWay.rooms[1].exits = ['r2'];
oneWay.rooms[7].exits = []; // A locked leaf can list no exit if its neighbor names it.
const untouched = structuredClone(oneWay);
const repaired = G.apply('outline', null, oneWay);
assert.deepEqual(oneWay, untouched);
assert.deepEqual(new Set(repaired.rooms[1].exits), new Set(['r0', 'r2']));
assert.deepEqual(repaired.rooms[7].exits, ['r6']);
assert.equal(repaired.rooms[7].locked, true);
assert.equal(repaired.rooms.length, outline.rooms.length);
assert.deepEqual(G.apply('outline', null, repaired), repaired); // Idempotent.
assert.throws(() => APSUSoloBlueprint.validate(oneWay)); // Imported/saved maps remain strict.
const worldBeforeRepairs = G.apply('outline', null, outline);
const unknown = structuredClone(outline);
unknown.rooms[0].exits.push('nonexistent');
assert.deepEqual(G.apply('outline', null, unknown), worldBeforeRepairs);
const conflicting = structuredClone(outline);
conflicting.rooms[0].exits.push('r7');
assert.equal(G.apply('outline', null, conflicting).rooms[7].exits.length, 1);
const isolated = structuredClone(outline);
isolated.rooms[3].exits = ['r2'];
isolated.rooms[4].exits = ['r5'];
assert.doesNotThrow(() => G.apply('outline', null, isolated));
let repairedCalls = 0;
const repairedResponse = await soloCreate(req({ ...body, stage: 'outline' }), env, async () => {
  repairedCalls++;
  return Response.json({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(oneWay) } }],
  });
});
assert.equal(repairedResponse.status, 200, await repairedResponse.clone().text());
assert.equal(repairedCalls, 1);
assert.deepEqual((await repairedResponse.json()).blueprint.rooms[7].exits, ['r6']);
console.log(
  'PASS: missing reverse exits repaired without inference, locked entrances preserved, unknown endpoints removed and disconnected maps connected, source and saved-world validation unchanged.',
);

// Model weapon vocabulary must not discard a valid world stage.
const weaponPatch = patch('places', before);
weaponPatch.items = [
  {
    id: 'sabre',
    kind: 'weapon',
    template: ' Sword ',
    name: 'Guild sabre',
    description: 'Steel.',
    owner: 'n0',
  },
  { id: 'sidearm', kind: 'weapon', name: 'Glock 19', description: 'A sidearm.', owner: 'n1' },
  {
    id: 'baton',
    kind: 'weapon',
    template: 'blunt-weapon',
    name: 'Watch baton',
    description: 'Wood.',
    owner: 'r0',
  },
  {
    id: 'device',
    kind: 'weapon',
    template: 'phase_cannon',
    name: 'Phase resonator',
    description: 'An exotic device.',
    owner: 'r1',
  },
];
const untouchedWeapons = structuredClone(weaponPatch);
const prepared = G.prepareItems(weaponPatch);
assert.deepEqual(weaponPatch, untouchedWeapons);
assert.equal(prepared.value.items[0].template, 'blade');
assert.equal(prepared.value.items[1].template, 'pistol');
assert.equal(prepared.value.items[2].template, 'blunt');
assert.equal(prepared.value.items[3].kind, 'prop');
assert.equal(prepared.warnings.length, 1);
assert(!('template' in prepared.value.items[3]));
const finishedWeapons = G.apply('places', before, weaponPatch);
assert.equal(finishedWeapons.items.find((i) => i.id === 'sabre').template, 'blade');
assert.throws(
  () => APSUSoloBlueprint.validate({ ...before, items: [...before.items, ...weaponPatch.items] }),
  /supported weapon/,
);
const brokenOwner = structuredClone(weaponPatch);
brokenOwner.items[0].owner = 'missing';
assert.throws(() => G.apply('places', before, brokenOwner), /valid kinds and owners/);
let weaponCalls = 0;
const weaponResponse = await soloCreate(
  req({ ...body, stage: 'places', blueprint: before }),
  env,
  async () => {
    weaponCalls++;
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(weaponPatch) } }],
      usage: { cost: 0 },
    });
  },
);
assert.equal(weaponResponse.status, 200, await weaponResponse.clone().text());
const weaponResult = await weaponResponse.json();
assert.equal(weaponResult.warnings.length, 1);
assert.equal(weaponCalls, 1);
const savedNotice = G.draft({
  prompt: body.prompt,
  step: 2,
  blueprint: weaponResult.blueprint,
  notices: weaponResult.warnings,
});
assert.match(savedNotice.notices[0], /no combat stats/);
console.log(
  'PASS: generated weapon aliases and missing templates normalize without retries, unsupported devices preserve descriptions as noncombat props with saved notices, and inventory validation stays strict.',
);

// Keys resolve against canonical rooms, not description-only enrichment rows.
const keyPatch = patch('places', before);
keyPatch.items = [
  {
    id: 'named_key',
    name: 'Office key',
    description: 'Brass.',
    kind: 'key',
    opens: ' sealed office ',
    owner: 'n0',
  },
  { id: 'valid_key', name: 'Spare', description: '', kind: 'key', opens: 'r7', owner: 'n1' },
  ...[undefined, 'missing', 'r0'].map((opens, i) => ({
    id: 'decorative_' + i,
    name: 'Old key',
    description: 'Weathered.',
    kind: 'key',
    opens,
    owner: 'r0',
  })),
];
const originalKeys = structuredClone(keyPatch);
const keys = G.prepareItems(keyPatch, before);
assert.deepEqual(keyPatch, originalKeys);
assert.deepEqual(
  keys.value.items.slice(0, 2).map((i) => i.opens),
  ['r7', 'r7'],
);
assert(keys.value.items.slice(2).every((i) => i.kind === 'prop' && !('opens' in i)));
assert.equal(keys.warnings.length, 3);
assert.deepEqual(G.prepareItems(keys.value, before).value, keys.value);
assert.equal(
  G.apply('places', before, keyPatch).items.find((i) => i.id === 'named_key').opens,
  'r7',
);
assert.throws(
  () => APSUSoloBlueprint.validate({ ...before, items: [...before.items, ...keyPatch.items] }),
  /Keys must/,
);
const ambiguous = structuredClone(before);
ambiguous.rooms[0].name = 'Sealed Office';
assert.equal(G.prepareItems(keyPatch, ambiguous).value.items[0].kind, 'prop');
const invalidOwnerKey = structuredClone(keyPatch);
invalidOwnerKey.items[0].owner = 'missing';
assert.throws(() => G.apply('places', before, invalidOwnerKey), /valid kinds and owners/);
// Fresh generation and expansion can resolve new rooms too.
assert.equal(G.prepareItems({ ...before, items: keyPatch.items }).value.items[0].opens, 'r7');
assert.equal(
  G.prepareItems(
    {
      rooms: [{ id: 'new_room', name: 'Vault', locked: true }],
      items: [{ ...keyPatch.items[0], opens: 'Vault' }],
    },
    before,
  ).value.items[0].opens,
  'new_room',
);
let keyCalls = 0;
const keyResponse = await soloCreate(
  req({ ...body, stage: 'places', blueprint: before }),
  env,
  async () => {
    keyCalls++;
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(keyPatch) } }],
    });
  },
);
assert.equal(keyResponse.status, 200, await keyResponse.clone().text());
const keyResult = await keyResponse.json();
assert.equal(keyCalls, 1);
assert.equal(keyResult.warnings.length, 3);
assert.equal(keyResult.blueprint.items.find((i) => i.id === 'named_key').opens, 'r7');
assert.match(
  G.draft({
    prompt: body.prompt,
    step: 2,
    blueprint: keyResult.blueprint,
    notices: keyResult.warnings,
  }).notices[0],
  /does not unlock/,
);
console.log(
  'PASS: generated key targets resolve to canonical locked rooms, invalid targets become disclosed decorative props, owners and saved-world validation remain strict, and no retry is made.',
);

// Enrichment accepts descriptive categories and exact owner names without inventing state.
const interiorItems = patch('interiors', before);
interiorItems.items = [
  { id: 'coat', name: 'Raincoat', kind: 'clothing', owner: ' Mara ' },
  {
    id: 'note',
    name: 'Note',
    kind: ' PROP ',
    owner: 'Sealed Office',
    description: 'x'.repeat(501),
  },
  { id: 'tool', name: 'Steel pick', kind: 'lock pick', owner: 'n1', description: '' },
  { id: 'blade_item', name: 'Dagger', kind: 'dagger', owner: 'r4', description: '' },
];
const originalInteriorItems = structuredClone(interiorItems);
const normalizedItems = G.prepareItems(interiorItems, before);
assert.deepEqual(interiorItems, originalInteriorItems);
assert.deepEqual(
  normalizedItems.value.items.map((i) => i.kind),
  ['prop', 'prop', 'lockpick', 'weapon'],
);
assert.deepEqual(
  normalizedItems.value.items.map((i) => i.owner),
  ['n0', 'r7', 'n1', 'r4'],
);
assert.equal(normalizedItems.value.items[0].description, '');
assert.equal(normalizedItems.value.items[1].description.length, 500);
assert.equal(normalizedItems.value.items[3].template, 'blade');
assert.equal(normalizedItems.warnings.length, 2);
assert.deepEqual(G.prepareItems(normalizedItems.value, before).value, normalizedItems.value);
assert.equal(
  G.apply('interiors', before, interiorItems).items.find((i) => i.id === 'coat').owner,
  'n0',
);
const sameName = structuredClone(before);
sameName.rooms[0].name = 'Mara';
assert.throws(() => G.apply('interiors', sameName, interiorItems), /Item "coat".*owner/);
for (const owner of [null, 'missing', 'guild', { id: 'n0' }]) {
  const invalid = structuredClone(interiorItems);
  invalid.items[0].owner = owner;
  assert.throws(() => G.apply('interiors', before, invalid), /Item "coat".*owner/);
}
const invalidName = structuredClone(interiorItems);
invalidName.items[0].name = '';
assert.throws(() => G.apply('interiors', before, invalidName), /Item "coat".*name/);
assert.throws(
  () => APSUSoloBlueprint.validate({ ...before, items: [...before.items, ...interiorItems.items] }),
  /Item "coat"/,
);
let interiorCalls = 0;
const interiorResponse = await soloCreate(
  req({ ...body, stage: 'interiors', blueprint: before }),
  env,
  async () => {
    interiorCalls++;
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(interiorItems) } }],
    });
  },
);
assert.equal(interiorResponse.status, 200, await interiorResponse.clone().text());
const interiorResult = await interiorResponse.json();
assert.equal(interiorCalls, 1);
assert.equal(interiorResult.warnings.length, 2);
assert.equal(
  G.draft({
    prompt: body.prompt,
    step: 3,
    blueprint: interiorResult.blueprint,
    notices: interiorResult.warnings,
  }).step,
  3,
);
assert.match(G.instruction('interiors', before), /"kind":"prop","owner":"r4"/);
console.log(
  'PASS: descriptive item categories, canonical owner names, bounded descriptions, precise field errors, strict ambiguous/unknown owners and stage-three relay without retries.',
);

const unplaced = patch('interiors', before);
unplaced.items = [{ id: 'i22', name: 'Coat', kind: 'prop', description: '', owner: null }];
const spawned = G.prepareItems(unplaced, before, 'r4');
assert.equal(spawned.value.items[0].owner, 'r4');
assert.match(spawned.warnings[0], /spawned on the floor/);
assert.equal(unplaced.items[0].owner, null);
let spawnCalls = 0;
const spawnResponse = await soloCreate(
  req({ ...body, stage: 'interiors', blueprint: before }),
  env,
  async () => {
    spawnCalls++;
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(unplaced) } }],
    });
  },
);
assert.equal(spawnResponse.status, 200, await spawnResponse.clone().text());
const spawnResult = await spawnResponse.json();
assert.equal(spawnResult.blueprint.items.find((i) => i.id === 'i22').owner, 'r4');
assert.equal(spawnResult.warnings.length, 1);
assert.equal(spawnCalls, 1);
console.log(
  'PASS: unplaced stage items spawn on a canonical room floor with notice and no extra inference.',
);

for (const [status, expected] of [
  [401, /API key/],
  [402, /credits/],
  [403, /policy/],
  [404, /endpoint/],
  [429, /rate limiting/],
  [502, /unavailable/],
  [503, /routing/],
]) {
  let calls = 0;
  const res = await soloCreate(
    req({ ...body, stage: 'people', blueprint: before }),
    env,
    async () => {
      calls++;
      return Response.json(
        {
          error: {
            message: 'private prompt and sk-or-v1-do-not-return',
            metadata: { raw: 'private' },
          },
        },
        { status, headers: { 'Retry-After': '60' } },
      );
    },
  );
  const data = await res.json();
  assert.equal(data.providerStatus, status);
  assert.match(data.error, expected);
  assert.match(data.error, /60 seconds/);
  assert.match(data.error, /Completed stages are saved/);
  assert(!JSON.stringify(data).includes('do-not-return'));
  assert.equal(calls, 1);
}
console.log(
  'PASS: provider errors preserve status and retry timing without leaking raw content, retrying, or losing stages.',
);

// Real provider failure shapes: absent lists, duplicate IDs, names instead of IDs,
// self-loops, missing character detail and disconnected components.
const messy = structuredClone(outline);
delete messy.rooms[0].exits;
messy.rooms[1].exits = ['Customs Hall', 'Harbor Steps', 'missing'];
messy.rooms[2].id = 'r1';
messy.characters[0].room = 'Harbor Steps';
delete messy.characters[0].personality;
delete messy.characters[1].description;
delete messy.characters[2].goal;
messy.characters[3].room = 'missing';
const originalMess = structuredClone(messy);
const preparedOutline = G.prepareOutline(messy);
assert.ok(preparedOutline.warnings.length);
const playable = G.apply('outline', null, preparedOutline.value);
assert.equal(playable.rooms.length, 8);
assert.equal(new Set(playable.rooms.map((r) => r.id)).size, 8);
assert.equal(playable.characters[0].room, playable.start);
assert.deepEqual(messy, originalMess);
assert.deepEqual(G.apply('outline', null, playable), playable);
assert.throws(() => APSUSoloBlueprint.validate(messy));
let repairRequests = 0;
const messyResponse = await soloCreate(req({ ...body, stage: 'outline' }), env, async () => {
  repairRequests++;
  return Response.json({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(messy) } }],
  });
});
assert.equal(messyResponse.status, 200, await messyResponse.clone().text());
assert.equal(repairRequests, 1);
assert.ok((await messyResponse.json()).warnings.length);
assert.throws(() => G.apply('outline', null, { ...outline, rooms: [] }));
console.log(
  'PASS: outline repairs preserve strict saves, report adjustments and need only one provider request.',
);

// Sandbox worlds must not inherit the first tutorial's mandatory lockpick.
const remotePick = structuredClone(outline);
remotePick.items[0].owner = 'n3';
const remoteWorld = G.apply('outline', null, remotePick);
assert.equal(remoteWorld.items[0].owner, 'n3');
const noPick = structuredClone(outline);
noPick.items = [];
assert.doesNotThrow(() => G.apply('outline', null, noPick));
const tooManyPicks = structuredClone(outline);
tooManyPicks.items = Array.from({ length: 4 }, (_, i) => ({
  ...outline.items[0],
  id: 'pick_' + i,
  owner: 'player',
}));
assert.throws(() => G.apply('outline', null, tooManyPicks), /at most 3/);
const brokenKey = structuredClone(outline);
brokenKey.items = [
  { id: 'key', name: 'Key', description: 'Brass', kind: 'key', owner: 'n0', opens: 'missing' },
];
assert.throws(() => APSUSoloBlueprint.validate(brokenKey), /Keys must name/);

// Presentation metadata is bounded, optional, durable and never changes stage IDs.
const themed = [
  'Drawing the Meridian',
  'Lighting the Marquee',
  'Behind the Velvet Doors',
  'Faces of the Night',
];
let themedCalls = 0;
const themedResponse = await soloCreate(
  req({ ...body, stage: 'outline' }),
  env,
  async (_url, init) => {
    themedCalls++;
    assert.match(JSON.parse(init.body).messages[0].content, /stageTitles/);
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({ ...remotePick, stageTitles: themed }),
          },
        },
      ],
    });
  },
);
assert.equal(themedResponse.status, 200, await themedResponse.clone().text());
const themedData = await themedResponse.json();
assert.equal(themedCalls, 1);
assert.deepEqual(themedData.stageTitles, themed);
const restored = G.draft(
  JSON.parse(
    JSON.stringify(
      G.draft({
        prompt: 'An Art Deco hotel',
        step: 1,
        blueprint: themedData.blueprint,
        stageTitles: themed,
      }),
    ),
  ),
);
assert.deepEqual(
  G.displayStages(restored).map((s) => s.title),
  themed,
);
assert.deepEqual(
  G.displayStages(restored).map((s) => s.id),
  G.stages.map((s) => s.id),
);
assert.equal(G.cleanTitles(['only one']), null);
assert.equal(G.cleanTitles([null, 2, {}, 'bad']), null);
assert.equal(G.cleanTitles(Array(4).fill('x'.repeat(100)))[0].length, 70);
assert.equal(G.displayStages({ prompt: 'An Art Deco hotel' })[0].title, G.stages[0].title);
assert.equal(G.draft({ prompt: 'New world', step: 0 }).stageTitles, null);
assert.equal(G.displayStages(null)[0].title, G.stages[0].title);
console.log(
  'PASS: remote or absent picks accepted, inventory/key rules retained, themed stage titles survive resume with no extra requests.',
);

// Exercise the real relay/compiler, including multiple mistakes in one response.
for (let variant = 0; variant < 24; variant++) {
  const raw = structuredClone(outline);
  raw.characters[0].id = 'NPC 1';
  raw.items.push({
    id: 'pick',
    name: 'Jewelry',
    kind: 'accessory',
    owner: variant % 2 ? null : 'unknown',
    description: 'A keepsake',
    valueMinor: 1500,
  });
  raw.items[0].owner = variant % 3 ? 'Mara' : 'NPC 1';
  raw.rooms[1].exits.push(raw.rooms[1].id, 'not-a-room');
  if (variant % 2) raw.rooms[2].id = raw.rooms[3].id;
  raw.characters[1].room = 'Customs Hall';
  raw.lore = [
    { fact: 'A private fact', knownBy: ['NPC 1'] },
    { fact: 'Unassigned secret', knownBy: ['ghost'] },
  ];
  raw.roles = [
    { name: 'Manager', holder: 'Mara', room: 'Harbor Steps' },
    { name: 'Ghost', holder: 'missing', room: null },
  ];
  raw.zones[0].parent = 'guild'; // cycle
  const beforeRaw = structuredClone(raw);
  const result = G.compile('outline', null, raw);
  const ready = APSUSoloBlueprint.validate(result.blueprint);
  assert.deepEqual(raw, beforeRaw);
  assert.equal(ready.items.find((i) => i.name === 'Jewelry').owner, ready.start);
  assert.equal(ready.items.find((i) => i.name === 'Steel pick').owner, ready.characters[0].id);
  assert.equal(ready.lore.length, 1);
  assert.deepEqual(ready.lore[0].knownBy, [ready.characters[0].id]);
  assert.equal(ready.roles.length, 1);
  assert.ok(result.warnings.length);
  assert.throws(() => APSUSoloBlueprint.validate(raw));
}
let combinedCalls = 0;
const originalOwnerFailure = structuredClone(outline);
originalOwnerFailure.items.push({
  id: 'i6',
  name: 'Bottle opener',
  kind: 'prop',
  description: 'Steel',
  owner: 'unknown',
});
const ownerResponse = await soloCreate(req({ ...body, stage: 'outline' }), env, async () => {
  combinedCalls++;
  return Response.json({
    choices: [
      { finish_reason: 'stop', message: { content: JSON.stringify(originalOwnerFailure) } },
    ],
  });
});
assert.equal(ownerResponse.status, 200, await ownerResponse.clone().text());
assert.equal(combinedCalls, 1);
const ownerData = await ownerResponse.json();
assert.equal(ownerData.blueprint.items.find((i) => i.id === 'i6').owner, ownerData.blueprint.start);
assert.ok(ownerData.warnings.some((w) => /placement/.test(w)));
assert.throws(() => G.compile('outline', null, { rooms: [], characters: [] }));
assert.deepEqual(
  G.progressStages(null, false).map((s) => s.revealed),
  [false, false, false, false],
);
const progress = G.draft({ prompt: 'Test', step: 0, reachedStage: 0, receipts: [{}] });
assert.deepEqual(
  G.progressStages(progress, true).map((s) => s.revealed),
  [true, false, false, false],
);
assert.deepEqual(
  G.progressStages(progress, false).map((s) => s.revealed),
  [true, false, false, false],
);
const paused = G.draft({
  ...progress,
  step: 1,
  blueprint: ownerData.blueprint,
  receipts: [{}, {}, {}],
});
assert.deepEqual(
  G.progressStages(paused, false).map((s) => s.revealed),
  [true, false, false, false],
);
assert.deepEqual(
  G.progressStages({ ...paused, reachedStage: 1 }, true).map((s) => s.revealed),
  [true, true, false, false],
);
console.log(
  'PASS: 24 combined malformed drafts, original i6 relay failure, strict imports, single request and progressive title reveal.',
);

const collision = structuredClone(outline);
collision.items[0].id = collision.rooms[0].id;
const collisionWorld = G.compile('outline', null, collision).blueprint;
assert.equal(collisionWorld.start, outline.start);
assert.notEqual(collisionWorld.items[0].id, collisionWorld.start);
assert.equal(collisionWorld.items[0].owner, outline.characters[0].id);
// Later stages use the same owner resolution and immutable established topology.
let compiled = G.compile('outline', null, outline).blueprint;
for (const stage of ['places', 'interiors', 'people']) {
  const data = patch(stage, compiled);
  if (stage !== 'people') {
    data.items[0].owner = 'missing';
    data.items[0].id = compiled.rooms[0].id;
  }
  const previous = structuredClone(compiled);
  compiled = G.compile(stage, compiled, data).blueprint;
  assert.deepEqual(
    compiled.rooms.map((r) => r.exits),
    previous.rooms.map((r) => r.exits),
  );
}
assert.doesNotThrow(() => APSUSoloBlueprint.validate(compiled));

for (const [error, expected] of [
  [new DOMException('timeout', 'TimeoutError'), /90-second/],
  [new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }), /resolve OpenRouter/],
]) {
  const res = await soloCreate(req({ ...body, stage: 'outline' }), env, async () => {
    throw error;
  });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, expected);
}

// Partial enrichment cannot change topology or discard an otherwise valid stage.
{
  const base = G.apply('outline', null, outline);
  const first = G.scope('places', base)[0];
  const result = G.compile('places', base, {
    rooms: [
      { id: first.id, description: 'A newly described room.' },
      { id: first.id, description: 'Duplicate must not win.' },
      { id: 'unknown', description: 'Not part of this world.' },
    ],
    items: [],
  });
  assert.equal(
    result.blueprint.rooms.find((r) => r.id === first.id).description,
    'A newly described room.',
  );
  assert.deepEqual(
    result.blueprint.rooms.map((r) => [r.id, r.exits]),
    base.rooms.map((r) => [r.id, r.exits]),
  );
  assert.ok(result.warnings.some((w) => w.includes('keeps its existing description')));
  assert.throws(
    () => G.compile('places', base, { rooms: [], items: [] }),
    /no usable descriptions/,
  );
}

// Human-readable prices and container sizes are converted once at generation boundary.
{
  const items = [
    {
      id: 'watch_value',
      name: 'Watch',
      description: 'Silver',
      kind: 'prop',
      owner: 'player',
      value: 35,
    },
    {
      id: 'rye_volume',
      name: 'Rye decanter',
      description: 'Full',
      kind: 'drink',
      owner: 'player',
      abv: 40,
      servingMl: 45,
      volumeMl: 750,
      value: 18,
    },
    {
      id: 'rye_fallback',
      name: 'Whiskey bottle',
      description: 'Full',
      kind: 'drink',
      owner: 'player',
      abv: 40,
      servingMl: 45,
    },
    {
      id: 'last_shot',
      name: 'Whiskey bottle',
      description: 'Almost empty',
      kind: 'drink',
      owner: 'player',
      abv: 40,
      servingMl: 45,
      servings: 1,
    },
    {
      id: 'old_value',
      name: 'Keepsake',
      description: 'Old',
      kind: 'prop',
      owner: 'player',
      valueMinor: 35,
    },
  ];
  const result = G.prepareItems({ items }, world).value.items;
  assert.equal(result[0].valueMinor, 35 * 10 ** world.currency.decimals);
  assert.equal(result[1].servings, 16);
  assert.equal(result[2].servings, 16);
  assert.equal(result[3].servings, 1);
  assert.equal(result[4].valueMinor, 35);
  assert.equal(
    G.prepareItems(
      { items: [items[0]] },
      { ...world, currency: { name: 'USD', symbol: 'USD', decimals: 2 } },
    ).value.items[0].valueMinor,
    3500,
  );
  const cast = G.compile('people', world, {
    npcs: [{ id: world.characters[0].id, description: 'An updated resident.' }],
    lore: [],
  });
  assert.equal(cast.blueprint.characters.length, world.characters.length);
  assert.equal(cast.blueprint.characters[0].description, 'An updated resident.');
  assert.equal(cast.blueprint.characters[1].description, world.characters[1].description);
  assert.throws(
    () => G.compile('people', world, { npcs: [{ id: 'unknown', description: 'Nobody' }] }),
    /no usable updates/,
  );
}

// A complete small outline must survive all four stages, without invented padding.
{
  const small = structuredClone(outline);
  small.rooms = small.rooms.slice(0, 3);
  small.characters = small.characters.slice(0, 1);
  small.items = [];
  small.lore = [];
  let result = G.compile('outline', null, small);
  assert.equal(result.blueprint.rooms.length, 3);
  assert.equal(result.blueprint.characters.length, 1);
  assert.ok(result.warnings.some((w) => w.includes('3 rooms and 1 characters')));
  for (const stage of ['places', 'interiors']) {
    const prior = result.blueprint;
    result = G.compile(stage, prior, {
      rooms: G.scope(stage, prior).map((r) => ({ id: r.id, description: 'A furnished place.' })),
      items: [],
    });
  }
  result = G.compile('people', result.blueprint, {
    characters: result.blueprint.characters.map((c) => ({
      ...c,
      backstory: 'A life in the harbor.',
    })),
    lore: [],
  });
  assert.equal(result.blueprint.characters.length, 1);
  assert.throws(() => G.compile('outline', null, { ...small, rooms: [] }), /returned 0 rooms/);
  assert.throws(
    () => G.compile('outline', null, { ...small, characters: [] }),
    /returned 0 characters/,
  );
  assert.throws(
    () => G.compile('outline', null, { ...small, rooms: Array(25).fill(small.rooms[0]) }),
    /returned 25 rooms/,
  );
  assert.throws(
    () => G.compile('outline', null, { ...small, characters: Array(13).fill(small.characters[0]) }),
    /returned 13 characters/,
  );
  const bigger = structuredClone(outline);
  bigger.items = [];
  bigger.lore = [];
  bigger.characters = Array.from({ length: 9 }, (_, i) => ({
    ...small.characters[0],
    id: 'resident_' + i,
    name: 'Resident ' + i,
  }));
  assert.equal(G.compile('outline', null, bigger).blueprint.characters.length, 9);
}
