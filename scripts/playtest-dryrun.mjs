// Print one rollback-only transaction for the Supabase SQL Editor. Does not connect.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../supabase/', import.meta.url);

const read = (name) => fs.readFileSync(fileURLToPath(new URL(name, root)), 'utf8');

const migrations = ['playtest-chat.sql', 'playtest-worlds.sql', 'stability-fixes.sql'].map((name) =>
  read(name)
    .replace(/^begin;\s*$/im, '')
    .replace(/^commit;\s*$/im, ''),
);
const checks = read('playtest-test.sql').replace(/^begin;\s*$/im, '');
const sql = 'begin;\n' + migrations.join('\n') + '\n' + checks;

if (/^commit\s*;/im.test(sql) || !/^rollback;/im.test(sql)) throw Error('Rollback guard failed');

process.stdout.write(sql);
