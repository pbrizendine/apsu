import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

for (const name of fs.readdirSync(path.join(root, 'js'))) {
  if (!name.endsWith('.js')) continue;
  try {
    new vm.Script(fs.readFileSync(path.join(root, 'js', name), 'utf8'), { filename: name });
  } catch (error) {
    console.error(error.message);
    failures++;
  }
}
for (const name of fs.readdirSync(root).filter((n) => n.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');

  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const value = match[1];

    if (/^(?:[a-z]+:|#|\/\/)/i.test(value)) continue;

    const target = decodeURIComponent(value.split(/[?#]/)[0]);

    if (target && !fs.existsSync(path.resolve(root, target))) {
      console.error(`${name}: missing ${target}`);
      failures++;
    }
  }
}
// Parse every server/tool module, including helpers not imported by a fixture.
for (const directory of ['worker', 'scripts']) {
  for (const name of fs.readdirSync(path.join(root, directory))) {
    if (!name.endsWith('.mjs')) continue;

    const check = spawnSync(process.execPath, ['--check', path.join(root, directory, name)], {
      stdio: 'inherit',
    });

    if (check.status !== 0) failures++;
  }
}
for (const test of [
  'public-config.cjs',
  'whispers-ui.cjs',
  'whispers-logs.cjs',
  'reliability.cjs',
  'chat-delivery.cjs',
  'stability.cjs',
  'items-profiles.cjs',
  'theme-world.cjs',
  'moderation.cjs',
  'community.cjs',
  'attention.cjs',
  'imagine.mjs',
  'solo.mjs',
  'solo-connection.cjs',
  'solo-agency.mjs',
  'solo-worlds.mjs',
  'solo-generation.mjs',
  'solo-living.mjs',
  'solo-delivery.cjs',
  'solo-turns.cjs',
  'solo-gallery.cjs',
  'floor-plan.cjs',
]) {
  const run = spawnSync(process.execPath, [path.join(root, 'tests', test)], { stdio: 'inherit' });

  if (run.status !== 0) failures++;
}
if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exitCode = 1;
} else console.log('PASS: JavaScript syntax, local page references, and chat regression checks.');
