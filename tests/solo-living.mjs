import assert from 'node:assert/strict';
import '../js/solo-engine.js';
import '../js/solo-mercer.js';
import '../js/solo-blueprint.js';
import '../js/solo-simulation.js';
import '../js/solo-generated.js';
const E = APSUSoloEngine;
const design = {
  title: 'A Town',
  premise: 'People live here, with their own plans.',
  start: 'square',
  currency: { name: 'US Dollar', symbol: 'USD', decimals: 2 },
  zones: [
    { id: 'town', name: 'Town', kind: 'region', parent: null },
    { id: 'house', name: 'House', kind: 'building', parent: 'town' },
  ],
  rooms: [
    {
      id: 'square',
      name: 'Square',
      description: 'A town square.',
      exits: ['hall'],
      locked: false,
      zone: 'town',
    },
    {
      id: 'hall',
      name: 'House entrance',
      description: 'An entry hall.',
      exits: ['square', 'vault'],
      locked: false,
      zone: 'house',
    },
    {
      id: 'vault',
      name: 'Vault',
      description: 'A locked archive.',
      exits: ['hall'],
      locked: true,
      zone: 'house',
    },
  ],
  characters: [
    {
      id: 'guard',
      name: 'Guardian',
      description: 'A watchful local.',
      personality: 'Cautious.',
      goal: 'Keep the house safe.',
      room: 'square',
    },
  ],
  items: [
    { id: 'pick', kind: 'lockpick', name: 'Pick', description: 'Steel.', owner: 'guard' },
    {
      id: 'sword',
      kind: 'weapon',
      template: 'blade',
      name: 'Practice blade',
      description: 'An ordinary blade.',
      owner: 'player',
    },
  ],
};
let s = E.createGenerated(design, 'Tester');
assert.equal(s.sim.people.player.hp, 20);
assert(s.items.some((i) => i.kind === 'key' && i.opens === 'vault'));
assert.equal(s.blueprint.storyMode, 'sandbox');
assert(!E.mapFor(s).vault);
assert(E.mapFor(s, true).house);
const reply = (s, action, text = 'Hello') =>
  E.conversation(s, text, { dialogue: 'A reply.', action, memory: '' }, 'guard');
s = reply(s, 'block:hall');
assert.throws(() => E.act(s, 'move', 'hall'), /blocking/);
s = reply(s, 'unblock');
s = E.act(s, 'move', 'hall');
assert(E.mapFor(s).vault);
assert.throws(() => E.act(s, 'key-door', { room: 'vault' }), /matching key/);
s = E.act(s, 'move', 'square');
const key = s.items.find((i) => i.kind === 'key');
s = reply(s, 'give:' + key.id);
s = E.act(s, 'move', 'hall');
s = E.act(s, 'key-door', { room: 'vault' });
assert.equal(s.doors.vault, false);
s = E.act(s, 'move', 'vault');
s = E.act(s, 'key-door', { room: 'vault' });
assert.equal(s.doors.vault, true);
s = E.act(s, 'move', 'hall');
s = E.act(s, 'move', 'square');
s = E.act(s, 'edit-world', { blueprint: s.blueprint, money: 1000 });
s = E.act(s, 'pay', { target: 'guard', amount: 250 });
assert.equal(s.sim.people.player.money, 750);
assert.equal(s.sim.people.guard.money, 2250);
assert.throws(() => E.act(s, 'pay', { target: 'guard', amount: 751 }));
assert.throws(() => E.act(s, 'pay', { target: 'guard', amount: -1 }));
assert.equal(APSUSoloSimulation.money(s, 750), '7.50 USD');
const before = structuredClone(s);
const patch = {
  rooms: [
    {
      id: 'garden',
      name: 'Garden',
      description: 'A quiet garden.',
      zone: 'town',
      locked: false,
      exits: ['square'],
    },
  ],
  characters: [
    {
      id: 'gardener',
      name: 'Gardener',
      description: 'Mud on their sleeves.',
      personality: 'Practical.',
      goal: 'Grow food.',
      room: 'garden',
    },
  ],
  items: [],
};
s = E.act(s, 'expand-world', { anchor: 'square', patch });
assert.equal(s.npcs.guard.memory, before.npcs.guard.memory);
assert.equal(s.sim.people.player.money, 750);
assert(s.blueprint.rooms.find((r) => r.id === 'square').exits.includes('garden'));
assert.throws(() => E.act(s, 'expand-world', { anchor: 'square', patch }));
assert.deepEqual(E.validate(JSON.parse(JSON.stringify(s))), s);
s = E.act(s, 'equip', 'sword');
s = E.act(s, 'combat', { verb: 'start', target: 'guard' });
assert.throws(() => E.act(s, 'move', 'hall'), /Disengage/);
assert.throws(() => E.act(s, 'pay', { target: 'guard', amount: 1 }), /combat/);
// Persisted PRNG means identical snapshots produce identical encounter outcomes.
const snap = structuredClone(s);
assert.deepEqual(
  E.act(s, 'combat', { verb: 'attack' }).sim,
  E.act(snap, 'combat', { verb: 'attack' }).sim,
);
for (let n = 0; n < 100 && s.sim.combat; n++)
  s = E.act(s, 'combat', { verb: s.sim.combat.phase === 'enemy' ? 'continue' : 'attack' });
