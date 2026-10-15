// Copy only browser-facing files; database scripts and backups stay private.
import { mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const entry of await readdir(root)) {
  if (entry.endsWith('.html')) await copyFile(resolve(root, entry), resolve(out, entry));
}
for (const [directory, suffix] of [
  ['js', '.js'],
  ['css', '.css'],
  ['assets', '.svg'],
]) {
  await mkdir(resolve(out, directory));
  for (const entry of await readdir(resolve(root, directory))) {
    if (entry.endsWith(suffix))
      await copyFile(resolve(root, directory, entry), resolve(out, directory, entry));
  }
}

await mkdir(resolve(out, 'fonts'));
for (const name of await readdir(resolve(root, 'fonts'))) {
  if (/\.(woff2|txt)$/.test(name))
    await copyFile(resolve(root, 'fonts', name), resolve(out, 'fonts', name));
}
for (const name of ['_headers', '_redirects'])
  await copyFile(resolve(root, name), resolve(out, name));

console.log(
  'Built dist with HTML, JavaScript, CSS, self-hosted fonts, headers, and redirects only.',
);
