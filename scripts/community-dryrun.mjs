import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

if (!process.env.APSU_PGLITE_PATH)
  throw Error('Set APSU_PGLITE_PATH to a local @electric-sql/pglite dist/index.js');

const { PGlite } = await import(pathToFileURL(process.env.APSU_PGLITE_PATH));
import fs from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../supabase') + '/';
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage; create schema cron;
create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb default '{}',created_at timestamptz default clock_timestamp());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth,public to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,created_at timestamptz default now(),unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select,insert,update,delete on storage.objects to authenticated;
create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text,active boolean default true);
create function cron.schedule(text,text,text) returns bigint language plpgsql as $$ declare n bigint; begin insert into cron.job(jobname,schedule,command) values($1,$2,$3) on conflict(jobname) do update set command=excluded.command returning jobid into n; return n;end $$;
create publication supabase_realtime;
insert into auth.users(email,raw_user_meta_data) values('founder@apsu.invalid','{"username":"Fixture founder"}');
`);
const files = [
  'worlds',
  'world-home',
  'items',
  'multiple-picks',
  'character-location',
  'lock-use',
  'room-chat',
  'chat-visits',
  'connected-players',
  'world-ooc',
  'ooc-character',
  'shared-world',
  'inside-unlock',
  'whispers/001-create',
  'whispers/002-sender-visibility',
  'room-commands',
  'public-profile',
  'profiles-map',
  'player-photos',
  'admin',
  'script-items',
  'inventory-map',
  'quantities-doors',
  'prealpha-reliability',
  'create-rooms',
  'playtest-chat',
  'playtest-worlds',
  'stability-fixes',
  'items-profiles',
  'kick-rejoin',
  'privacy-accounts',
  'community',
  'age-world-guards',
];

for (const file of files) {
  let sql = await fs.readFile(root + file + '.sql', 'utf8');
  sql = sql
    .replace(/create extension if not exists pg_cron;/gi, '')
    .replaceAll('owner@example.invalid', 'founder@apsu.invalid');
  try {
    await db.exec(sql);
    console.log('OK', file);
  } catch (e) {
    console.error('FAIL', file, e.message, e.detail || '', e.where || '');
    await db.close();
    process.exit(1);
  }
}

{
  try {
    await db.exec(await fs.readFile(root + 'community-test.sql', 'utf8'));
    console.log('PASS: community and age permission tests');
  } catch (e) {
    console.error('TEST FAIL', e.message, e.detail || '', e.where || '');
    await db.close();
    process.exit(1);
  }
}
console.log(
  'PASS: full local migration sequence (auth/storage/cron adapters; no live database connection)',
);
await db.close();