assert(!s.sim.combat);
assert(s.sim.people.player.hp === 0 || s.sim.people.guard.hp === 0);
const dead = s.sim.people.player.hp === 0 ? 'player' : 'guard';
assert.equal(E.validate(JSON.parse(JSON.stringify(s))).sim.people[dead].hp, 0);
assert.throws(() => reply(s, 'none'), /dead/i);
let long = E.createGenerated(design, 'Writer');
long = reply(long, 'none', 'x'.repeat(6000));
assert.equal(long.messages.find((m) => m.who === 'Player').text.length, 6000);
// Currency precision changes preserve the value held by all existing people.
let edited = E.createGenerated(design, 'Editor');
let draft = structuredClone(edited.blueprint);
draft.currency = { name: 'Gold', symbol: 'gold', decimals: 0 };
edited = E.act(edited, 'edit-world', { blueprint: draft });
assert.equal(edited.sim.people.guard.money, 20);
assert.equal(edited.sim.people.player.money, 20);
// New locked additions receive an actual NPC-owned key even if the model omitted one.
const lockedPatch = structuredClone(patch);
lockedPatch.rooms[0].locked = true;
let expanded = E.act(E.createGenerated(design, 'Explorer'), 'expand-world', {
  anchor: 'square',
  patch: lockedPatch,
});
assert(
  expanded.items.some((i) => i.kind === 'key' && i.opens === 'garden' && expanded.npcs[i.owner]),
);
// Removing a key does not mint a replacement on the next load.
expanded.items = expanded.items.filter((i) => !(i.kind === 'key' && i.opens === 'garden'));
assert(!E.validate(expanded).items.some((i) => i.kind === 'key' && i.opens === 'garden'));
// Offscreen routines move through the same graph and do not leak remote events into chat.
const routineDesign = structuredClone(design);
routineDesign.characters[0].routine = ['square'];
let routine = E.createGenerated(routineDesign, 'Observer');
routine.npcs.guard.room = 'hall';
routine.sim.turn = 2;
APSUSoloSimulation.advance(routine);
assert.equal(routine.npcs.guard.room, 'square');
assert.equal(E.validate(routine).npcs.guard.room, 'square');
console.log(
  'PASS: zones, private interiors, keys on both sides, real route blockers, exact currency transfers, additive expansion, weapons, deterministic combat, permanent death and long solo messages.',
);

let roleState = E.createGenerated(design, 'Owner');
assert.deepEqual(roleState.blueprint.roles, []);
const possessionsBefore = structuredClone(roleState.items);
let roleDraft = structuredClone(roleState.blueprint);
roleDraft.roles = [
  { name: 'Nightclub owner', holder: 'player', room: 'square', scope: 'The Meridian' },
];
roleState = E.act(roleState, 'edit-world', { blueprint: roleDraft });
assert.deepEqual(
  E.validate(JSON.parse(JSON.stringify(roleState))).blueprint.roles,
  roleDraft.roles,
);
assert.deepEqual(roleState.items, possessionsBefore);
assert(!E.context(roleState, 'Hello', 'guard').roles.some((r) => r.holder === 'player'));
roleDraft.roles[0].holder = 'guard';
roleState = E.act(roleState, 'edit-world', { blueprint: roleDraft });
assert.equal(E.context(roleState, 'Hello', 'guard').roles[0].holder, 'guard');
const handedRole = E.conversation(
  roleState,
  'I accept the role.',
  { dialogue: 'Then it is yours.', action: 'role-handover:0', memory: '' },
  'guard',
);
assert.equal(handedRole.blueprint.roles[0].holder, 'player');
assert.deepEqual(handedRole.items, roleState.items);
assert(!E.choices(handedRole, 'guard').some((a) => a.id === 'role-handover:0'));
assert.equal(
  E.validate(JSON.parse(JSON.stringify(handedRole))).blueprint.roles[0].holder,
  'player',
);
assert.throws(() =>
  E.conversation(
    handedRole,
    'Again',
    { dialogue: 'No.', action: 'role-handover:0', memory: '' },
    'guard',
  ),
);
roleDraft.roles[0].holder = 'missing';
assert.throws(() => E.act(roleState, 'edit-world', { blueprint: roleDraft }), /Roles need/);
console.log(
  'PASS: editable world roles survive saves, reach character context, and do not grant inventory or keys.',
);

