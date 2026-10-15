-- LOCAL DRAFT. Apply after privacy-accounts.sql and before age-world-guards.sql.
begin;
alter table public.room_messages add column source_room_name text, add column item_preview jsonb;
alter table public.room_messages drop constraint room_messages_message_type_check;
alter table public.room_messages add constraint room_messages_message_type_check check(message_type in('chat','whisper','whisper_notice','directed','action','description','movement','possessive','shout','item_show'));
create or replace function public.send_room_command(p_id uuid,p_visit uuid,p_body text,p_kind text,p_target integer default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v public.chat_visits; sender public.characters; recipient public.characters;
 target_id uuid; audience uuid[]; existing public.room_messages;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 if p_kind is null or p_kind not in ('directed','action','description','possessive','shout') or p_id is null or p_body is null
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
 select array_agg(cv.id) into audience from public.chat_visits cv join public.characters c on c.id=cv.character_id and c.room_id=cv.room_id where cv.world_id=v.world_id and (cv.room_id=v.room_id or (p_kind='shout' and exists(select 1 from public.room_connections e where e.world_id=v.world_id and e.from_room=v.room_id and e.to_room=cv.room_id))) and cv.active and cv.seen_at>clock_timestamp()-interval '60 seconds';
 insert into public.room_messages(id,world_id,room_id,character_id,character_name,body,created_at,visit_ids,chat_kind,message_type,recipient_character,source_visit,recipient_name,recipient_number,source_room_name)
 values(p_id,v.world_id,v.room_id,sender.id,sender.name,btrim(p_body),clock_timestamp(),audience,'ic',p_kind,target_id,p_visit,recipient.name,p_target,(select name from public.world_locations where world_id=v.world_id and id=v.room_id));
 return p_id;
end $$;
create or replace function public.world_command(p_id uuid,p_visit uuid,p_body text,p_kind text) returns void language plpgsql security definer set search_path='' as $$
declare v public.chat_visits; parts text[]; target_user uuid;
begin
 select * into v from public.chat_visits where id=p_visit and player_id=auth.uid() and active and seen_at>clock_timestamp()-interval '60 seconds';
 if not found or public.world_blocked(v.world_id,auth.uid(),'ban') then raise exception 'Chat visit expired';end if;
 if p_body is null or length(btrim(p_body)) not between 1 and 500 then raise exception 'Use 1–500 characters';end if;
 if p_kind in('report','help') then
  if p_kind='help' then p_body:='Help request: '||p_body;end if;
  if exists(select 1 from public.world_reports where id=p_id and player_id=auth.uid() and world_id=v.world_id and body=p_body) then return;end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,42));
  if exists(select 1 from public.world_reports where player_id=auth.uid() and world_id=v.world_id and created_at>clock_timestamp()-interval '30 seconds') then raise exception 'Please wait 30 seconds before another report';end if;
  insert into public.world_reports(id,world_id,player_id,body) values(p_id,v.world_id,auth.uid(),p_body);
  if p_kind='help' then
   insert into public.world_notices(id,world_id,target,body,created_at)
   select gen_random_uuid(),v.world_id,u.id,p_body,clock_timestamp() from auth.users u
   where public.staff_rank(v.world_id,u.id)>0 and exists(select 1 from public.chat_visits cv where cv.world_id=v.world_id and cv.player_id=u.id and cv.active and cv.seen_at>clock_timestamp()-interval '60 seconds');
  end if;
 elsif p_kind='global' then
  perform public.require_staff(v.world_id);
  insert into public.world_notices values(p_id,v.world_id,null,'Admin announcement: '||p_body,clock_timestamp()) on conflict(id) do nothing;
 elsif p_kind in('warn','ban','kick','mute') then
  perform public.require_staff(v.world_id);
  parts:=regexp_match(p_body,case when p_kind='mute' then '^([0-9]+) +([0-9]+) +(.+)$' else '^([0-9]+) +(.+)$' end);
  if parts is null then raise exception 'Use /warn ID reason, /ban ID reason, /kick ID reason, or /mute ID minutes reason';end if;
  select c.player_id into target_user from public.room_chat_numbers n join public.characters c on c.id=n.character_id where n.world_id=v.world_id and n.room_id=v.room_id and n.number=parts[1]::int and c.room_id=v.room_id;
  if target_user is null then raise exception 'Character ID not found in this room';end if;
  perform public.moderation_action(p_id,v.world_id,p_kind,target_user,case when p_kind='mute' then parts[3] else parts[2] end,case when p_kind='mute' then parts[2]::int else null end);
 else raise exception 'Unknown command';end if;
