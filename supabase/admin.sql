-- Public snapshot: owner@example.invalid is a placeholder, never an automatic grant to the original operator.
begin;
create table public.world_staff(world_id text references public.worlds(id),player_id uuid references auth.users(id),role text check(role in('Server Owner','Lead Admin','Admin')),primary key(world_id,player_id,role));
create table public.world_moderation(id uuid primary key,world_id text references public.worlds(id),actor uuid references auth.users(id),target uuid references auth.users(id),action text not null,reason text not null,created_at timestamptz default clock_timestamp());
create table public.world_restrictions(world_id text references public.worlds(id),player_id uuid references auth.users(id),kind text check(kind in('ban','mute')),expires_at timestamptz not null,primary key(world_id,player_id,kind));
create table public.world_reports(id uuid primary key,world_id text references public.worlds(id),player_id uuid references auth.users(id),body text not null,created_at timestamptz default clock_timestamp(),resolved boolean default false);
create table public.world_notices(id uuid primary key,world_id text references public.worlds(id),target uuid,body text not null,created_at timestamptz default clock_timestamp());
create table public.staff_messages(id uuid primary key,world_id text references public.worlds(id),player_id uuid references auth.users(id),body text not null,created_at timestamptz default clock_timestamp());
create function public.staff_rank(p_world text,p_user uuid default auth.uid()) returns int language sql stable security definer set search_path='' as $$ select coalesce(max(case role when 'Server Owner' then 3 when 'Lead Admin' then 2 else 1 end),0) from public.world_staff where world_id=p_world and player_id=p_user $$;
create function public.world_blocked(p_world text,p_user uuid,p_kind text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.world_restrictions where world_id=p_world and player_id=p_user and kind=p_kind and expires_at>clock_timestamp()) $$;
create function public.require_staff(p_world text,p_rank int default 1) returns void language plpgsql security definer set search_path='' as $$ begin
 if auth.uid() is null or public.staff_rank(p_world)<p_rank then raise exception 'Admin permission required for this world';end if;
end $$;
do $$ declare t text;begin foreach t in array array['world_staff','world_moderation','world_restrictions','world_reports','world_notices','staff_messages'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);end loop;end $$;
insert into public.world_staff select 'alska-mogue',id,r from auth.users cross join unnest(array['Server Owner','Lead Admin']) r where lower(email)='owner@example.invalid';

create function public.moderation_action(p_id uuid,p_world text,p_action text,p_target uuid default null,p_reason text default '',p_minutes int default null) returns void language plpgsql security definer set search_path='' as $$
declare rank int; old public.world_moderation;
begin
 perform public.require_staff(p_world);rank:=public.staff_rank(p_world);
 -- Serialize staff changes and moderation so demotions cannot race authorization.
 perform pg_advisory_xact_lock(hashtextextended(p_world,41));perform public.require_staff(p_world);
 select * into old from public.world_moderation where id=p_id;
 if found then if old.actor=auth.uid() and old.world_id=p_world and old.action=p_action and old.target is not distinct from p_target and old.reason=p_reason then return;else raise exception 'Request ID already used';end if;end if;
 if p_action is null or p_action not in('warn','mute','unmute','kick','ban','unban','grant_admin','grant_lead','remove_admin') then raise exception 'Unknown action';end if;
 if p_target is null or not exists(select 1 from auth.users where id=p_target) then raise exception 'Choose a player';end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'A reason is required (1–1000 characters)';end if;
 if p_action in('grant_admin','grant_lead','remove_admin') then
  perform public.require_staff(p_world,3);
  if public.staff_rank(p_world,p_target)=3 then raise exception 'Server Owner roles cannot be changed here';end if;
  delete from public.world_staff where world_id=p_world and player_id=p_target;
  if p_action<>'remove_admin' then insert into public.world_staff values(p_world,p_target,case when p_action='grant_lead' then 'Lead Admin' else 'Admin' end);end if;
 else
  if p_target=auth.uid() or public.staff_rank(p_world,p_target)>=public.staff_rank(p_world) then raise exception 'You can only moderate players below your role';end if;
  if p_action in('mute','ban') then
   if p_minutes is not null and p_minutes not between 1 and 525600 then raise exception 'Duration must be 1–525600 minutes';end if;
   if p_action='mute' and p_minutes is null then raise exception 'Mute duration is required';end if;
   insert into public.world_restrictions values(p_world,p_target,p_action,case when p_minutes is null then 'infinity'::timestamptz else clock_timestamp()+make_interval(mins=>p_minutes) end) on conflict(world_id,player_id,kind) do update set expires_at=excluded.expires_at;
  elsif p_action in('unmute','unban') then delete from public.world_restrictions where world_id=p_world and player_id=p_target and kind=substring(p_action from 3);
  end if;
  if p_action in('kick','ban') then
   update public.chat_visits set active=false where world_id=p_world and player_id=p_target;
   update public.lock_use set token=null,player_id=null,character_id=null,expires_at='-infinity' where world_id=p_world and player_id=p_target;
  end if;
  insert into public.world_notices values(p_id,p_world,p_target,case p_action when 'warn' then 'Admin warning: ' else 'Moderation ('||p_action||'): ' end||p_reason,clock_timestamp());
 end if;
 insert into public.world_moderation(id,world_id,actor,target,action,reason) values(p_id,p_world,auth.uid(),p_target,p_action,p_reason);