// Distinct buildings must be separated by an actual outdoor room in new topology.
const twoBuildings = structuredClone(design);
twoBuildings.zones.push({ id: 'tower', name: 'High-rise', kind: 'building', parent: 'town' });
twoBuildings.rooms.push({
  id: 'tower_lobby',
  name: 'Tower lobby',
  description: 'A tall lobby.',
  zone: 'tower',
  locked: false,
  exits: ['hall'],
});
twoBuildings.rooms.find((r) => r.id === 'hall').exits.push('tower_lobby');
const routed = APSUSoloBlueprint.validate(APSUSoloBlueprint.withStreets(twoBuildings));
const street = routed.rooms.find((r) => r.id.startsWith('street_'));
assert(street && street.zone === 'town');
assert.deepEqual(street.exits, ['hall', 'tower_lobby']);
assert(!routed.rooms.find((r) => r.id === 'hall').exits.includes('tower_lobby'));
assert(twoBuildings.rooms.find((r) => r.id === 'hall').exits.includes('tower_lobby'));
assert.deepEqual(APSUSoloBlueprint.withStreets(routed), routed);
let buildingState = E.createGenerated(routed, 'Visitor');
buildingState.player.room = 'hall';
const insidePlan = E.mapFor(buildingState);
assert(insidePlan.vault && insidePlan.square.portal && insidePlan[street.id].portal);
assert(!insidePlan.tower_lobby);
const outsidePlan = E.mapFor(buildingState, true);
assert(outsidePlan.house.exits.includes(street.id));
assert(!outsidePlan.house.exits.includes('tower'));
assert(outsidePlan[street.id].exits.includes('tower'));
const nested = structuredClone(routed);
nested.zones.push({ id: 'floor', name: 'Upper floor', kind: 'building', parent: 'house' });
assert.equal(APSUSoloBlueprint.buildingFor(nested, 'floor').id, 'house');
console.log(
  'PASS: separate buildings route through outdoor streets, interiors hide other buildings, nested areas share their building boundary, and existing source data stays unchanged.',
);
const towerPatch = {
  rooms: [
    {
      id: 'tower_lobby',
      name: 'Tower lobby',
      description: 'A separate tower.',
      zone: 'tower',
      locked: false,
      exits: ['hall'],
    },
  ],
  characters: [],
  items: [],
  zones: [{ id: 'tower', name: 'High-rise', kind: 'building', parent: 'town' }],
  lore: [],
};
const towerExpansion = APSUSoloBlueprint.extend(design, towerPatch, 'hall');
assert(towerExpansion.rooms.some((r) => r.id.startsWith('street_')));
assert(!towerExpansion.rooms.find((r) => r.id === 'hall').exits.includes('tower_lobby'));
assert.deepEqual(APSUSoloBlueprint.withStreets(twoBuildings, twoBuildings), twoBuildings);

const drinks = structuredClone(design);
drinks.items.push(
  {
    id: 'beer',
    kind: 'drink',
    name: 'Beer',
    description: 'A serving.',
    owner: 'player',
    abv: 5,
    servingMl: 330,
  },
  {
    id: 'water',
    kind: 'drink',
    name: 'Water',
    description: 'Clear.',
    owner: 'player',
    abv: 0,
    servingMl: 250,
  },
  {
    id: 'spirit',
    kind: 'drink',
    name: 'Spirit',
    description: 'A serving.',
    owner: 'guard',
    abv: 40,
    servingMl: 50,
  },
);
let drinkState = E.createGenerated(drinks, 'Guest');
assert(E.inventory(drinkState).find((i) => i.id === 'beer').consumable);
assert.throws(() => E.act(drinkState, 'consume', 'spirit'), /drink you own/);
drinkState = E.act(drinkState, 'consume', 'beer');
assert(!drinkState.items.some((i) => i.id === 'beer'));
assert.equal(drinkState.sim.people.player.intoxication, 0.825);
assert.throws(() => E.act(drinkState, 'consume', 'beer'), /drink you own/);
drinkState = E.act(drinkState, 'consume', 'water');
assert.equal(drinkState.sim.people.player.intoxication, 0.825);
assert.equal(
  E.validate(JSON.parse(JSON.stringify(drinkState))).sim.people.player.intoxication,
  0.825,
);
const beforeSober = drinkState.sim.people.player.intoxication;
drinkState = E.act(drinkState, 'narrate', '/me waits a moment.');
assert(drinkState.sim.people.player.intoxication < beforeSober);
assert.equal(
  E.context(drinkState, 'Hello', 'guard').simulation.playerDrinkingState,
  'Lightly affected',
);
assert.equal(APSUSoloSimulation.drinkingState(3), 'Drunk');
const invalidDrink = structuredClone(drinks);
invalidDrink.items.find((i) => i.id === 'beer').abv = 101;
assert.throws(() => E.createGenerated(invalidDrink, 'Guest'), /Drinks need/);
console.log(
  'PASS: one-serving drinks, alcohol by volume and serving size, non-alcoholic drinks, ownership, no double consume, sobriety over turns, save persistence and AI context.',
);

const pricedDesign = structuredClone(design);
pricedDesign.items[0].valueMinor = 12500;
let priced = E.createGenerated(pricedDesign, 'Buyer', '');
assert.equal(E.inventory(priced, 'guard').find((i) => i.id === 'pick').valueLabel, '125.00 USD');
assert.equal(
  E.validate(JSON.parse(JSON.stringify(priced))).items.find((i) => i.id === 'pick').valueMinor,
  12500,
);
priced = E.conversation(
  priced,
  'What are your possessions worth?',
  {
    dialogue: 'An estimate.',
    action: 'none',
    memory: '',
    itemValues: [
      { id: 'pick', valueMinor: 999 },
      { id: 'sword', valueMinor: 900 },
    ],
  },
  'guard',
);
assert.equal(
  priced.items.find((i) => i.id === 'pick').valueMinor,
  12500,
  'Existing appraisal unchanged',
);
assert.equal(
  priced.items.find((i) => i.id === 'sword').valueMinor,
  null,
  'Cannot price another owner inventory',
);
console.log(
  'PASS: item values persist, use world currency, and cannot overwrite existing appraisals or another inventory.',
);

