-- Run once after whispers.sql. Retains the existing private-message policy.
begin;
alter table public.room_messages add column if not exists recipient_name text,
 add column if not exists recipient_number integer;
-- Restore sender access to unexpired whispers already sent, using their original visit.
update public.room_messages m set visit_ids=array_append(m.visit_ids,m.source_visit)
where m.message_type='whisper' and m.created_at>now()-interval '24 hours'
 and m.source_visit is not null and not(m.source_visit=any(m.visit_ids))
 and exists(select 1 from public.chat_visits v where v.id=m.source_visit and v.character_id=m.character_id);
update public.room_messages m set recipient_name=c.name,recipient_number=n.number
from public.characters c, public.room_chat_numbers n
where m.message_type='whisper' and m.recipient_name is null and c.id=m.recipient_character
 and n.character_id=c.id and n.world_id=m.world_id and n.room_id=m.room_id;
create or replace function public.send_room_whisper(p_id uuid,p_visit uuid,p_target integer,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
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
 audience := array_append(audience, p_visit);
 -- Both participants can read the message. Existing witnessed-message RLS
 -- protects live delivery, direct queries, and the 24-hour IC download alike.
 insert into public.room_messages(id,world_id,room_id,character_id,character_name,body,created_at,visit_ids,chat_kind,message_type,recipient_character,source_visit,recipient_name,recipient_number)
 values(p_id,v.world_id,v.room_id,sender.id,sender.name,btrim(p_body),clock_timestamp(),audience,'ic','whisper',target_id,p_visit,recipient.name,p_target);
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
commit;
