begin;
create table public.chat_visits (
 id uuid primary key, player_id uuid not null references auth.users(id),
 character_id uuid not null references public.characters(id), world_id text not null,
 room_id text not null check(room_id in ('roomA','roomB','roomC')),
 started_at timestamptz not null default clock_timestamp(),
 seen_at timestamptz not null default clock_timestamp(), active boolean not null default true
);
alter table public.chat_visits enable row level security;
revoke all on public.chat_visits from anon,authenticated;
grant select on public.chat_visits to authenticated;
create policy "Own chat visits" on public.chat_visits for select to authenticated using(player_id=auth.uid());
alter table public.room_messages add column visit_ids uuid[] not null default '{}';
alter table public.room_messages add constraint message_500_chars check(char_length(body)<=500) not valid;
drop policy "World players read room history" on public.room_messages;
create policy "Only witnessed messages" on public.room_messages for select to authenticated using(
 created_at>now()-interval '24 hours' and exists(select 1 from public.chat_visits v where v.player_id=auth.uid() and v.id=any(visit_ids))
);
create function public.enter_chat(p_visit uuid,p_character uuid,p_room text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.characters;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid();
 if not found or c.world_id<>'alska-mogue' or p_visit is null or p_room is null or p_room not in ('roomA','roomB','roomC') then raise exception 'Invalid chat visit'; end if;
 insert into public.chat_visits(id,player_id,character_id,world_id,room_id) values(p_visit,auth.uid(),c.id,c.world_id,p_room);
 return p_visit;
end $$;
create function public.touch_chat(p_visit uuid,p_leave boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.chat_visits set seen_at=clock_timestamp(),active=not p_leave where id=p_visit and player_id=auth.uid() and active and seen_at>clock_timestamp()-interval '60 seconds';
 return found;
end $$;
-- Replace the old send endpoint so clients cannot bypass the active visit.
revoke execute on function public.send_room_message(uuid,uuid,text,text) from authenticated;
create function public.send_visit_message(p_id uuid,p_visit uuid,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare v public.chat_visits; c public.characters; existing public.room_messages; audience uuid[];
begin
 select * into v from public.chat_visits where id=p_visit and player_id=auth.uid() and active and seen_at>clock_timestamp()-interval '60 seconds' for update;
 if not found then raise exception 'Chat visit expired'; end if;
 if p_id is null or p_body is null or char_length(btrim(p_body)) not between 1 and 500 or p_body ~ E'[\n\r]' then raise exception 'Use 1 to 500 characters on one line'; end if;
 select * into c from public.characters where id=v.character_id;
 select array_agg(id) into audience from public.chat_visits where world_id=v.world_id and room_id=v.room_id and active and seen_at>clock_timestamp()-interval '60 seconds';
 insert into public.room_messages(id,world_id,room_id,character_id,character_name,body,created_at,visit_ids)
 values(p_id,v.world_id,v.room_id,c.id,c.name,btrim(p_body),clock_timestamp(),audience) on conflict(id) do nothing;
 select * into existing from public.room_messages where id=p_id;
 if existing.character_id<>c.id or existing.room_id<>v.room_id or existing.body<>btrim(p_body) or not(p_visit=any(existing.visit_ids)) then raise exception 'Message identifier already used'; end if;
 return p_id;
end $$;
revoke all on function public.enter_chat(uuid,uuid,text),public.touch_chat(uuid,boolean),public.send_visit_message(uuid,uuid,text) from public,anon;
grant execute on function public.enter_chat(uuid,uuid,text),public.touch_chat(uuid,boolean),public.send_visit_message(uuid,uuid,text) to authenticated;
-- Expired messages are immediately unreadable via RLS; cleanup runs every minute.
create extension if not exists pg_cron;
select cron.schedule('expire-room-chat','* * * * *',$job$
 delete from public.room_messages where created_at<=now()-interval '24 hours';
 delete from public.chat_visits v where seen_at<=now()-interval '24 hours' and not exists(select 1 from public.room_messages m where v.id=any(m.visit_ids));
$job$);
commit;