end $$;
create function public.online_world_admins(p_world text) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(nullif(u.raw_user_meta_data->>'username',''),'Player'),'role',case public.staff_rank(p_world,u.id) when 4 then 'APSU Founder' when 3 then 'World Owner' when 2 then 'Lead Admin' else 'Admin' end) order by public.staff_rank(p_world,u.id) desc,u.id),'[]'::jsonb)
 from auth.users u where auth.uid() is not null and public.staff_rank(p_world,u.id)>0
 and exists(select 1 from public.chat_visits v join public.characters c on c.id=v.character_id and c.room_id=v.room_id where v.player_id=u.id and v.world_id=p_world and v.active and v.seen_at>clock_timestamp()-interval '60 seconds');
$$;
create function public.show_inventory_item(p_id uuid,p_character uuid,p_item uuid,p_target uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.characters; target public.characters; item public.character_items; old public.room_messages; audience uuid[]; preview jsonb; item_name text; source uuid;
begin
 if auth.uid() is null or p_id is null then raise exception 'Sign in required';end if;
 select * into c from public.characters where id=p_character and player_id=auth.uid() for update;
 if not found then raise exception 'Character unavailable';end if;
 select * into old from public.room_messages where id=p_id;
 if found then
  if old.character_id=c.id and old.recipient_character=p_target and old.message_type='item_show' and old.item_preview->>'item_id'=p_item::text then return p_id;end if;
  raise exception 'Request identifier already used';
 end if;
 select * into item from public.character_items where id=p_item and character_id=c.id for update;
 if not found then raise exception 'That item is not in your inventory';end if;
 select * into target from public.characters where id=p_target and id<>c.id and world_id=c.world_id and room_id=c.room_id;
 if not found then raise exception 'Choose another character in this room';end if;
 select id into source from public.chat_visits where character_id=c.id and room_id=c.room_id and active and seen_at>clock_timestamp()-interval '60 seconds' order by seen_at desc limit 1;
 if source is null or not exists(select 1 from public.chat_visits where character_id=target.id and room_id=c.room_id and active and seen_at>clock_timestamp()-interval '60 seconds') then raise exception 'Both characters must be connected in this room';end if;
 item_name:=case when item.kind='custom' then item.appearance->>'name' when item.kind in('key','room-c-key') then coalesce((select name from public.world_locations where world_id=c.world_id and id=coalesce(item.key_room,'roomC')),'Room')||' Key' when item.capacity=0 then 'Broken lockpick' when item.capacity=50 then 'Damaged lockpick' else 'Lockpick' end;
 preview:=item.appearance||jsonb_build_object('name',item_name,'item_id',item.id);
 select array_agg(id) into audience from public.chat_visits where character_id in(c.id,target.id) and room_id=c.room_id and active and seen_at>clock_timestamp()-interval '60 seconds';
 insert into public.room_messages(id,world_id,room_id,character_id,character_name,body,visit_ids,chat_kind,message_type,recipient_character,source_visit,item_preview)
 values(p_id,c.world_id,c.room_id,c.id,'System',c.name||' is showing you '||item_name||'.',audience,'ic','item_show',target.id,source,preview);
 return p_id;
end $$;
-- A recipient may open the exact item image they witnessed, for the chat's lifetime.
create policy "Witnessed item image" on storage.objects for select to authenticated using(
 bucket_id='item-images' and exists(select 1 from public.room_messages m where m.message_type='item_show' and m.item_preview->>'image_path'=name and m.created_at>clock_timestamp()-interval '24 hours')
);

create table public.direct_messages (
 id uuid primary key, sender uuid not null references auth.users(id) on delete cascade,
 recipient uuid not null references auth.users(id) on delete cascade,
 body text not null check(char_length(btrim(body)) between 1 and 500 and body !~ E'[\n\r]'),
 created_at timestamptz not null default clock_timestamp(), check(sender<>recipient)
);
create index dm_sender_recent on public.direct_messages(sender,created_at desc);
create index dm_recipient_recent on public.direct_messages(recipient,created_at desc);
create table public.dm_blocks(blocker uuid references auth.users(id) on delete cascade,blocked uuid references auth.users(id) on delete cascade,primary key(blocker,blocked),check(blocker<>blocked));
alter table public.direct_messages enable row level security;
alter table public.dm_blocks enable row level security;
revoke all on public.direct_messages,public.dm_blocks from public,anon,authenticated;
grant select on public.direct_messages to authenticated;
create policy "Own recent direct messages" on public.direct_messages for select to authenticated using((sender=auth.uid() or recipient=auth.uid()) and created_at>clock_timestamp()-interval '24 hours');
create function public.send_dm(p_id uuid,p_peer uuid,p_body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.direct_messages;
begin
 if auth.uid() is null or not public.account_is_eligible() or not public.account_is_eligible(p_peer) then raise exception 'Complete account eligibility before messaging';end if;
 if p_id is null or p_peer is null or p_peer=auth.uid() or p_body is null or char_length(btrim(p_body)) not between 1 and 500 or p_body ~ E'[\n\r]' then raise exception 'Choose another player and use 1–500 characters on one line';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,149));
 select * into old from public.direct_messages where id=p_id;
 if found then if old.sender=auth.uid() and old.recipient=p_peer and old.body=btrim(p_body) then return p_id;end if;raise exception 'Message identifier already used';end if;
 if exists(select 1 from public.dm_blocks where (blocker=auth.uid() and blocked=p_peer) or (blocker=p_peer and blocked=auth.uid())) then raise exception 'Messaging is unavailable for this conversation';end if;
 if exists(select 1 from public.direct_messages where sender=auth.uid() and created_at>clock_timestamp()-interval '1 second') or (select count(*) from public.direct_messages where sender=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=20 then raise exception 'Please wait before sending another message';end if;
 insert into public.direct_messages(id,sender,recipient,body) values(p_id,auth.uid(),p_peer,btrim(p_body));return p_id;
end $$;
create function public.dm_thread(p_peer uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ begin
 if not public.account_is_eligible() then raise exception 'Complete account eligibility before messaging';end if;
 if p_peer=auth.uid() or not exists(select 1 from auth.users where id=p_peer) then raise exception 'Player unavailable';end if;
 return jsonb_build_object('name',(select coalesce(nullif(raw_user_meta_data->>'username',''),'Player') from auth.users where id=p_peer),
 'blocked',exists(select 1 from public.dm_blocks where blocker=auth.uid() and blocked=p_peer),
 'can_send',public.account_is_eligible(p_peer) and not exists(select 1 from public.dm_blocks where (blocker=auth.uid() and blocked=p_peer) or (blocker=p_peer and blocked=auth.uid())),
 'messages',coalesce((select jsonb_agg(m order by m.created_at,m.id) from (select * from public.direct_messages where ((sender=auth.uid() and recipient=p_peer) or (sender=p_peer and recipient=auth.uid())) and created_at>clock_timestamp()-interval '24 hours' order by created_at desc,id desc limit 100) m),'[]'::jsonb));
end $$;
create function public.dm_inbox() returns jsonb
language plpgsql security definer set search_path='' as $$ begin
 if not public.account_is_eligible() then raise exception 'Complete account eligibility before messaging';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('peer',q.peer,'name',coalesce(nullif(u.raw_user_meta_data->>'username',''),'Player')) order by q.latest desc) from (
 select case when sender=auth.uid() then recipient else sender end as peer,max(created_at) as latest from public.direct_messages
 where (sender=auth.uid() or recipient=auth.uid()) and created_at>clock_timestamp()-interval '24 hours'
 group by 1 order by 2 desc limit 30) q join auth.users u on u.id=q.peer),'[]'::jsonb);