let developing = E.createGenerated(design, 'Tester');
const originalGoal = developing.npcs.guard.goal;
const reflection = {
  goal: 'Help the town rebuild trust.',
  reason:
    'Several witnessed acts of help make cooperation more important than guarding the old order.',
};
const reflect = () => {
  developing = E.conversation(
    developing,
    'We helped again.',
    { dialogue: 'I am reconsidering.', action: 'none', memory: '', goalReflection: reflection },
    'guard',
  );
};
reflect();
assert.equal(developing.npcs.guard.goal, originalGoal);
assert(E.validate(JSON.parse(JSON.stringify(developing))).npcs.guard.goalCandidate);
reflect();
reflect();
reflect();
assert.equal(developing.npcs.guard.goal, originalGoal);
reflect();
assert.equal(developing.npcs.guard.goal, reflection.goal);
assert.equal(developing.npcs.guard.goalHistory.length, 1);
assert.equal(developing.npcs.guard.goalCandidate, undefined);
assert.equal(E.validate(JSON.parse(JSON.stringify(developing))).npcs.guard.goalHistory.length, 1);
console.log(
  'PASS: goals require sustained reflection, persist with reasons, and do not flip after one request.',
);

const deepCast = structuredClone(design);
Object.assign(deepCast.characters[0], {
  backstory: 'Raised by a clockmaker, she left the city after her brother vanished.',
  motivations: ['Find her brother', 'Keep her neighbors safe'],
  traits: { warmth: 70, caution: 65, assertiveness: 35, curiosity: 85, discipline: 60 },
  preferences: {
    likes: ['Quiet gardens'],
    dislikes: ['Boasting'],
    values: ['Reciprocity'],
    boundaries: ['No threats to family'],
  },
});
const richWorld = E.validate(JSON.parse(JSON.stringify(E.createGenerated(deepCast, 'Tester'))));
const richActor = E.context(richWorld, 'Hello', 'guard').actor;
assert.equal(richActor.backstory, deepCast.characters[0].backstory);
assert.equal(richActor.traits.curiosity, 85);
assert.deepEqual(richActor.preferences.likes, ['Quiet gardens']);
assert.deepEqual(richActor.motivations, deepCast.characters[0].motivations);
const invalidTraits = structuredClone(deepCast);
invalidTraits.characters[0].traits.warmth = 101;
assert.throws(() => E.createGenerated(invalidTraits, 'Tester'), /Traits/);
console.log(
  'PASS: character depth survives save roundtrips, reaches dialogue context, and validates trait bounds.',
);

// Regression: ordinary legacy labels acquire the actual drink/weapon scripts.
const legacy = structuredClone(design);
legacy.items.push(
  {
    id: 'whiskey',
    kind: 'prop',
    name: 'Whiskey Bottle',
    description: 'Amber whiskey.',
    owner: 'player',
  },
  {
    id: 'pistol',
    kind: 'prop',
    name: 'Service Pistol',
    description: 'A sidearm.',
    owner: 'player',
  },
);
let play = E.createGenerated(legacy, 'Adrian Vale');
assert.equal(play.items.find((i) => i.id === 'whiskey').servings, 16);
play = E.act(play, 'consume', 'whiskey');
assert.equal(play.items.find((i) => i.id === 'whiskey').servings, 15);
assert(play.sim.people.player.intoxication > 0);
const preCombat = structuredClone(play);
play = E.act(play, 'combat', { verb: 'start', target: 'guard' });
play = E.act(play, 'equip', 'pistol');
assert.equal(play.sim.people.player.equipped, 'pistol');
const hp = play.sim.people.player.hp;
play = E.act(play, 'combat', { verb: 'attack' });
assert.equal(play.sim.people.player.hp, hp);
assert.equal(play.sim.combat.phase, 'enemy');
assert(play.messages.some((m) => m.text.includes('Service Pistol') && m.text.includes('roll')));
assert.throws(() => E.act(play, 'combat', { verb: 'attack' }), /opponent respond/);
play = E.validate(JSON.parse(JSON.stringify(play)));
play = E.act(play, 'combat', { verb: 'continue' });
assert.equal(play.sim.combat.phase, 'player');
play.sim.people.player.hp = 0;
play.sim.people.guard.hp = 0;
const inventory = structuredClone(play.items),
  history = play.messages.length;
play = E.act(play, 'respawn');
assert.equal(play.sim.people.player.hp, play.sim.people.player.maxHp);
assert.equal(play.sim.people.guard.hp, preCombat.sim.people.guard.hp);
assert.equal(play.player.room, play.blueprint.start);
assert.deepEqual(play.items, inventory);
assert.deepEqual(play, preCombat);
assert.throws(() => E.act(play, 'respawn'), /already alive/);
assert.deepEqual(E.validate(JSON.parse(JSON.stringify(play))), play);

