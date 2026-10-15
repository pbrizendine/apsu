begin;
create table public.room_messages (
 id uuid primary key,
 world_id text not null references public.worlds(id),
 room_id text not null check (room_id in ('roomA','roomB','roomC')),
 character_id uuid not null references public.characters(id),
 character_name text not null,
 body text not null check (char_length(btrim(body)) between 1 and 2000),
 created_at timestamptz not null default now()
);
create index room_messages_history on public.room_messages(world_id,room_id,created_at desc,id desc);
alter table public.room_messages enable row level security;
revoke all on public.room_messages from anon,authenticated;
grant select on public.room_messages to authenticated;
create policy "World players read room history" on public.room_messages for select to authenticated
using (exists(select 1 from public.characters c where c.player_id=(select auth.uid()) and c.world_id=room_messages.world_id));
-- Identity comes from the owned character. Room location remains client-controlled for this prototype.
create function public.send_room_message(p_id uuid,p_character uuid,p_room text,p_body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.characters; existing public.room_messages;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid();
 if not found or c.world_id<>'alska-mogue' then raise exception 'Character not available'; end if;
 if p_id is null or p_room is null or p_room not in ('roomA','roomB','roomC') or p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then raise exception 'Invalid message'; end if;
 insert into public.room_messages(id,world_id,room_id,character_id,character_name,body)
 values(p_id,c.world_id,p_room,c.id,c.name,btrim(p_body)) on conflict(id) do nothing;
 select * into existing from public.room_messages where id=p_id;
 if existing.character_id<>c.id or existing.room_id<>p_room or existing.body<>btrim(p_body) then raise exception 'Message identifier already used'; end if;
 return p_id;
end $$;
revoke all on function public.send_room_message(uuid,uuid,text,text) from public,anon;
grant execute on function public.send_room_message(uuid,uuid,text,text) to authenticated;
alter publication supabase_realtime add table public.room_messages;
commit;