end $$;
create function public.world_command(p_id uuid,p_visit uuid,p_body text,p_kind text) returns void language plpgsql security definer set search_path='' as $$
declare v public.chat_visits; parts text[]; target_user uuid;
begin
 select * into v from public.chat_visits where id=p_visit and player_id=auth.uid() and active and seen_at>clock_timestamp()-interval '60 seconds';
 if not found or public.world_blocked(v.world_id,auth.uid(),'ban') then raise exception 'Chat visit expired';end if;
 if p_body is null or length(btrim(p_body)) not between 1 and 500 then raise exception 'Use 1–500 characters';end if;
 if p_kind='report' then
  if exists(select 1 from public.world_reports where id=p_id and player_id=auth.uid() and world_id=v.world_id and body=p_body) then return;end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,42));
  if exists(select 1 from public.world_reports where player_id=auth.uid() and world_id=v.world_id and created_at>clock_timestamp()-interval '30 seconds') then raise exception 'Please wait 30 seconds before another report';end if;
  insert into public.world_reports(id,world_id,player_id,body) values(p_id,v.world_id,auth.uid(),p_body);
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
create function public.moderation_status(p_world text,p_since timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$ begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 return jsonb_build_object('rank',public.staff_rank(p_world),'banned',public.world_blocked(p_world,auth.uid(),'ban'),'kicked',exists(select 1 from public.world_moderation where world_id=p_world and target=auth.uid() and action='kick' and created_at>p_since),'notices',coalesce((select jsonb_agg(n order by n.created_at,n.id) from public.world_notices n where n.world_id=p_world and (n.target is null or n.target=auth.uid()) and n.created_at>p_since),'[]'::jsonb),'staff',coalesce((select jsonb_agg(jsonb_build_object('player_id',s.player_id,'role',s.role,'characters',coalesce((select jsonb_agg(c.id) from public.characters c where c.player_id=s.player_id and c.world_id=s.world_id),'[]'::jsonb))) from public.world_staff s where s.world_id=p_world),'[]'::jsonb));
end $$;
create function public.admin_panel(p_world text) returns jsonb language plpgsql security definer set search_path='' as $$ begin
 perform public.require_staff(p_world);
 return jsonb_build_object('rank',public.staff_rank(p_world),
 'players',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(u.raw_user_meta_data->>'username','Player'),'rank',public.staff_rank(p_world,u.id),'online',exists(select 1 from public.chat_visits v where v.player_id=u.id and v.world_id=p_world and v.active and v.seen_at>clock_timestamp()-interval '60 seconds'))) from auth.users u where exists(select 1 from public.characters c where c.player_id=u.id and c.world_id=p_world) or exists(select 1 from public.world_staff s where s.player_id=u.id and s.world_id=p_world)),'[]'::jsonb),
 'reports',coalesce((select jsonb_agg(r) from (select * from public.world_reports where world_id=p_world order by created_at desc limit 100) r),'[]'::jsonb),
 'actions',coalesce((select jsonb_agg(a) from (select * from public.world_moderation where world_id=p_world order by created_at desc limit 100) a),'[]'::jsonb),
 'chat',coalesce((select jsonb_agg(m) from (select m.*,coalesce(u.raw_user_meta_data->>'username','Admin') as username from public.staff_messages m join auth.users u on u.id=m.player_id where m.world_id=p_world and m.created_at>clock_timestamp()-interval '24 hours' order by m.created_at desc limit 100) m),'[]'::jsonb));
end $$;
create function public.admin_chat(p_id uuid,p_world text,p_body text) returns void language plpgsql security definer set search_path='' as $$ begin
 perform public.require_staff(p_world);if p_body is null or length(btrim(p_body)) not between 1 and 500 then raise exception 'Use 1–500 characters';end if;
 insert into public.staff_messages(id,world_id,player_id,body) values(p_id,p_world,auth.uid(),p_body) on conflict(id) do nothing;