const socialDesign = structuredClone(design);
socialDesign.characters.push({ ...socialDesign.characters[0], id: 'observer', name: 'Observer' });
let social = E.createGenerated(socialDesign, 'Adrian Vale');
social = E.conversation(
  social,
  "/w Guardian I'm Adrian.",
  {
    dialogue: "I'm Guardian. Welcome.",
    action: 'none',
    memory: '',
    relationshipUpdates: [
      {
        target: 'player',
        trustDelta: 3,
        affectionDelta: 1,
        feelings: 'Curious about this visitor.',
      },
      { target: 'observer', trustDelta: 5, affectionDelta: 5, feelings: 'Must not leak.' },
    ],
  },
  'guard',
);
assert.equal(social.sim.relationships.guard.player.met, true);
assert.equal(social.sim.relationships.guard.player.knowsName, true);
assert.equal(social.sim.relationships.player.guard.knowsName, true);
assert.equal(social.sim.relationships.guard.player.trust, 3);
assert.equal(social.sim.relationships.guard.player.romance, false);
assert.equal(social.sim.relationships.observer.guard, undefined);
assert.equal(social.sim.relationships.guard.observer, undefined);
assert.deepEqual(E.context(social, 'Hello', 'observer').relationships, {});
assert.deepEqual(
  E.validate(JSON.parse(JSON.stringify(social))).sim.relationships,
  social.sim.relationships,
);
social = E.conversation(
  social,
  'Hello',
  {
    dialogue: 'Hello.',
    memory: '',
    action: 'none',
    relationshipUpdates: [
      { target: 'player', trustDelta: 99, affectionDelta: 0, feelings: 'Invalid sudden change.' },
    ],
  },
  'guard',
);
assert.equal(social.sim.relationships.guard.player.trust, 3);
const jobs = structuredClone(design);
jobs.characters[0].description = 'The bartender at House.';
let employed = E.createGenerated(jobs, 'Guest');
assert.equal(employed.blueprint.roles[0].name, 'Bartender');
assert.equal(employed.blueprint.roles[0].scope, 'A Town');
employed.blueprint.roles = [];
assert.equal(E.validate(employed).blueprint.roles.length, 0);
globalThis.window = globalThis;
await import('../js/item-display.js');
assert.equal(APSUItems.iconFor({ kind: 'weapon', template: 'pistol' }), 'pistol');
assert.equal(APSUItems.iconFor({ kind: 'drink', name: 'Whiskey Bottle' }), 'bottle');
assert.equal(APSUItems.iconFor({ kind: 'prop', name: 'Ledger' }), 'book');
console.log(
  'PASS: drink servings, legacy pistol, separate combat turns, respawn, private relationships, scoped roles and item icons.',
);

let npcFight = E.createGenerated(design, 'Challenger');
const beforeNpcFight = structuredClone(npcFight);
npcFight = E.conversation(
  npcFight,
  'Fight me.',
  { dialogue: 'Enough!', memory: 'An enemy now.', action: 'attack' },
  'guard',
);
assert.deepEqual(npcFight.combatCheckpoint, beforeNpcFight);
npcFight.sim.people.player.hp = 0;
npcFight.revision = 42;
const incurred = structuredClone(npcFight.usage);
npcFight = E.act(E.validate(JSON.parse(JSON.stringify(npcFight))), 'respawn');
assert.equal(npcFight.revision, 42);
assert.deepEqual(npcFight.usage, incurred);
assert.deepEqual(npcFight.messages, beforeNpcFight.messages);
assert.deepEqual(npcFight.npcs, beforeNpcFight.npcs);
assert.equal(npcFight.combatCheckpoint, undefined);
let secondFight = E.act(npcFight, 'combat', { verb: 'start', target: 'guard' });
assert.equal(secondFight.combatCheckpoint.combatCheckpoint, undefined);
const malformed = structuredClone(secondFight);
malformed.combatCheckpoint.combatCheckpoint = structuredClone(beforeNpcFight);
assert.throws(() => E.validate(malformed), /cannot contain/);
const legacyDeath = structuredClone(beforeNpcFight);
legacyDeath.sim.people.player.hp = 0;
assert.throws(() => E.act(legacyDeath, 'respawn'), /no pre-combat save/);
console.log(
  'PASS: pre-combat rollback for player/NPC starts, reload persistence, usage and revision preservation, bounded snapshots and older-save handling.',
);

const duplicateDesign = structuredClone(design);
duplicateDesign.characters.push({ ...design.characters[0], id: 'visitor', name: 'Adrian Vale' });
duplicateDesign.items.push({
  id: 'folio',
  kind: 'prop',
  name: 'Folio',
  description: 'Music.',
  owner: 'visitor',
});
const withoutDuplicate = E.createGenerated(duplicateDesign, 'Adrian Vale');
assert(!withoutDuplicate.blueprint.characters.some((c) => c.name === 'Adrian Vale'));
assert.equal(withoutDuplicate.items.find((i) => i.id === 'folio').owner, 'player');

