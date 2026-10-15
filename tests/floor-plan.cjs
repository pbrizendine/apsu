const assert = require('node:assert/strict'),
  vm = require('node:vm'),
  fs = require('node:fs');
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync('js/world-map.js', 'utf8'), ctx);
const rooms = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => ['r' + i, { name: 'Room ' + i, exits: [] }]),
);
for (const [a, b] of [
  [0, 1],
  [1, 2],
  [0, 3],
  [3, 4],
  [4, 5],
  [3, 6],
  [3, 7],
  [6, 9],
  [9, 10],
  [10, 11],
  [9, 8],
  [8, 2],
]) {
  rooms['r' + a].exits.push('r' + b);
  rooms['r' + b].exits.push('r' + a);
}
const original = JSON.stringify(rooms),
  plan = ctx.floorPlanLayout(rooms, 'r0');
assert.equal(JSON.stringify(rooms), original);
assert.equal(new Set(Object.values(plan.nodes).map((n) => n.x + ',' + n.y)).size, 12);
assert.equal(plan.edges.length, 12);
for (const edge of plan.edges) {
  assert(edge.points.length > 1);
  assert(rooms[edge.from].exits.includes(edge.to));
  for (const [x, y] of edge.points)
    for (const [id, node] of Object.entries(plan.nodes)) {
      if (id === edge.from || id === edge.to) continue;
      assert(
        !(Math.abs(x - node.cx) <= 4 && Math.abs(y - node.cy) <= 3),
        'Passage crosses another room',
      );
    }
}
assert.equal(JSON.stringify(ctx.floorPlanLayout(rooms, 'r0')), JSON.stringify(plan));
console.log(
  'PASS: spatial map has unique room footprints, real passages only, deterministic layout and routes avoiding unrelated rooms.',
);
