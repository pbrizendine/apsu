begin;
-- Keep broken picks outside the three usable slots.
alter table public.character_items drop constraint item_slot_limit;
with broken as (select id, 3+row_number() over(partition by character_id order by id) n from public.character_items where kind='lockpick' and capacity=0)
update public.character_items i set slot=b.n from broken b where i.id=b.id;
alter table public.character_items add constraint item_slot_limit check ((kind='lockpick' and ((capacity>0 and slot between 1 and 3) or (capacity=0 and slot>=4))) or (kind='room-c-key' and slot=1));
create table public.consumed_room_objects(id uuid primary key);
insert into public.consumed_room_objects select source_object from public.character_items where source_object is not null on conflict do nothing;
alter table public.consumed_room_objects enable row level security;
create function public.remember_item_source() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if old.source_object is not null then insert into public.consumed_room_objects values(old.source_object) on conflict do nothing;end if;return old;
end $$;
create trigger remember_item_source before delete on public.character_items for each row execute function public.remember_item_source();
create table public.ground_items(id uuid primary key,world_id text not null references public.worlds(id),room_id text not null,kind text not null,capacity smallint not null,source_object uuid);
create table public.inventory_requests(id uuid primary key,actor uuid not null,character_id uuid not null,item_id uuid not null,action text not null,target uuid);
alter table public.ground_items enable row level security;
alter table public.inventory_requests enable row level security;
revoke all on public.ground_items,public.inventory_requests,public.consumed_room_objects from anon,authenticated;
create function public.inventory_slot(p_character uuid,p_kind text,p_capacity int) returns int language sql stable set search_path='' as $$
 select s from generate_series(case when p_kind='lockpick' and p_capacity=0 then 4 else 1 end,case when p_kind='lockpick' then case when p_capacity=0 then 32767 else 3 end else 1 end) s where not exists(select 1 from public.character_items i where i.character_id=p_character and i.kind=p_kind and i.slot=s) order by s limit 1;
$$;
create or replace function public.wear_lockpick_item(p_item uuid,p_capacity integer) returns public.character_items language plpgsql security definer set search_path='' as $$
declare item public.character_items;owner_id uuid;
begin
 if p_capacity is null or p_capacity not in(0,50) then raise exception 'Invalid wear';end if;
 select character_id into owner_id from public.character_items where id=p_item;
 perform 1 from public.characters where id=owner_id and player_id=auth.uid() for update;
 if not found then raise exception 'Lockpick unavailable';end if;
 select * into item from public.character_items where id=p_item and character_id=owner_id and kind='lockpick' for update;
 if not found then raise exception 'Lockpick unavailable';end if;
 update public.character_items set capacity=least(capacity,p_capacity),slot=case when p_capacity=0 and capacity>0 then public.inventory_slot(owner_id,'lockpick',0) else slot end where id=p_item returning * into item;return item;
end $$;
create function public.inventory_action(p_request uuid,p_character uuid,p_item uuid,p_action text,p_target uuid default null) returns void language plpgsql security definer set search_path='' as $$
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
  insert into public.character_items(id,character_id,kind,capacity,slot,source_object) values(g.id,c.id,g.kind,g.capacity,s,g.source_object);delete from public.ground_items where id=g.id;
 else
  select * into i from public.character_items where id=p_item and character_id=c.id for update;
  if not found then raise exception 'Item no longer in your inventory';end if;
  if p_action='give' then
   select * into t from public.characters where id=p_target and player_id<>auth.uid() and world_id=c.world_id and room_id=c.room_id;
   if not found or public.world_blocked(c.world_id,t.player_id,'ban') or not exists(select 1 from public.chat_visits where character_id=t.id and active and seen_at>clock_timestamp()-interval '60 seconds' and room_id=c.room_id) then raise exception 'Choose another player currently in this room';end if;
   s:=public.inventory_slot(t.id,i.kind,i.capacity);if s is null then raise exception 'Their inventory limit is reached';end if;
   update public.character_items set character_id=t.id,slot=s where id=i.id;
  elsif p_action='drop' then
   insert into public.ground_items values(i.id,c.world_id,c.room_id,i.kind,i.capacity,i.source_object);delete from public.character_items where id=i.id;
  elsif p_action='delete' then delete from public.character_items where id=i.id;
  else raise exception 'Invalid inventory action';end if;
 end if;
 insert into public.inventory_requests values(p_request,auth.uid(),c.id,p_item,p_action,p_target);