// A guard readies only an actually owned weapon; respawn restores earlier equipment.
{
  const armed = structuredClone(design);
  armed.items.push({
    id: 'guard_gun',
    name: 'Guard sidearm',
    description: 'Issued',
    kind: 'weapon',
    template: 'pistol',
    owner: 'guard',
  });
  const start = E.createGenerated(armed, 'Tester');
  const fight = E.act(start, 'combat', { verb: 'start', target: 'guard' });
  assert.equal(fight.sim.people.guard.equipped, 'guard_gun');
  assert.equal(fight.combatCheckpoint.sim.people.guard.equipped, null);
  assert.equal(E.context(fight, 'Hello', 'guard').simulation.yourEquipment.weapon, 'Guard sidearm');
}

// Learning a first name must not reveal the surname through interface metadata.
{
  let s = E.createGenerated(design, 'Alex Reed');
  assert.equal(E.context(s, 'Hello', 'guard').player.name, 'the visitor');
  assert.equal(E.context(s, "I'm Alex.", 'guard').player.name, 'Alex');
  s = E.conversation(
    s,
    "I'm Alex.",
    { dialogue: 'Hello, Alex.', action: 'none', memory: '' },
    'guard',
  );
  s = E.validate(JSON.parse(JSON.stringify(s)));
  assert.equal(s.sim.relationships.guard.player.learnedName, 'Alex');
  assert.equal(E.context(s, 'Hello again', 'guard').player.name, 'Alex');
  assert.equal(E.context(s, 'My name is Alex Reed.', 'guard').player.name, 'Alex Reed');
  assert.equal(APSUSoloSimulation.introducedName("I'm Alexandra.", 'Alex Reed'), '');
}

{
  const multiple = structuredClone(twoBuildings);
  multiple.rooms.push({
    id: 'tower_side',
    name: 'Tower side entrance',
    description: 'Side door.',
    zone: 'tower',
    locked: false,
    exits: ['hall'],
  });
  multiple.rooms.find((r) => r.id === 'hall').exits.push('tower_side');
  const streets = APSUSoloBlueprint.validate(APSUSoloBlueprint.withStreets(multiple)).rooms.filter(
    (r) => r.id.startsWith('street_'),
  );
  assert.equal(streets.length, 2);
  assert.equal(new Set(streets.map((r) => r.name)).size, 2);
  assert(streets.some((r) => r.name.includes('Tower side entrance')));
}

// Non-lethal outcomes remain scripted, survive reload, and never drop possessions.
let spar = E.createGenerated(design, 'Sparrer');
spar = E.act(spar, 'equip', 'sword');
spar = E.act(spar, 'combat', { verb: 'start', target: 'guard', intent: 'nonlethal' });
const sparStart = structuredClone(spar);
assert.throws(() => E.act(spar, 'combat', { verb: 'intent', intent: 'invalid' }));
for (let n = 0; n < 150 && spar.sim.combat; n++)
  spar = E.act(spar, 'combat', { verb: spar.sim.combat.phase === 'enemy' ? 'continue' : 'attack' });
assert(!spar.sim.combat);
const knocked = spar.sim.people.player.knockedOutUntil ? 'player' : 'guard';
assert(spar.sim.people[knocked].knockedOutUntil);
assert.equal(spar.sim.people[knocked].hp, 1);
assert.equal(spar.items.find((i) => i.id === 'sword').owner, 'player');
assert.equal(spar.items.find((i) => i.id === 'pick').owner, 'guard');
assert.deepEqual(E.validate(JSON.parse(JSON.stringify(spar))), spar);
assert.throws(() => reply(spar, 'none'), /unconscious/i);
if (knocked === 'player') {
  assert.throws(() => E.act(spar, 'move', 'hall'), /unconscious/i);
  spar = E.act(spar, 'recover');
  assert.equal(spar.sim.people.player.knockedOutUntil, 0);
  assert.equal(spar.sim.people.player.hp, 5);
} else {
  for (let n = 0; n < 4; n++) APSUSoloSimulation.advance(spar);
  assert.equal(spar.sim.people.guard.knockedOutUntil, 0);
  assert.equal(spar.sim.people.guard.hp, 5);
}
// NPCs initiate without immediate damage; surrender and truce keep guarded routes.
let initiated = reply(E.createGenerated(design, 'Visitor'), 'block:hall');
const priorHp = initiated.sim.people.player.hp;
initiated = reply(initiated, 'attack:nonlethal');
assert.equal(initiated.sim.combat.phase, 'enemy');
assert.equal(initiated.sim.combat.enemyIntent, 'nonlethal');
assert.equal(initiated.sim.people.player.hp, priorHp);
assert(initiated.combatCheckpoint);
assert.throws(() => E.act(initiated, 'combat', { verb: 'attack' }), /opponent/);
assert.throws(() => E.act(initiated, 'combat', { verb: 'surrender' }), /dialogue/);
const surrendered = E.conversation(
  initiated,
  'I surrender. Please stop.',
  { dialogue: 'All right, step back.', action: 'stand-down', memory: '' },
  'guard',
);
assert(!surrendered.sim.combat);
assert.throws(() => E.act(surrendered, 'move', 'hall'), /blocking/);
const truce = reply(initiated, 'stand-down');
assert(!truce.sim.combat);
assert.throws(() => E.act(truce, 'move', 'hall'), /blocking/);
// Switching intent alone causes no damage; attacking escalates an existing spar.
let escalated = E.act(sparStart, 'combat', { verb: 'intent', intent: 'lethal' });
assert.equal(escalated.sim.combat.enemyIntent, 'nonlethal');
escalated = E.act(escalated, 'combat', { verb: 'attack' });
assert.equal(escalated.sim.combat.enemyIntent, 'lethal');
console.log(
  'PASS: non-lethal knockout, retained possessions, unconscious restrictions/recovery, NPC initiation checkpoint, surrender/truce and intentional escalation.',
);

