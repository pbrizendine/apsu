begin;
alter table public.character_items add column key_room text;
update public.character_items set key_room='roomC' where kind='room-c-key';
alter table public.ground_items add column key_room text;
update public.ground_items set key_room='roomC' where kind='room-c-key';
alter table public.character_items drop constraint character_items_kind_check;
alter table public.character_items add constraint character_items_kind_check check(kind in('lockpick','room-c-key','key'));
alter table public.character_items drop constraint item_slot_limit;
alter table public.character_items add constraint item_slot_limit check((kind='lockpick' and ((capacity>0 and slot between 1 and 3) or (capacity=0 and slot>=4))) or (kind in('key','room-c-key') and slot>=1));
update public.character_items set kind='key' where kind='room-c-key';
update public.ground_items set kind='key' where kind='room-c-key';
create or replace function public.inventory_slot(p_character uuid,p_kind text,p_capacity int) returns int language sql stable set search_path='' as $$
 select s from generate_series(case when p_kind='lockpick' and p_capacity=0 then 4 else 1 end,case when p_kind='lockpick' and p_capacity>0 then 3 else 32767 end) s where not exists(select 1 from public.character_items i where i.character_id=p_character and i.kind=p_kind and i.slot=s) order by s limit 1;
$$;
create or replace function public.inventory_action(p_request uuid,p_character uuid,p_item uuid,p_action text,p_target uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare c public.characters;t public.characters;i public.character_items;g public.ground_items;old public.inventory_requests;s int;
begin
 if auth.uid() is null or p_request is null then raise exception 'Sign in required';end if;
 -- Serialize requests (including retries) before locking characters in UUID order.
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,82));
 select * into old from public.inventory_requests where id=p_request;
 if found then if old.actor=auth.uid() and old.character_id=p_character and old.item_id=p_item and old.action=p_action and old.target is not distinct from p_target then return;else raise exception 'Request ID already used';end if;end if;
 perform 1 from public.characters where id in(p_character,p_target) order by id for update;
 select * into c from public.characters where id=p_character and player_id=auth.uid();
 if not found or public.world_blocked(c.world_id,auth.uid(),'ban') then raise exception 'Character unavailable';end if;
 if exists(select 1 from public.lock_use where character_id=c.id and expires_at>clock_timestamp()) then raise exception 'Finish using the lock first';end if;
 if p_action='pickup' then
  select * into g from public.ground_items where id=p_item and world_id=c.world_id and room_id=c.room_id for update;
  if not found then raise exception 'Item is no longer here';end if;
  s:=public.inventory_slot(c.id,g.kind,g.capacity);if s is null then raise exception 'Inventory limit reached';end if;
  insert into public.character_items(id,character_id,kind,capacity,slot,source_object,key_room) values(g.id,c.id,g.kind,g.capacity,s,g.source_object,g.key_room);delete from public.ground_items where id=g.id;
 else
  select * into i from public.character_items where id=p_item and character_id=c.id for update;
  if not found then raise exception 'Item no longer in your inventory';end if;
  if p_action='give' then
   select * into t from public.characters where id=p_target and player_id<>auth.uid() and world_id=c.world_id and room_id=c.room_id;
   if not found or public.world_blocked(c.world_id,t.player_id,'ban') or not exists(select 1 from public.chat_visits where character_id=t.id and active and seen_at>clock_timestamp()-interval '60 seconds' and room_id=c.room_id) then raise exception 'Choose another player currently in this room';end if;
   s:=public.inventory_slot(t.id,i.kind,i.capacity);if s is null then raise exception 'Their inventory limit is reached';end if;
   update public.character_items set character_id=t.id,slot=s where id=i.id;
  elsif p_action='drop' then
   insert into public.ground_items values(i.id,c.world_id,c.room_id,i.kind,i.capacity,i.source_object,i.key_room);delete from public.character_items where id=i.id;
  elsif p_action='delete' then delete from public.character_items where id=i.id;
  else raise exception 'Invalid inventory action';end if;
 end if;
 insert into public.inventory_requests values(p_request,auth.uid(),c.id,p_item,p_action,p_target);