end $$;
create function public.room_ground_items(p_character uuid) returns setof public.ground_items language sql stable security definer set search_path='' as $$
 select g.* from public.ground_items g join public.characters c on c.world_id=g.world_id and c.room_id=g.room_id where c.id=p_character and c.player_id=auth.uid() and not public.world_blocked(c.world_id,auth.uid(),'ban');
$$;
create table public.world_map_images(world_id text primary key references public.worlds(id),image_path text not null);
alter table public.world_map_images enable row level security;
grant select on public.world_map_images to authenticated;
create policy "Signed in map viewing" on public.world_map_images for select to authenticated using(true);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('world-maps','world-maps',false,5242880,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;
create policy "View map images" on storage.objects for select to authenticated using(bucket_id='world-maps');
create policy "Lead admin map upload" on storage.objects for insert to authenticated with check(bucket_id='world-maps' and public.staff_rank((storage.foldername(name))[1])>=2);
create function public.save_world_map_image(p_world text,p_path text) returns void language plpgsql security definer set search_path='' as $$ begin
 perform public.require_staff(p_world,2);
 if split_part(p_path,'/',1)<>p_world or not exists(select 1 from storage.objects where bucket_id='world-maps' and name=p_path) then raise exception 'Map image unavailable';end if;
 insert into public.world_map_images values(p_world,p_path) on conflict(world_id) do update set image_path=excluded.image_path;
end $$;
revoke all on function public.inventory_slot(uuid,text,int),public.remember_item_source(),public.inventory_action(uuid,uuid,uuid,text,uuid),public.room_ground_items(uuid),public.save_world_map_image(text,text) from public,anon;
grant execute on function public.inventory_action(uuid,uuid,uuid,text,uuid),public.room_ground_items(uuid),public.save_world_map_image(text,text) to authenticated;
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
 if (exists(select 1 from public.character_items where source_object=object_id) or exists(select 1 from public.consumed_room_objects where id=object_id)) then continue;end if;
 normalized:=normalized||jsonb_build_array(jsonb_build_object('id',object_id,'name',btrim(item->>'name'),'description',coalesce(item->>'description',''),'script',coalesce(item->>'script','none')));
 end loop;
 if p_image is not null and (split_part(p_image,'/',1)<>p_world or not exists(select 1 from storage.objects where bucket_id='room-images' and name=p_image)) then raise exception 'Room image unavailable';end if;
 select region_id into region from public.world_locations where world_id=p_world and id=p_room for update;
 if not found then raise exception 'Room not found';end if;
 update public.world_regions set name=btrim(p_region) where world_id=p_world and id=region;
 update public.world_locations set name=btrim(p_name),description=p_description,objects=normalized,image_path=p_image where world_id=p_world and id=p_room;
 insert into public.world_moderation(id,world_id,actor,action,reason) values(gen_random_uuid(),p_world,auth.uid(),'edit_room',p_room||': '||p_name);
end $$;

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
 if obj->>'script'='room-c-key' then item_kind:='room-c-key';item_capacity:=100;
 elsif obj->>'script' in('lockpick-full','lockpick-damaged','lockpick-broken') then item_kind:='lockpick';item_capacity:=case obj->>'script' when 'lockpick-full' then 100 when 'lockpick-damaged' then 50 else 0 end;
 else raise exception 'Unknown scripted item';end if;
 free_slot:=public.inventory_slot(c.id,item_kind,item_capacity);
 if free_slot is null then raise exception 'Inventory limit reached for this item';end if;
 insert into public.character_items(character_id,kind,capacity,slot,source_object) values(c.id,item_kind,item_capacity,free_slot,p_object) returning * into item;
 update public.world_locations set objects=coalesce((select jsonb_agg(x) from jsonb_array_elements(objects) x where x->>'id'<>p_object::text),'[]'::jsonb) where world_id=c.world_id and id=c.room_id;
 return item;
end $$;

commit;
