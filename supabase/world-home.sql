-- Run once after worlds.sql. All changes commit together.
begin;
alter table public.worlds
  add column description text not null default '',
  add column image_urls text[] not null default '{}';
update public.worlds set description = 'Welcome to Alska Mogue. Explore the world and create your character.'
where id = 'alska-mogue';

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id),
  world_id text not null references public.worlds(id),
  slot smallint not null check (slot between 1 and 3),
  name text not null check (length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (player_id, world_id, slot)
);
-- Three numbered slots enforce the cap even when two tabs submit together.
alter table public.characters enable row level security;
revoke all on public.characters from anon, authenticated;
grant select, insert on public.characters to authenticated;
create policy "Players read their own characters"
  on public.characters for select to authenticated
  using ((select auth.uid()) = player_id);
create policy "Players create their own characters"
  on public.characters for insert to authenticated
  with check ((select auth.uid()) = player_id);
commit;