end $$;
create table public.inventory_batches(id uuid primary key,actor uuid not null,args jsonb not null);
alter table public.inventory_batches enable row level security;
revoke all on public.inventory_batches from anon,authenticated;
create function public.inventory_batch(p_request uuid,p_character uuid,p_items uuid[],p_action text,p_target uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare prior public.inventory_batches;args jsonb;item uuid;first_item public.character_items;
begin
 if auth.uid() is null or p_request is null or p_items is null or cardinality(p_items) not between 1 and 100 or p_action not in('drop','delete','give') then raise exception 'Invalid quantity or action';end if;
 args:=jsonb_build_object('character',p_character,'items',p_items,'action',p_action,'target',p_target);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,83));select * into prior from public.inventory_batches where id=p_request;
 if found then if prior.actor=auth.uid() and prior.args=args then return;else raise exception 'Request ID already used';end if;end if;
 perform 1 from public.characters where id in(p_character,p_target) order by id for update;
 if not exists(select 1 from public.characters where id=p_character and player_id=auth.uid()) then raise exception 'Character unavailable';end if;
 if (select count(distinct x) from unnest(p_items) x)<>cardinality(p_items) or (select count(*) from public.character_items where id=any(p_items) and character_id=p_character)<>cardinality(p_items) then raise exception 'You do not have that quantity available';end if;
 select * into first_item from public.character_items where id=p_items[1];
 if exists(select 1 from public.character_items where id=any(p_items) and (kind<>first_item.kind or capacity<>first_item.capacity or key_room is distinct from first_item.key_room)) then raise exception 'Choose items from one stack';end if;
 foreach item in array p_items loop perform public.inventory_action(gen_random_uuid(),p_character,item,p_action,p_target);end loop;
 insert into public.inventory_batches values(p_request,auth.uid(),args);
end $$;
alter table public.world_doors add column inside_room text;
alter table public.world_doors add column outside_room text;
alter table public.world_doors add column enabled boolean not null default true;
update public.world_doors set inside_room=door_id,outside_room='roomB' where door_id='roomC';
create function public.configure_room_door(p_world text,p_room text,p_outside text,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_world,41));perform public.require_staff(p_world,3);
 if p_enabled is null then raise exception 'Choose a door setting';end if;
 if not exists(select 1 from public.world_locations where world_id=p_world and id=p_room) then raise exception 'Room unavailable';end if;
 if p_enabled and (p_outside is null or p_outside=p_room or not exists(select 1 from public.room_connections where world_id=p_world and from_room=p_room and to_room=p_outside) or not exists(select 1 from public.room_connections where world_id=p_world and from_room=p_outside and to_room=p_room)) then raise exception 'Choose a connected entrance';end if;
 if p_enabled and exists(select 1 from public.room_connections where world_id=p_world and ((from_room=p_room and to_room=p_outside) or (to_room=p_room and from_room=p_outside)) and door_id is not null and door_id<>p_room) then raise exception 'That connection already has another door';end if;
 update public.room_connections set door_id=null where world_id=p_world and door_id=p_room;
 insert into public.world_doors(world_id,door_id,inside_room,outside_room,enabled,locked) values(p_world,p_room,p_room,p_outside,p_enabled,p_enabled)
 on conflict(world_id,door_id) do update set inside_room=excluded.inside_room,outside_room=excluded.outside_room,enabled=excluded.enabled,locked=case when not world_doors.enabled and excluded.enabled then true when not excluded.enabled then false else world_doors.locked end;
 if p_enabled then update public.room_connections set door_id=p_room where world_id=p_world and ((from_room=p_room and to_room=p_outside) or (to_room=p_room and from_room=p_outside));end if;
 insert into public.lock_use(world_id,door_id) values(p_world,p_room) on conflict do nothing;
 update public.lock_use set token=null,player_id=null,character_id=null,expires_at='-infinity' where world_id=p_world and door_id=p_room;
 insert into public.world_moderation(id,world_id,actor,action,reason) values(gen_random_uuid(),p_world,auth.uid(),'configure_door',p_room||case when p_enabled then ': entrance from '||p_outside else ': door disabled' end);
