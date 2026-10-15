-- Playtest chat: pending-message clients, private images, typing and movement notices.
-- Run after create-rooms.sql. Existing messages and accounts are preserved.
begin;
alter table public.chat_visits add column if not exists typing_until timestamptz not null default '-infinity';
alter table public.characters add column if not exists sneak_until timestamptz not null default '-infinity';
alter table public.room_messages add column if not exists image_count int not null default 0 check(image_count between 0 and 3);
alter table public.room_messages drop constraint if exists room_messages_body_check;
alter table public.room_messages add constraint room_messages_body_check check(char_length(btrim(body)) between 0 and 2000 and (char_length(btrim(body))>0 or image_count>0));
alter table public.room_messages drop constraint if exists room_messages_message_type_check;
alter table public.room_messages add constraint room_messages_message_type_check check(message_type in('chat','whisper','whisper_notice','directed','action','description','movement'));
create table if not exists public.room_message_images (
 message_id uuid references public.room_messages(id) on delete cascade,
 position int check(position between 1 and 3),
 data_url text not null check(length(data_url)<=350000 and data_url ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'),
 primary key(message_id,position)
);
alter table public.room_message_images enable row level security;
revoke all on public.room_message_images from public,anon,authenticated;
grant select on public.room_message_images to authenticated;
drop policy if exists "Witnessed chat images" on public.room_message_images;
create policy "Witnessed chat images" on public.room_message_images for select to authenticated using(exists(select 1 from public.room_messages m where m.id=message_id));
-- Existing message RLS enforces witnessed visits and 24h expiry. Existing cron deletion
-- cascades into images, so no orphaned uploads or public storage links remain.
create or replace function public.send_chat_message(p_id uuid,p_visit uuid,p_body text,p_kind text,p_images text[] default '{}') returns uuid language plpgsql security definer set search_path='' as $$
declare v public.chat_visits; c public.characters; old public.room_messages; audience uuid[]; name text; image text; idx int:=0;
begin
 if auth.uid() is null or p_id is null or p_visit is null then raise exception 'Sign in required';end if;
 if p_kind is null or p_kind not in('ic','ooc') or p_images is null or cardinality(p_images)>3 or p_body is null or char_length(btrim(p_body))>500 or p_body ~ E'[\n\r]' or (btrim(p_body)='' and cardinality(p_images)=0) then raise exception 'Use up to 500 characters and 3 images';end if;
 foreach image in array p_images loop
  if image is null or length(image)>350000 or image !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' then raise exception 'Invalid chat image';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,95));
 select * into v from public.chat_visits where id=p_visit and player_id=auth.uid();
 if not found then raise exception 'Chat visit expired';end if;
 select * into c from public.characters where id=v.character_id and player_id=auth.uid() for update;
 select * into old from public.room_messages where id=p_id;
 if found then
  if old.character_id=c.id and old.source_visit=p_visit and old.chat_kind=p_kind and old.message_type='chat' and old.body=btrim(p_body) and old.image_count=cardinality(p_images) and coalesce((select array_agg(data_url order by position) from public.room_message_images where message_id=p_id),'{}'::text[])=p_images then return p_id;end if;
  raise exception 'Message identifier already used';
 end if;
 if not v.active or v.seen_at<=clock_timestamp()-interval '60 seconds' or c.room_id<>v.room_id then raise exception 'Chat visit expired';end if;
 if public.world_blocked(c.world_id,auth.uid(),'ban') or public.world_blocked(c.world_id,auth.uid(),'mute') then raise exception 'Chat is restricted for your account in this world';end if;
 if cardinality(p_images)>0 then perform public.take_rate_slot(c.world_id,'chat-images',interval '1 minute',1);end if;
 name:=c.name;
 if p_kind='ooc' then select coalesce(nullif(btrim(raw_user_meta_data->>'username'),''),'Player') into name from auth.users where id=auth.uid();end if;
 select array_agg(vv.id) into audience from public.chat_visits vv join public.characters cc on cc.id=vv.character_id and cc.room_id=vv.room_id
 where vv.world_id=c.world_id and (p_kind='ooc' or vv.room_id=c.room_id) and vv.active and vv.seen_at>clock_timestamp()-interval '60 seconds';
 insert into public.room_messages(id,world_id,room_id,character_id,character_name,body,visit_ids,chat_kind,source_visit,image_count)
 values(p_id,c.world_id,c.room_id,c.id,name,btrim(p_body),audience,p_kind,p_visit,cardinality(p_images));
 foreach image in array p_images loop idx:=idx+1;insert into public.room_message_images values(p_id,idx,image);end loop;
 update public.chat_visits set typing_until='-infinity' where id=p_visit;
 return p_id;
end $$;
-- Keep old tabs working through the same validation and retry rules.
create or replace function public.send_visit_message(p_id uuid,p_visit uuid,p_body text) returns uuid language sql security definer set search_path='' as $$ select public.send_chat_message(p_id,p_visit,p_body,'ic','{}'); $$;
create or replace function public.send_world_ooc(p_id uuid,p_visit uuid,p_body text) returns uuid language sql security definer set search_path='' as $$ select public.send_chat_message(p_id,p_visit,p_body,'ooc','{}'); $$;
create or replace function public.set_chat_typing(p_visit uuid,p_typing boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 update public.chat_visits v set typing_until=case when p_typing then clock_timestamp()+interval '6 seconds' else '-infinity'::timestamptz end
 where v.id=p_visit and v.player_id=auth.uid() and v.active and v.seen_at>clock_timestamp()-interval '60 seconds'
 and exists(select 1 from public.characters c where c.id=v.character_id and c.room_id=v.room_id);
end $$;
create table if not exists public.sneak_requests(id uuid primary key,player_id uuid not null,character_id uuid not null references public.characters(id),created_at timestamptz not null default clock_timestamp());
alter table public.sneak_requests enable row level security;
revoke all on public.sneak_requests from public,anon,authenticated;
create or replace function public.sneak_character(p_id uuid,p_visit uuid) returns void language plpgsql security definer set search_path='' as $$
declare v public.chat_visits;old public.sneak_requests;
begin
 select * into v from public.chat_visits where id=p_visit and player_id=auth.uid() and active and seen_at>clock_timestamp()-interval '60 seconds';
 if not found or p_id is null then raise exception 'Chat visit expired';end if;
 perform 1 from public.characters where id=v.character_id and room_id=v.room_id for update;
 if not found or public.world_blocked(v.world_id,auth.uid(),'ban') then raise exception 'Character unavailable';end if;
 select * into old from public.sneak_requests where id=p_id;
 if found then if old.player_id=auth.uid() and old.character_id=v.character_id then return;end if;raise exception 'Request ID already used';end if;
 perform public.take_rate_slot(v.world_id,'sneak',interval '30 seconds',2);
 update public.characters set sneak_until=clock_timestamp()+interval '30 seconds' where id=v.character_id;
 insert into public.sneak_requests(id,player_id,character_id) values(p_id,auth.uid(),v.character_id);
 delete from public.sneak_requests where created_at<clock_timestamp()-interval '24 hours';
end $$;
-- Called only from permission-checked movement functions, before their visits are closed.
create or replace function public.room_departure(p_character uuid,p_to text) returns void language plpgsql security definer set search_path='' as $$
declare c public.characters; audience uuid[]; target_name text;
begin
 select * into c from public.characters where id=p_character;
 if not found or c.sneak_until>clock_timestamp() then return;end if;
 select array_agg(id) into audience from public.chat_visits where world_id=c.world_id and room_id=c.room_id and character_id<>c.id and active and seen_at>clock_timestamp()-interval '60 seconds';
 if coalesce(cardinality(audience),0)=0 then return;end if;
 select name into target_name from public.world_locations where world_id=c.world_id and id=p_to;
 insert into public.room_messages(id,world_id,room_id,character_id,character_name,body,visit_ids,chat_kind,message_type)
 values(gen_random_uuid(),c.world_id,c.room_id,c.id,'System · Room',c.name||' leaves for '||target_name||'.',audience,'ic','movement');
end $$;
create or replace function public.chat_rate_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='room_messages' then
  if new.message_type in('whisper_notice','movement') or exists(select 1 from public.room_messages where id=new.id) then return new;end if;
  perform public.take_rate_slot(new.world_id,'chat',interval '1 second',20);
 elsif tg_table_name='staff_messages' then
  if exists(select 1 from public.staff_messages where id=new.id) then return new;end if;
  perform public.take_rate_slot(new.world_id,'chat',interval '1 second',20);
 elsif tg_table_name='world_notices' then
  if new.target is not null or exists(select 1 from public.world_notices where id=new.id) then return new;end if;
  perform public.take_rate_slot(new.world_id,'announcement',interval '10 seconds',6);
 end if;return new;
end $$;
create or replace function public.moderation_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare wid text;uid uuid;
begin
 wid:=new.world_id;
 if tg_table_name='room_messages' then
  uid:=auth.uid();
  if new.message_type<>'movement' and uid is not null and public.world_blocked(wid,uid,'mute') then raise exception 'You are muted in this world';end if;
 else uid:=new.player_id;end if;
 if public.world_blocked(wid,uid,'ban') then
  if tg_table_name='chat_visits' then if not new.active then return new;end if;end if;
  raise exception 'You are banned from this world';
 end if;return new;
end $$;
create or replace function public.save_character_location(p_character uuid,p_from text,p_to text) returns text language plpgsql security definer set search_path='' as $$
declare c public.characters; edge public.room_connections; d public.world_doors; wid text;
begin
 select world_id into wid from public.characters where id=p_character and player_id=auth.uid();
 if wid is null then raise exception 'Character unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(wid,41));
 select * into c from public.characters where id=p_character and player_id=auth.uid() for update;
 if public.world_blocked(c.world_id,auth.uid(),'ban') then raise exception 'Character unavailable';end if;
 if c.room_id is distinct from p_from then raise exception 'Location changed. Reload before moving.';end if;
 select * into edge from public.room_connections where world_id=c.world_id and from_room=p_from and to_room=p_to;
 if not found then raise exception 'Rooms are not adjacent';end if;
 -- A lock belongs to one exact passage, never to the whole destination room.
 select * into d from public.world_doors where world_id=c.world_id and door_id=edge.door_id and enabled
 and ((inside_room=p_from and outside_room=p_to) or (inside_room=p_to and outside_room=p_from)) for update;
 if found and d.locked then raise exception 'The door is locked';end if;
 perform public.room_departure(c.id,p_to);
 update public.characters set room_id=p_to where id=c.id;
 update public.chat_visits set active=false,typing_until='-infinity' where character_id=c.id and active;
 update public.lock_use set token=null,player_id=null,character_id=null,expires_at='-infinity' where character_id=c.id;
 return p_to;
end $$;
revoke all on function public.send_chat_message(uuid,uuid,text,text,text[]),public.set_chat_typing(uuid,boolean),public.sneak_character(uuid,uuid) from public,anon;
grant execute on function public.send_chat_message(uuid,uuid,text,text,text[]),public.set_chat_typing(uuid,boolean),public.sneak_character(uuid,uuid) to authenticated;
revoke all on function public.room_departure(uuid,text) from public,anon,authenticated;
commit;
