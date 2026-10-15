-- Run once in this project's Supabase SQL Editor.
-- This transaction fails safely if a worlds table already exists.
begin;

create table public.worlds (
  id text primary key,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

alter table public.worlds enable row level security;
-- Players can discover worlds, but cannot create, rename, or delete them.
revoke all on table public.worlds from anon, authenticated;
grant select on table public.worlds to authenticated;
create policy "Signed-in players can view worlds"
  on public.worlds for select to authenticated using (true);

insert into public.worlds (id, name)
values ('alska-mogue', 'Alska Mogue');

commit;