end $$;
create function public.acquire_door_use(p_character uuid,p_door text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.characters;d public.world_doors;t uuid;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid() for update;
 if not found or public.world_blocked(c.world_id,auth.uid(),'ban') then raise exception 'Character unavailable';end if;
 select * into d from public.world_doors where world_id=c.world_id and door_id=p_door and enabled for update;
 if not found or c.room_id<>d.outside_room then raise exception 'Character is not outside this door';end if;
 if not d.locked then raise exception 'The door is unlocked';end if;
 update public.lock_use set player_id=auth.uid(),character_id=c.id,token=gen_random_uuid(),expires_at=clock_timestamp()+interval '30 seconds' where world_id=c.world_id and door_id=p_door and expires_at<=clock_timestamp() returning token into t;return t;
end $$;
create function public.change_door(p_character uuid,p_door text,p_locked boolean,p_token uuid default null,p_item uuid default null,p_key boolean default true) returns boolean language plpgsql security definer set search_path='' as $$
declare c public.characters;d public.world_doors;lease public.lock_use;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid() for update;
 if not found or p_locked is null or public.world_blocked(c.world_id,auth.uid(),'ban') then raise exception 'Character unavailable';end if;
 select * into d from public.world_doors where world_id=c.world_id and door_id=p_door and enabled for update;
 if not found or c.room_id not in(d.inside_room,d.outside_room) then raise exception 'Character is not at this door';end if;
 select * into lease from public.lock_use where world_id=c.world_id and door_id=p_door for update;
 if p_token is not null then
  if p_locked or c.room_id<>d.outside_room or lease.token is distinct from p_token or lease.character_id is distinct from c.id or lease.player_id is distinct from auth.uid() or lease.expires_at<=clock_timestamp() then raise exception 'Lock session ended';end if;
 else
  if lease.expires_at>clock_timestamp() and not(c.room_id=d.inside_room and not p_locked and p_key) then raise exception 'Someone is using the lock.';end if;
  if not p_key or (not p_locked and c.room_id<>d.inside_room) then raise exception 'Use the lock interaction outside';end if;
 end if;
 if p_key then
  if not exists(select 1 from public.character_items where character_id=c.id and kind in('key','room-c-key') and key_room=p_door) then raise exception 'A matching key is required';end if;
 elsif p_token is null or not exists(select 1 from public.character_items where id=p_item and character_id=c.id and kind='lockpick' and capacity>0) then raise exception 'Usable lockpick required';end if;
 update public.world_doors set locked=p_locked where world_id=c.world_id and door_id=p_door;
 update public.lock_use set token=null,player_id=null,character_id=null,expires_at='-infinity' where world_id=c.world_id and door_id=p_door;return p_locked;
end $$;
-- Old clients use the same validation, preserving Room C compatibility.
create or replace function public.acquire_lock_use(p_character uuid) returns uuid language sql security definer set search_path='' as $$ select public.acquire_door_use(p_character,'roomC'); $$;
create or replace function public.change_room_door(p_character uuid,p_locked boolean,p_token uuid default null,p_item uuid default null,p_key boolean default true) returns boolean language sql security definer set search_path='' as $$ select public.change_door(p_character,'roomC',p_locked,p_token,p_item,p_key); $$;
create or replace function public.room_snapshot(p_character uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.characters; result jsonb;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid();
 if not found then raise exception 'Character unavailable'; end if;
 select jsonb_build_object('room_id',c.room_id,'locked',coalesce((select locked from public.world_doors where world_id=c.world_id and door_id='roomC'),false),'doors',coalesce((select jsonb_agg(d) from public.world_doors d where d.world_id=c.world_id and d.enabled),'[]'::jsonb),'characters',coalesce((
 select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'number',n.number) order by n.number,x.id)
 from public.characters x join public.room_chat_numbers n on n.character_id=x.id and n.world_id=x.world_id and n.room_id=x.room_id
 where x.world_id=c.world_id and x.room_id=c.room_id and exists(select 1 from public.chat_visits v where v.character_id=x.id and v.room_id=x.room_id and v.active and v.seen_at>now()-interval '60 seconds')
 ),'[]'::jsonb)) into result;
 return result;