end $$;
create function public.resolve_report(p_world text,p_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 perform public.require_staff(p_world);update public.world_reports set resolved=true where world_id=p_world and id=p_id;
end $$;
create function public.player_world_warnings(p_world text,p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin
 perform public.require_staff(p_world);return coalesce((select jsonb_agg(jsonb_build_object('reason',reason,'created_at',created_at) order by created_at desc) from public.world_moderation where world_id=p_world and target=p_user and action='warn'),'[]'::jsonb);
end $$;

-- Enforce restrictions in database writes, including sends from modified clients.
create function public.moderation_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare wid text; uid uuid;
begin
 wid:=new.world_id;
 if tg_table_name='room_messages' then
  uid:=auth.uid();
  if uid is not null and public.world_blocked(wid,uid,'mute') then raise exception 'You are muted in this world';end if;
 else uid:=new.player_id;end if;
 if public.world_blocked(wid,uid,'ban') then
  if tg_table_name='chat_visits' then if not new.active then return new;end if;end if;
  raise exception 'You are banned from this world';
 end if;return new;
end $$;
create trigger moderation_guard before insert or update on public.characters for each row execute function public.moderation_guard();
create trigger moderation_guard before insert or update on public.chat_visits for each row execute function public.moderation_guard();
create trigger moderation_guard before insert on public.room_messages for each row execute function public.moderation_guard();
-- Guard lock actions, which do not update characters or chat visits.
create function public.moderation_door_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if auth.uid() is not null and public.world_blocked(new.world_id,auth.uid(),'ban') then raise exception 'You are banned from this world';end if;return new;
end $$;
create trigger moderation_door_guard before update on public.world_doors for each row execute function public.moderation_door_guard();
create trigger moderation_door_guard before update on public.lock_use for each row execute function public.moderation_door_guard();

alter table public.world_locations add column image_path text;
alter table public.world_locations add column objects jsonb not null default '[]'::jsonb;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('room-images','room-images',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy "Room images read" on storage.objects for select to authenticated using(bucket_id='room-images');
create policy "Owner room image upload" on storage.objects for insert to authenticated with check(bucket_id='room-images' and public.staff_rank((storage.foldername(name))[1])=3);
create function public.save_room(p_world text,p_room text,p_name text,p_region text,p_description text,p_objects jsonb,p_image text default null) returns void language plpgsql security definer set search_path='' as $$
declare region text; item jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_world,41));perform public.require_staff(p_world,3);
 if p_name is null or p_region is null or p_description is null or length(btrim(p_name)) not between 1 and 80 or length(btrim(p_region)) not between 1 and 80 or length(p_description)>4000 then raise exception 'Room/region names: 1–80 characters; description: up to 4000';end if;
 if p_objects is null or jsonb_typeof(p_objects)<>'array' or jsonb_array_length(p_objects)>20 then raise exception 'Up to 20 objects per room';end if;
 for item in select * from jsonb_array_elements(p_objects) loop
 if length(btrim(item->>'name')) not between 1 and 80 or item->>'name' is null or length(coalesce(item->>'description',''))>1000 then raise exception 'Object name: 1–80 characters; description: up to 1000';end if;end loop;
 if p_image is not null and (split_part(p_image,'/',1)<>p_world or not exists(select 1 from storage.objects where bucket_id='room-images' and name=p_image)) then raise exception 'Room image unavailable';end if;
 select region_id into region from public.world_locations where world_id=p_world and id=p_room for update;
 if not found then raise exception 'Room not found';end if;
 update public.world_regions set name=btrim(p_region) where world_id=p_world and id=region;
 update public.world_locations set name=btrim(p_name),description=p_description,objects=p_objects,image_path=p_image where world_id=p_world and id=p_room;
 insert into public.world_moderation(id,world_id,actor,action,reason) values(gen_random_uuid(),p_world,auth.uid(),'edit_room',p_room||': '||p_name);
end $$;
-- No client may award badges or write moderation records directly.
revoke all on function public.staff_rank(text,uuid),public.world_blocked(text,uuid,text),public.require_staff(text,int),public.moderation_guard(),public.moderation_door_guard() from public,anon,authenticated;
grant execute on function public.staff_rank(text,uuid) to authenticated;
revoke all on function public.moderation_action(uuid,text,text,uuid,text,int),public.world_command(uuid,uuid,text,text),public.moderation_status(text,timestamptz),public.admin_panel(text),public.admin_chat(uuid,text,text),public.resolve_report(text,uuid),public.player_world_warnings(text,uuid),public.save_room(text,text,text,text,text,jsonb,text) from public,anon;
grant execute on function public.moderation_action(uuid,text,text,uuid,text,int),public.world_command(uuid,uuid,text,text),public.moderation_status(text,timestamptz),public.admin_panel(text),public.admin_chat(uuid,text,text),public.resolve_report(text,uuid),public.player_world_warnings(text,uuid),public.save_room(text,text,text,text,text,jsonb,text) to authenticated;
create or replace function public.player_profile_extras(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('photo_path',(select photo_path from public.player_appearance where player_id=p_user),'badges',coalesce((select jsonb_agg(badge order by badge) from public.player_badges where player_id=p_user),'[]'::jsonb)||coalesce((select jsonb_agg(s.role||' · '||w.name order by s.role) from public.world_staff s join public.worlds w on w.id=s.world_id where s.player_id=p_user),'[]'::jsonb)) where auth.uid() is not null;
$$;
commit;
