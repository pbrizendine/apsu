-- Public snapshot: owner@example.invalid is a placeholder, never an automatic grant to the original operator.
begin;
update public.player_badges set badge='APSU Founder' where badge='Founder' and player_id=(select id from auth.users where lower(email)='owner@example.invalid');
create or replace function public.staff_rank(p_world text,p_user uuid default auth.uid()) returns int language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.player_badges where player_id=p_user and badge='APSU Founder') then 4 else coalesce((select max(case role when 'Server Owner' then 3 when 'Lead Admin' then 2 else 1 end) from public.world_staff where world_id=p_world and player_id=p_user),0) end;
$$;
alter policy "Owner room image upload" on storage.objects with check(bucket_id='room-images' and public.staff_rank((storage.foldername(name))[1])>=3);
create or replace function public.moderation_action(p_id uuid,p_world text,p_action text,p_target uuid default null,p_reason text default '',p_minutes int default null) returns void language plpgsql security definer set search_path='' as $$
declare rank int; old public.world_moderation;
begin
 perform public.require_staff(p_world);rank:=public.staff_rank(p_world);
 -- Serialize staff changes and moderation so demotions cannot race authorization.
 perform pg_advisory_xact_lock(hashtextextended(p_world,41));perform public.require_staff(p_world);
 select * into old from public.world_moderation where id=p_id;
 if found then if old.actor=auth.uid() and old.world_id=p_world and old.action=p_action and old.target is not distinct from p_target and old.reason=p_reason then return;else raise exception 'Request ID already used';end if;end if;
 if p_action is null or p_action not in('warn','mute','unmute','kick','ban','unban','grant_admin','grant_lead','grant_owner','remove_admin') then raise exception 'Unknown action';end if;
 if p_target is null or not exists(select 1 from auth.users where id=p_target) then raise exception 'Choose a player';end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'A reason is required (1–1000 characters)';end if;
 if p_action in('grant_admin','grant_lead','grant_owner','remove_admin') then
  perform public.require_staff(p_world,3);
  if p_action='grant_owner' then perform public.require_staff(p_world,4);end if;
  if public.staff_rank(p_world,p_target)>=public.staff_rank(p_world) then raise exception 'You can only manage roles below your own';end if;
  delete from public.world_staff where world_id=p_world and player_id=p_target;
  if p_action<>'remove_admin' then insert into public.world_staff values(p_world,p_target,case when p_action='grant_owner' then 'Server Owner' when p_action='grant_lead' then 'Lead Admin' else 'Admin' end);end if;
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
create or replace function public.moderation_status(p_world text,p_since timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$ begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 return jsonb_build_object('rank',public.staff_rank(p_world),'banned',public.world_blocked(p_world,auth.uid(),'ban'),'kicked',exists(select 1 from public.world_moderation where world_id=p_world and target=auth.uid() and action='kick' and created_at>p_since),'notices',coalesce((select jsonb_agg(n order by n.created_at,n.id) from public.world_notices n where n.world_id=p_world and (n.target is null or n.target=auth.uid()) and n.created_at>p_since),'[]'::jsonb),'staff',coalesce((select jsonb_agg(jsonb_build_object('player_id',s.player_id,'role',s.role,'characters',coalesce((select jsonb_agg(c.id) from public.characters c where c.player_id=s.player_id and c.world_id=s.world_id),'[]'::jsonb))) from (select world_id,player_id,role from public.world_staff where world_id=p_world union all select p_world,player_id,'APSU Founder' from public.player_badges where badge='APSU Founder') s where s.world_id=p_world),'[]'::jsonb));
end $$;
create or replace function public.save_room(p_world text,p_room text,p_name text,p_region text,p_description text,p_objects jsonb,p_image text default null) returns void language plpgsql security definer set search_path='' as $$
declare region text; item jsonb; normalized jsonb:='[]'; seen_ids text[]:='{}'; object_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_world,41));perform public.require_staff(p_world,3);
 if p_name is null or p_region is null or p_description is null or length(btrim(p_name)) not between 1 and 80 or length(btrim(p_region)) not between 1 and 80 or length(p_description)>4000 then raise exception 'Room/region names: 1–80 characters; description: up to 4000';end if;
 if p_objects is null or jsonb_typeof(p_objects)<>'array' or jsonb_array_length(p_objects)>20 then raise exception 'Up to 20 objects per room';end if;
 for item in select * from jsonb_array_elements(p_objects) loop
 if length(btrim(item->>'name')) not between 1 and 80 or item->>'name' is null or length(coalesce(item->>'description',''))>1000 then raise exception 'Object name: 1–80 characters; description: up to 1000';end if;
 if coalesce(item->>'script','none') not in('none','lockpick-full','lockpick-damaged','lockpick-broken','room-c-key') then raise exception 'Unknown scripted item';end if;
 object_id:=coalesce((item->>'id')::uuid,gen_random_uuid());
 if object_id::text=any(seen_ids) then raise exception 'Duplicate object ID';end if;seen_ids:=array_append(seen_ids,object_id::text);
 if exists(select 1 from public.character_items where source_object=object_id) then continue;end if;
 normalized:=normalized||jsonb_build_array(jsonb_build_object('id',object_id,'name',btrim(item->>'name'),'description',coalesce(item->>'description',''),'script',coalesce(item->>'script','none')));
 end loop;
 if p_image is not null and (split_part(p_image,'/',1)<>p_world or not exists(select 1 from storage.objects where bucket_id='room-images' and name=p_image)) then raise exception 'Room image unavailable';end if;
 select region_id into region from public.world_locations where world_id=p_world and id=p_room for update;
 if not found then raise exception 'Room not found';end if;
 update public.world_regions set name=btrim(p_region) where world_id=p_world and id=region;
 update public.world_locations set name=btrim(p_name),description=p_description,objects=normalized,image_path=p_image where world_id=p_world and id=p_room;
 insert into public.world_moderation(id,world_id,actor,action,reason) values(gen_random_uuid(),p_world,auth.uid(),'edit_room',p_room||': '||p_name);