end $$;
create function public.set_dm_block(p_peer uuid,p_blocked boolean) returns void
language plpgsql security definer set search_path='' as $$ begin
 if auth.uid() is null or p_peer is null or p_peer=auth.uid() or p_blocked is null then raise exception 'Choose another player';end if;
 if p_blocked then insert into public.dm_blocks values(auth.uid(),p_peer) on conflict do nothing;
 else delete from public.dm_blocks where blocker=auth.uid() and blocked=p_peer;end if;
end $$;
revoke all on function public.online_world_admins(text),public.show_inventory_item(uuid,uuid,uuid,uuid),public.send_dm(uuid,uuid,text),public.dm_thread(uuid),public.dm_inbox(),public.set_dm_block(uuid,boolean) from public,anon;
grant execute on function public.online_world_admins(text),public.show_inventory_item(uuid,uuid,uuid,uuid),public.send_dm(uuid,uuid,text),public.dm_thread(uuid),public.dm_inbox(),public.set_dm_block(uuid,boolean) to authenticated;
-- The project already uses pg_cron for 24-hour chat cleanup.
select cron.schedule('apsu-dm-expiry','* * * * *',$job$delete from public.direct_messages where created_at<=clock_timestamp()-interval '24 hours'$job$);
create or replace function public.item_appearance(p_world text,p_item jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare image text:=nullif(p_item->>'image_path','');icon text:=coalesce(nullif(p_item->>'icon',''),'box');name text:=btrim(coalesce(p_item->>'name',''));description text:=coalesce(p_item->>'description','');
begin
 if p_item is null or jsonb_typeof(p_item)<>'object' or length(name)>80 or length(description)>1000 or icon not in('box','watch','key','tool','bag','book','bottle','gem','coin','sword','scroll','ring','necklace','flower','food','cup','clothing','boot','compass','envelope','feather','lantern','instrument','herb') then raise exception 'Choose a valid item name, description and icon';end if;
 if image is not null and (split_part(image,'/',1)<>p_world or not exists(select 1 from storage.objects o where o.bucket_id='item-images' and o.name=image)) then raise exception 'Item image unavailable in this world';end if;
 return jsonb_build_object('name',name,'description',description,'icon',icon,'image_path',image);
end $$;
commit;
