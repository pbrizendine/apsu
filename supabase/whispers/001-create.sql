-- Run once after the existing chat and shared-world migrations.
begin;
-- Stable numbers per room. Never recycle a number for another character.
create table public.room_chat_numbers (
 world_id text not null references public.worlds(id), room_id text not null,
 character_id uuid not null references public.characters(id), number integer not null check(number>0),
 primary key(world_id,room_id,character_id), unique(world_id,room_id,number)
);
create table public.room_chat_counters (
 world_id text not null references public.worlds(id), room_id text not null,
 last_number integer not null default 0, primary key(world_id,room_id)
);
create table public.whisper_notices (
 world_id text not null references public.worlds(id), room_id text not null,
 first_character uuid not null references public.characters(id), second_character uuid not null references public.characters(id),
 last_notice timestamptz not null, primary key(world_id,room_id,first_character,second_character)
);
alter table public.room_chat_numbers enable row level security;
alter table public.room_chat_counters enable row level security;
alter table public.whisper_notices enable row level security;
revoke all on public.room_chat_numbers,public.room_chat_counters,public.whisper_notices from public,anon,authenticated;
-- Existing visitors receive numbers in order of their first recorded visit.
insert into public.room_chat_numbers
select world_id,room_id,character_id,row_number() over(partition by world_id,room_id order by min(started_at),character_id)::integer
from public.chat_visits group by world_id,room_id,character_id;
insert into public.room_chat_counters select world_id,room_id,max(number) from public.room_chat_numbers group by world_id,room_id;
create function public.assign_room_chat_number() returns trigger language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 insert into public.room_chat_counters(world_id,room_id) values(new.world_id,new.room_id) on conflict do nothing;
 perform 1 from public.room_chat_counters where world_id=new.world_id and room_id=new.room_id for update;
 if not exists(select 1 from public.room_chat_numbers where world_id=new.world_id and room_id=new.room_id and character_id=new.character_id) then
  update public.room_chat_counters set last_number=last_number+1 where world_id=new.world_id and room_id=new.room_id returning last_number into n;
  insert into public.room_chat_numbers values(new.world_id,new.room_id,new.character_id,n);
 end if;
 return new;
end $$;
create trigger assign_room_number after insert on public.chat_visits for each row execute function public.assign_room_chat_number();
alter table public.room_messages
 add column message_type text not null default 'chat' check(message_type in ('chat','whisper','whisper_notice')),
 add column sender_number integer,
 add column recipient_character uuid references public.characters(id),
 add column source_visit uuid;
create function public.stamp_room_chat_number() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.chat_kind='ic' and new.message_type<>'whisper_notice' then
  select number into new.sender_number from public.room_chat_numbers where world_id=new.world_id and room_id=new.room_id and character_id=new.character_id;
 end if;
 return new;
end $$;
create trigger stamp_room_number before insert on public.room_messages for each row execute function public.stamp_room_chat_number();
create or replace function public.room_snapshot(p_character uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.characters; result jsonb;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid() and world_id='alska-mogue';
 if not found then raise exception 'Character unavailable'; end if;
 select jsonb_build_object('room_id',c.room_id,'locked',d.locked,'characters',coalesce((
 select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'number',n.number) order by n.number,x.id)
 from public.characters x join public.room_chat_numbers n on n.character_id=x.id and n.world_id=x.world_id and n.room_id=x.room_id
 where x.world_id=c.world_id and x.room_id=c.room_id and exists(select 1 from public.chat_visits v where v.character_id=x.id and v.room_id=x.room_id and v.active and v.seen_at>now()-interval '60 seconds')
 ),'[]'::jsonb)) into result from public.world_doors d where d.world_id=c.world_id and d.door_id='roomC';
 return result;
end $$;
create function public.send_room_whisper(p_id uuid,p_visit uuid,p_target integer,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare v public.chat_visits; sender public.characters; recipient public.characters;
 target_id uuid; audience uuid[]; observers uuid[]; existing public.room_messages; should_notice boolean;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if p_id is null or p_target is null or p_target<1 or p_body is null or char_length(btrim(p_body)) not between 1 and 500 or p_body ~ E'[\n\r]' then raise exception 'Use /w ID message (up to 500 characters)'; end if;
 select * into v from public.chat_visits where id=p_visit and player_id=auth.uid();
 if not found then raise exception 'Chat visit expired'; end if;
 select character_id into target_id from public.room_chat_numbers where world_id=v.world_id and room_id=v.room_id and number=p_target;
 if target_id is null then raise exception 'That character is not in this room'; end if;
 if target_id=v.character_id then raise exception 'Choose another character to whisper to'; end if;
 -- Use consistent character lock order; movement takes the same character lock.
 perform id from public.characters where id in(v.character_id,target_id) order by id for update;
 -- Idempotent retry: no duplicate private text or public notice.
 select * into existing from public.room_messages where id=p_id;
 if found then
  if existing.message_type='whisper' and existing.source_visit=p_visit and existing.character_id=v.character_id and existing.recipient_character=target_id and existing.body=btrim(p_body) then return p_id; end if;
  raise exception 'Message identifier already used';
 end if;
 select * into v from public.chat_visits where id=p_visit and player_id=auth.uid() and active and seen_at>clock_timestamp()-interval '60 seconds';
 if not found then raise exception 'Chat visit expired'; end if;
 select * into sender from public.characters where id=v.character_id and player_id=auth.uid() and world_id=v.world_id and room_id=v.room_id;
 if not found then raise exception 'Your location changed. Reconnect chat'; end if;
 select * into recipient from public.characters where id=target_id and world_id=v.world_id and room_id=v.room_id;
 if not found then raise exception 'That character is not in this room'; end if;
 select array_agg(id) into audience from public.chat_visits where character_id=target_id and world_id=v.world_id and room_id=v.room_id and active and seen_at>clock_timestamp()-interval '60 seconds';
 if audience is null then raise exception 'That character is no longer connected in this room'; end if;
 -- Only the recipient's visits are addressed. Existing witnessed-message RLS
 -- protects live delivery, direct queries, and the 24-hour IC download alike.
 insert into public.room_messages(id,world_id,room_id,character_id,character_name,body,created_at,visit_ids,chat_kind,message_type,recipient_character,source_visit)
 values(p_id,v.world_id,v.room_id,sender.id,sender.name,btrim(p_body),clock_timestamp(),audience,'ic','whisper',target_id,p_visit);
 insert into public.whisper_notices values(v.world_id,v.room_id,least(sender.id,target_id),greatest(sender.id,target_id),clock_timestamp())
 on conflict(world_id,room_id,first_character,second_character) do update set last_notice=excluded.last_notice
 where public.whisper_notices.last_notice<=clock_timestamp()-interval '1 minute';
 should_notice:=found;
 if should_notice then
  select array_agg(id) into observers from public.chat_visits where world_id=v.world_id and room_id=v.room_id and character_id not in(sender.id,target_id) and active and seen_at>clock_timestamp()-interval '60 seconds';
  if observers is not null then
   insert into public.room_messages(id,world_id,room_id,character_id,character_name,body,created_at,visit_ids,chat_kind,message_type)
   values(gen_random_uuid(),v.world_id,v.room_id,sender.id,'System · Room',sender.name||' and '||recipient.name||' are whispering to one another.',clock_timestamp(),observers,'ic','whisper_notice');
  end if;
 end if;
 return p_id;
end $$;
revoke all on function public.assign_room_chat_number(),public.stamp_room_chat_number(),public.send_room_whisper(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.send_room_whisper(uuid,uuid,integer,text) to authenticated;
commit;
