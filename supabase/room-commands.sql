begin;
alter table public.room_messages drop constraint room_messages_message_type_check;
alter table public.room_messages add constraint room_messages_message_type_check
 check(message_type in ('chat','whisper','whisper_notice','directed','action','description'));
-- Disable the prototype supply endpoint as well as hiding its buttons.
revoke execute on function public.pickup_item(uuid,text) from public,anon,authenticated;
create function public.send_room_command(p_id uuid,p_visit uuid,p_body text,p_kind text,p_target integer default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.chat_visits; sender public.characters; recipient public.characters;
 target_id uuid; audience uuid[]; existing public.room_messages;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if p_kind is null or p_kind not in ('directed','action','description') or p_id is null or p_body is null
 or char_length(btrim(p_body)) not between 1 and 500 or p_body ~ E'[\n\r]' then raise exception 'Use 1 to 500 characters on one line'; end if;
 if (p_kind='directed' and (p_target is null or p_target<1)) or (p_kind<>'directed' and p_target is not null) then raise exception 'Invalid character target'; end if;
 select * into v from public.chat_visits where id=p_visit and player_id=auth.uid();
 if not found then raise exception 'Chat visit expired'; end if;
 if p_kind='directed' then
  select character_id into target_id from public.room_chat_numbers where world_id=v.world_id and room_id=v.room_id and number=p_target;
  if target_id is null then raise exception 'That character is not in this room'; end if;
 end if;
 perform id from public.characters where id=v.character_id or id=target_id order by id for update;
 select * into existing from public.room_messages where id=p_id;
 if found then
  if existing.message_type=p_kind and existing.source_visit=p_visit and existing.character_id=v.character_id
   and existing.recipient_character is not distinct from target_id and existing.body=btrim(p_body) then return p_id; end if;
  raise exception 'Message identifier already used';
 end if;
 select * into v from public.chat_visits where id=p_visit and player_id=auth.uid() and active and seen_at>clock_timestamp()-interval '60 seconds';
 if not found then raise exception 'Chat visit expired'; end if;
 select * into sender from public.characters where id=v.character_id and player_id=auth.uid() and world_id=v.world_id and room_id=v.room_id;
 if not found then raise exception 'Your location changed. Reconnect chat'; end if;
 if target_id is not null then
  select * into recipient from public.characters where id=target_id and world_id=v.world_id and room_id=v.room_id;
  if not found or not exists(select 1 from public.chat_visits where character_id=target_id and world_id=v.world_id and room_id=v.room_id and active and seen_at>clock_timestamp()-interval '60 seconds') then raise exception 'That character is not connected in this room'; end if;
 end if;
 select array_agg(id) into audience from public.chat_visits where world_id=v.world_id and room_id=v.room_id and active and seen_at>clock_timestamp()-interval '60 seconds';
 insert into public.room_messages(id,world_id,room_id,character_id,character_name,body,created_at,visit_ids,chat_kind,message_type,recipient_character,source_visit,recipient_name,recipient_number)
 values(p_id,v.world_id,v.room_id,sender.id,sender.name,btrim(p_body),clock_timestamp(),audience,'ic',p_kind,target_id,p_visit,recipient.name,p_target);
 return p_id;
end $$;
revoke all on function public.send_room_command(uuid,uuid,text,text,integer) from public,anon;
grant execute on function public.send_room_command(uuid,uuid,text,text,integer) to authenticated;
commit;