end $$;

alter table public.character_items add column source_object uuid unique;
create function public.pickup_room_object(p_character uuid,p_object uuid) returns public.character_items language plpgsql security definer set search_path='' as $$
declare c public.characters; r public.world_locations; obj jsonb; item public.character_items; item_kind text; item_capacity int; free_slot int;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid() for update;
 if not found or public.world_blocked(c.world_id,auth.uid(),'ban') then raise exception 'Character unavailable';end if;
 select * into item from public.character_items where source_object=p_object and character_id=c.id;
 if found then return item;end if;
 select * into r from public.world_locations where world_id=c.world_id and id=c.room_id for update;
 select x into obj from jsonb_array_elements(r.objects) x where x->>'id'=p_object::text;
 if obj is null or coalesce(obj->>'script','none')='none' then raise exception 'That item is no longer here';end if;
 if obj->>'script'='room-c-key' then item_kind:='room-c-key';item_capacity:=100;
 elsif obj->>'script' in('lockpick-full','lockpick-damaged','lockpick-broken') then item_kind:='lockpick';item_capacity:=case obj->>'script' when 'lockpick-full' then 100 when 'lockpick-damaged' then 50 else 0 end;
 else raise exception 'Unknown scripted item';end if;
 select s into free_slot from generate_series(1,case when item_kind='lockpick' then 3 else 1 end) s where not exists(select 1 from public.character_items i where i.character_id=c.id and i.kind=item_kind and i.slot=s) order by s limit 1;
 if free_slot is null then raise exception 'Inventory limit reached for this item';end if;
 insert into public.character_items(character_id,kind,capacity,slot,source_object) values(c.id,item_kind,item_capacity,free_slot,p_object) returning * into item;
 update public.world_locations set objects=coalesce((select jsonb_agg(x) from jsonb_array_elements(objects) x where x->>'id'<>p_object::text),'[]'::jsonb) where world_id=c.world_id and id=c.room_id;
 return item;
end $$;
revoke all on function public.pickup_room_object(uuid,uuid) from public,anon;
grant execute on function public.pickup_room_object(uuid,uuid) to authenticated;
commit;

create or replace function public.player_profile_extras(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('photo_path',(select photo_path from public.player_appearance where player_id=p_user),'badges',coalesce((select jsonb_agg(badge order by badge) from public.player_badges where player_id=p_user),'[]'::jsonb)||coalesce((select jsonb_agg(s.role||' · '||w.name order by case s.role when 'Server Owner' then 3 when 'Lead Admin' then 2 else 1 end desc) from public.world_staff s join public.worlds w on w.id=s.world_id where s.player_id=p_user),'[]'::jsonb)) where auth.uid() is not null;
$$;