// Exercise both knockout directions regardless of the randomly initialized encounter seed.
for (const target of ['guard', 'player']) {
  let fight = E.createGenerated(design, 'Recovery');
  fight.sim.people[target].hp = 1;
  fight = E.act(fight, 'combat', { verb: 'start', target: 'guard', intent: 'nonlethal' });
  for (let n = 0; n < 100 && fight.sim.combat; n++) {
    if (target === 'player' && fight.sim.combat.phase !== 'enemy')
      fight = E.act(fight, 'combat', { verb: 'defend' });
    else
      fight = E.act(fight, 'combat', {
        verb: fight.sim.combat.phase === 'enemy' ? 'continue' : 'attack',
      });
  }
  assert(fight.sim.people[target].knockedOutUntil);
  assert.equal(fight.sim.people[target].hp, 1);
  if (target === 'player') {
    fight = E.act(fight, 'recover');
    assert.equal(fight.sim.people.player.hp, 5);
    assert.equal(fight.sim.people.player.knockedOutUntil, 0);
  }
}
// A post-combat reaction cannot immediately undo surrender by opening a fresh fight.
assert.throws(() =>
  E.conversation(
    surrendered,
    'React to surrender.',
    { dialogue: 'No.', action: 'attack', memory: '' },
    'guard',
    { trigger: 'combat', replyOnly: true },
  ),
);

// Rentals are atomic: a quote alone grants nothing; acceptance pays and issues a working key.
let tenant = E.createGenerated(design, 'Tenant');
tenant = E.act(tenant, 'rental-offer', { room: 'vault', landlord: 'guard', price: 500 });
assert.equal(tenant.sim.housing.vault.tenant, null);
assert(!tenant.items.some((i) => i.owner === 'player' && i.kind === 'key'));
const rentText = 'I pay you five dollars for the vault room.';
tenant = E.conversation(
  tenant,
  rentText,
  {
    dialogue: 'Here is your room key.',
    action: 'none',
    memory: 'Rented the room.',
    payment: { recipient: 'guard', amountMinor: 500, room: 'vault', evidence: rentText },
  },
  'guard',
);
assert.equal(tenant.sim.people.player.money, 1500);
assert.equal(tenant.sim.people.guard.money, 2500);
assert.equal(tenant.sim.housing.vault.tenant, 'player');
assert.equal(
  tenant.items.filter((i) => i.owner === 'player' && i.kind === 'key' && i.opens === 'vault')
    .length,
  1,
);
assert.deepEqual(E.validate(JSON.parse(JSON.stringify(tenant))), tenant);
assert.throws(() => E.act(tenant, 'rent', { room: 'vault' }), /available rental/);
assert.throws(
  () => E.act(tenant, 'rental-offer', { room: 'vault', landlord: 'guard', price: 1 }),
  /already rented/,
);
tenant = E.act(tenant, 'move', 'hall');
tenant = E.act(tenant, 'key-door', { room: 'vault' });
assert.equal(tenant.doors.vault, false);
tenant = E.act(tenant, 'move', 'square');
const beforeInvalid = structuredClone(tenant);
const impossible = 'I give you a million dollars.';
const denied = E.conversation(
  tenant,
  impossible,
  {
    dialogue: 'Thank you.',
    action: 'attack',
    memory: 'They paid me a million.',
    relationshipUpdates: [
      { target: 'player', trustDelta: 5, affectionDelta: 5, feelings: 'Very generous.' },
    ],
    payment: { recipient: 'guard', amountMinor: 100000000, room: null, evidence: impossible },
    usage: { input: 10, output: 20 },
  },
  'guard',
);
assert.equal(denied.messages.length, beforeInvalid.messages.length + 1);
assert(denied.messages.at(-1).voidedTurn);
assert.match(denied.messages.at(-1).text, /Powergaming/);
assert.deepEqual(denied.messages.at(-1).witnesses, []);
assert.deepEqual(denied.sim, beforeInvalid.sim);
assert.deepEqual(denied.npcs, beforeInvalid.npcs);
assert(!E.context(denied, 'Hello', 'guard').recent.some((m) => m.voidedTurn));
assert.equal(denied.usage.input, beforeInvalid.usage.input + 10);
const gift = '*Tenant hands you ten dollars.*';
const paid = E.conversation(
  tenant,
  gift,
  {
    dialogue: 'Thanks.',
    action: 'none',
    memory: 'A gift.',
    payment: { recipient: 'guard', amountMinor: 1000, room: null, evidence: gift },
  },
  'guard',
);
assert.equal(paid.sim.people.player.money, 500);
assert.equal(paid.sim.people.guard.money, 3500);
const followup = E.conversation(
  paid,
  gift,
  {
    dialogue: 'Still thanks.',
    action: 'none',
    memory: 'A gift.',
    payment: { recipient: 'guard', amountMinor: 1000, room: null, evidence: gift },
  },
  'guard',
  { replyOnly: true },
);
assert.equal(followup.sim.people.player.money, 500);
assert.equal(followup.sim.people.guard.money, 3500);
const quoted = E.conversation(
  tenant,
  'Would you accept ten dollars?',
  { dialogue: 'Yes.', action: 'none', memory: '', payment: null },
  'guard',
);
assert.equal(quoted.sim.people.player.money, tenant.sim.people.player.money);
assert.throws(
  () => APSUSoloSimulation.offerRental(tenant, 'guard', { room: 'hall', price: 500 }),
  /authority/,
);
console.log(
  'PASS: rental quote/acceptance, real keys, tenancy persistence, duplicate/unauthorized rentals, contextual payments, and voided over-budget turns without NPC memory, relationships or actions.',
);