end $$;
create or replace function public.world_map(p_world text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('doors',coalesce((select jsonb_agg(jsonb_build_object('door_id',d.door_id,'inside_room',d.inside_room,'outside_room',d.outside_room,'enabled',d.enabled)) from public.world_doors d where d.world_id=p_world),'[]'::jsonb),'regions',coalesce((select jsonb_agg(r order by r.id) from public.world_regions r where r.world_id=p_world),'[]'::jsonb),'rooms',coalesce((select jsonb_agg(l order by l.id) from public.world_locations l where l.world_id=p_world),'[]'::jsonb),'connections',coalesce((select jsonb_agg(e order by e.from_room,e.to_room) from public.room_connections e where e.world_id=p_world),'[]'::jsonb)) where auth.uid() is not null;
$$;
create or replace function public.pickup_room_object(p_character uuid,p_object uuid) returns public.character_items language plpgsql security definer set search_path='' as $$
declare c public.characters; r public.world_locations; obj jsonb; item public.character_items; item_kind text; item_capacity int; free_slot int;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid() for update;
 if not found or public.world_blocked(c.world_id,auth.uid(),'ban') then raise exception 'Character unavailable';end if;
 select * into item from public.character_items where source_object=p_object and character_id=c.id;
 if found then return item;end if;
 select * into r from public.world_locations where world_id=c.world_id and id=c.room_id for update;
 select x into obj from jsonb_array_elements(r.objects) x where x->>'id'=p_object::text;
 if obj is null or coalesce(obj->>'script','none')='none' then raise exception 'That item is no longer here';end if;
 if obj->>'script'='room-c-key' then item_kind:='key';item_capacity:=100;
 elsif obj->>'script' in('lockpick-full','lockpick-damaged','lockpick-broken') then item_kind:='lockpick';item_capacity:=case obj->>'script' when 'lockpick-full' then 100 when 'lockpick-damaged' then 50 else 0 end;
 else raise exception 'Unknown scripted item';end if;
 free_slot:=public.inventory_slot(c.id,item_kind,item_capacity);
 if free_slot is null then raise exception 'Inventory limit reached for this item';end if;
 insert into public.character_items(character_id,kind,capacity,slot,source_object,key_room) values(c.id,item_kind,item_capacity,free_slot,p_object,case when item_kind='key' then 'roomC' else null end) returning * into item;
 update public.world_locations set objects=coalesce((select jsonb_agg(x) from jsonb_array_elements(objects) x where x->>'id'<>p_object::text),'[]'::jsonb) where world_id=c.world_id and id=c.room_id;
 return item;
end $$;

create function public.admin_spawn_items(p_request uuid,p_world text,p_room text,p_kind text,p_quantity int,p_key_room text default null) returns void language plpgsql security definer set search_path='' as $$
declare args jsonb;prior public.inventory_batches;kind text;cap int;n int;
begin
 perform public.require_staff(p_world);perform pg_advisory_xact_lock(hashtextextended(p_request::text,84));
 args:=jsonb_build_object('world',p_world,'room',p_room,'kind',p_kind,'quantity',p_quantity,'key',p_key_room);
 select * into prior from public.inventory_batches where id=p_request;if found then if prior.actor=auth.uid() and prior.args=args then return;else raise exception 'Request ID already used';end if;end if;
 if p_request is null or p_quantity is null or p_quantity not between 1 and 100 or p_kind is null or p_kind not in('key','lockpick-full','lockpick-damaged','lockpick-broken') then raise exception 'Choose an item and quantity (1–100)';end if;
 if not exists(select 1 from public.world_locations where world_id=p_world and id=p_room) then raise exception 'Room unavailable';end if;
 if p_kind='key' and not exists(select 1 from public.world_doors where world_id=p_world and door_id=p_key_room and enabled) then raise exception 'Choose a configured room door';end if;
 kind:=case when p_kind='key' then 'key' else 'lockpick' end;cap:=case p_kind when 'lockpick-broken' then 0 when 'lockpick-damaged' then 50 else 100 end;
 for n in 1..p_quantity loop insert into public.ground_items(id,world_id,room_id,kind,capacity,key_room) values(gen_random_uuid(),p_world,p_room,kind,cap,case when kind='key' then p_key_room end);end loop;
 insert into public.world_moderation(id,world_id,actor,action,reason) values(p_request,p_world,auth.uid(),'spawn_items',p_quantity||' × '||p_kind||' in '||coalesce((select name from public.world_locations where world_id=p_world and id=p_room),p_room)||case when kind='key' then ' — opens '||coalesce((select name from public.world_locations where world_id=p_world and id=p_key_room),p_key_room) else '' end);
 insert into public.inventory_batches values(p_request,auth.uid(),args);
end $$;
revoke all on function public.inventory_batch(uuid,uuid,uuid[],text,uuid),public.configure_room_door(text,text,text,boolean),public.acquire_door_use(uuid,text),public.change_door(uuid,text,boolean,uuid,uuid,boolean),public.admin_spawn_items(uuid,text,text,text,int,text) from public,anon;
grant execute on function public.inventory_batch(uuid,uuid,uuid[],text,uuid),public.configure_room_door(text,text,text,boolean),public.acquire_door_use(uuid,text),public.change_door(uuid,text,boolean,uuid,uuid,boolean),public.admin_spawn_items(uuid,text,text,text,int,text) to authenticated;
create function public.save_room_settings(p_world text,p_room text,p_name text,p_region text,p_description text,p_objects jsonb,p_image text,p_enabled boolean,p_outside text) returns void language plpgsql security definer set search_path='' as $$ begin
 perform public.save_room(p_world,p_room,p_name,p_region,p_description,p_objects,p_image);
 perform public.configure_room_door(p_world,p_room,p_outside,p_enabled);
end $$;
revoke all on function public.save_room_settings(text,text,text,text,text,jsonb,text,boolean,text) from public,anon;
grant execute on function public.save_room_settings(text,text,text,text,text,jsonb,text,boolean,text) to authenticated;
create function public.audit_room_spawns() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb;
begin
 if auth.uid() is null then return new;end if;
 for item in select x from jsonb_array_elements(new.objects) x where coalesce(x->>'script','none')<>'none' and not exists(select 1 from jsonb_array_elements(old.objects) o where o->>'id'=x->>'id' and o->>'script'=x->>'script') loop
 insert into public.world_moderation(id,world_id,actor,action,reason) values(gen_random_uuid(),new.world_id,auth.uid(),'spawn_items','1 × '||(item->>'script')||' ('||(item->>'name')||') in '||new.name||case when item->>'script'='room-c-key' then ' — opens Room C' else '' end);
 end loop;return new;
end $$;
revoke all on function public.audit_room_spawns() from public,anon;
create trigger audit_room_spawns after update of objects on public.world_locations for each row execute function public.audit_room_spawns();

commit;
