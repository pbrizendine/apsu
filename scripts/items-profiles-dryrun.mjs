import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = fs
  .readFileSync(path.join(root, 'supabase/items-profiles.sql'), 'utf8')
  .replace(/^begin;$/m, '')
  .replace(/^commit;$/m, '');
const test = fs
  .readFileSync(path.join(root, 'supabase/items-profiles-test.sql'), 'utf8')
  .replace(/^begin;$/m, '');
process.stdout.write('begin;\n' + migration + '\n' + test);