// The reported tip works even if the model omits its structured payment proposal.
const tipWorld = E.createGenerated(design, 'Adrian Vale');
const tipLine =
  "Thank you, darling. I'll take a bourbon on the rocks. Here's a tip, though. Adrian gives Guardian 10 dollars";
const detected = APSUSoloSimulation.explicitPayment(tipWorld, tipLine, 'guard');
assert.equal(detected.amountMinor, 1000);
const tipped = E.conversation(
  tipWorld,
  tipLine,
  { dialogue: 'Thanks.', action: 'none', memory: 'A tip.', payment: null },
  'guard',
);
assert.equal(tipped.sim.people.player.money, 1000);
assert.equal(tipped.sim.people.guard.money, 3000);
assert.equal(
  APSUSoloSimulation.explicitPayment(tipWorld, '/me gives Guardian 10 dollars', 'guard')
    .amountMinor,
  1000,
);
for (const phrase of [
  'If I give you 10 dollars, will you help?',
  'I give you 10 dollars?',
  'She said "I give you 10 dollars".',
  'I will give you 10 dollars.',
])
  assert.equal(APSUSoloSimulation.explicitPayment(tipWorld, phrase, 'guard'), null);
const huge = E.conversation(
  tipWorld,
  'Adrian gives Guardian 500 dollars',
  { dialogue: 'Thanks.', action: 'none', memory: 'Paid.', payment: null },
  'guard',
);
assert(huge.messages.at(-1).voidedTurn);
assert.equal(huge.npcs.guard.memory, '');
// Calls for help travel over real exits and survive a save/reload mid-approach.
const assistanceDesign = structuredClone(design);
assistanceDesign.characters.push({
  id: 'helper',
  name: 'Miles',
  description: 'A security attendant.',
  personality: 'Protective.',
  goal: 'Protect staff.',
  room: 'vault',
});
let assisted = E.createGenerated(assistanceDesign, 'Guest');
assisted = E.act(assisted, 'combat', { verb: 'start', target: 'guard', intent: 'nonlethal' });
assert(E.choices(assisted, 'guard').some((a) => a.id === 'call-help:helper'));
assisted = E.conversation(
  assisted,
  'No.',
  { dialogue: 'Miles, help!', action: 'call-help:helper', memory: '' },
  'guard',
);
assert.equal(assisted.npcs.helper.room, 'hall');
assert.equal(assisted.sim.combat.enemy, 'guard');
assisted = E.validate(JSON.parse(JSON.stringify(assisted)));
assisted = E.act(assisted, 'combat', { verb: 'exchange', tactic: 'defend' });
assert.equal(assisted.npcs.helper.room, 'square');
assert.equal(assisted.sim.combat.enemy, 'helper');
assert.equal(assisted.sim.combat.phase, 'player');
assert(!assisted.sim.combat.assistance);
assert(!assisted.items.some((i) => i.owner === 'helper' && i.kind === 'weapon'));
const deniedHelp = E.createGenerated(assistanceDesign, 'Guest');
deniedHelp.sim.combat = {
  enemy: 'guard',
  round: 1,
  phase: 'player',
  playerIntent: 'nonlethal',
  enemyIntent: 'nonlethal',
};
deniedHelp.doors.hall = true;
assert(
  !APSUSoloSimulation.helpChoices(deniedHelp, 'guard').some((a) => a.id === 'call-help:helper'),
);
console.log(
  'PASS: omitted-model tip repaired locally, ambiguous/hypothetical payments ignored, impossible tip voided, reachable help moves/intervenes across reload and locked routes deny help.',
);

let shouted = E.createGenerated(assistanceDesign, 'Guest');
shouted = E.act(shouted, 'combat', { verb: 'start', target: 'guard', intent: 'nonlethal' });
assert.equal(
  APSUSoloSimulation.spokenHelp(shouted, 'guard', 'I would call for Miles if things got worse.'),
  null,
);
shouted = E.conversation(
  shouted,
  'No.',
  {
    dialogue: '*Guardian calls for Miles.* Miles, get in here! I need help!',
    action: 'none',
    memory: '',
  },
  'guard',
);
assert.equal(shouted.sim.combat.assistance.actor, 'helper');
assert.equal(shouted.npcs.helper.room, 'hall');
