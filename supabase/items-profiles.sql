-- Run after stability-fixes.sql. No existing inventory items are removed.
begin;
-- Inventory slots identify instances; only usable picks have a gameplay cap of three.
alter table public.character_items alter column slot type integer;
alter table public.character_items add column appearance jsonb not null default '{}';
alter table public.ground_items add column appearance jsonb not null default '{}';
alter table public.character_items drop constraint character_items_kind_check;
alter table public.character_items add constraint character_items_kind_check check(kind in('lockpick','room-c-key','key','custom'));
alter table public.character_items drop constraint item_slot_limit;
alter table public.character_items add constraint item_slot_limit check((kind='lockpick' and ((capacity>0 and slot between 1 and 3) or (capacity=0 and slot>=4))) or (kind in('key','room-c-key','custom') and slot>=1));
create or replace function public.inventory_slot(p_character uuid,p_kind text,p_capacity int) returns int language sql stable set search_path='' as $$
 select min(candidate) from (
  select case when p_kind='lockpick' and p_capacity=0 then 4 else 1 end candidate
  union select slot+1 from public.character_items where character_id=p_character and kind=p_kind and slot<2147483647
 ) candidates where candidate>=case when p_kind='lockpick' and p_capacity=0 then 4 else 1 end
 and (p_kind<>'lockpick' or p_capacity=0 or candidate<=3)
 and not exists(select 1 from public.character_items where character_id=p_character and kind=p_kind and slot=candidate);
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('item-images','item-images',false,5242880,array['image/jpeg','image/png','image/webp']),
 ('player-banners','player-banners',false,5242880,array['image/jpeg','image/png','image/webp']);
create function public.can_read_item_image(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and not public.world_blocked(split_part(p_path,'/',1),auth.uid(),'ban') and (public.staff_rank(split_part(p_path,'/',1))>=1 or exists(select 1 from public.world_members m where m.world_id=split_part(p_path,'/',1) and m.player_id=auth.uid()));
$$;
revoke all on function public.can_read_item_image(text) from public,anon;
grant execute on function public.can_read_item_image(text) to authenticated;
create policy "World item image viewing" on storage.objects for select to authenticated using(bucket_id='item-images' and public.can_read_item_image(name));
create policy "Admin item image upload" on storage.objects for insert to authenticated with check(bucket_id='item-images' and public.staff_rank(split_part(name,'/',1))>=1);
create policy "Player banner viewing" on storage.objects for select to authenticated using(bucket_id='player-banners');
create policy "Own banner upload" on storage.objects for insert to authenticated with check(bucket_id='player-banners' and name=auth.uid()::text||'/banner');
create policy "Own banner update" on storage.objects for update to authenticated using(bucket_id='player-banners' and name=auth.uid()::text||'/banner') with check(bucket_id='player-banners' and name=auth.uid()::text||'/banner');
create table public.player_banners(player_id uuid primary key references auth.users(id) on delete cascade, path text not null);
alter table public.player_banners enable row level security;
revoke all on public.player_banners from public,anon,authenticated;
create function public.player_banner(p_user uuid) returns text language sql stable security definer set search_path='' as $$ select path from public.player_banners where player_id=p_user and auth.uid() is not null; $$;
create function public.save_player_banner(p_remove boolean default false) returns void language plpgsql security definer set search_path='' as $$ begin
 if auth.uid() is null or p_remove is null then raise exception 'Sign in required';end if;
 if p_remove then delete from public.player_banners where player_id=auth.uid(); return;end if;
 if not exists(select 1 from storage.objects where bucket_id='player-banners' and name=auth.uid()::text||'/banner') then raise exception 'Upload a banner first';end if;
 insert into public.player_banners values(auth.uid(),auth.uid()::text||'/banner') on conflict(player_id) do update set path=excluded.path;
end $$;
-- Immutable appearance snapshots follow each item through pickup/drop/give.
-- Only admin-authorized entry points call this validator; ordinary players cannot supply metadata.
create function public.item_appearance(p_world text,p_item jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare image text:=nullif(p_item->>'image_path','');icon text:=coalesce(nullif(p_item->>'icon',''),'box');name text:=btrim(coalesce(p_item->>'name',''));description text:=coalesce(p_item->>'description','');
begin
 if p_item is null or jsonb_typeof(p_item)<>'object' or length(name)>80 or length(description)>1000 or icon not in('box','watch','key','tool','bag','book','bottle','gem') then raise exception 'Choose a valid item name, description and icon';end if;
 if image is not null and (split_part(image,'/',1)<>p_world or not exists(select 1 from storage.objects o where o.bucket_id='item-images' and o.name=image)) then raise exception 'Item image unavailable in this world';end if;
 return jsonb_build_object('name',name,'description',description,'icon',icon,'image_path',image);
end $$;
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
  insert into public.character_items(id,character_id,kind,capacity,slot,source_object,key_room,appearance) values(g.id,c.id,g.kind,g.capacity,s,g.source_object,g.key_room,g.appearance);delete from public.ground_items where id=g.id;
 else
  select * into i from public.character_items where id=p_item and character_id=c.id for update;
  if not found then raise exception 'Item no longer in your inventory';end if;
  if p_action='give' then
   select * into t from public.characters where id=p_target and player_id<>auth.uid() and world_id=c.world_id and room_id=c.room_id;
   if not found or public.world_blocked(c.world_id,t.player_id,'ban') or not exists(select 1 from public.chat_visits where character_id=t.id and active and seen_at>clock_timestamp()-interval '60 seconds' and room_id=c.room_id) then raise exception 'Choose another player currently in this room';end if;
   s:=public.inventory_slot(t.id,i.kind,i.capacity);if s is null then raise exception 'Their inventory limit is reached';end if;
   update public.character_items set character_id=t.id,slot=s where id=i.id;
  elsif p_action='drop' then
   insert into public.ground_items(id,world_id,room_id,kind,capacity,source_object,key_room,appearance) values(i.id,c.world_id,c.room_id,i.kind,i.capacity,i.source_object,i.key_room,i.appearance);delete from public.character_items where id=i.id;
  elsif p_action='delete' then delete from public.character_items where id=i.id;
  else raise exception 'Invalid inventory action';end if;
 end if;
 insert into public.inventory_requests values(p_request,auth.uid(),c.id,p_item,p_action,p_target);
end $$;
create or replace function public.inventory_batch(p_request uuid,p_character uuid,p_items uuid[],p_action text,p_target uuid default null) returns void language plpgsql security definer set search_path='' as $$
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
 if exists(select 1 from public.character_items where id=any(p_items) and (kind<>first_item.kind or capacity<>first_item.capacity or key_room is distinct from first_item.key_room or appearance<>first_item.appearance)) then raise exception 'Choose items from one stack';end if;
 foreach item in array p_items loop perform public.inventory_action(gen_random_uuid(),p_character,item,p_action,p_target);end loop;
 insert into public.inventory_batches values(p_request,auth.uid(),args);
end $$;
create or replace function public.save_room(p_world text,p_room text,p_name text,p_region text,p_description text,p_objects jsonb,p_image text default null) returns void language plpgsql security definer set search_path='' as $$
declare region text; item jsonb; normalized jsonb:='[]'; seen_ids text[]:='{}'; object_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_world,41));perform public.require_staff(p_world,2);
 if p_name is null or p_region is null or p_description is null or length(btrim(p_name)) not between 1 and 80 or length(btrim(p_region)) not between 1 and 80 or length(p_description)>4000 then raise exception 'Room/region names: 1–80 characters; description: up to 4000';end if;
 if p_objects is null or jsonb_typeof(p_objects)<>'array' or jsonb_array_length(p_objects)>20 then raise exception 'Up to 20 objects per room';end if;
 for item in select * from jsonb_array_elements(p_objects) loop
 if length(btrim(item->>'name')) not between 1 and 80 or item->>'name' is null or length(coalesce(item->>'description',''))>1000 then raise exception 'Object name: 1–80 characters; description: up to 1000';end if;
 if coalesce(item->>'script','none') not in('none','lockpick-full','lockpick-damaged','lockpick-broken','room-c-key','custom') then raise exception 'Unknown scripted item';end if;
 object_id:=coalesce((item->>'id')::uuid,gen_random_uuid());
 if object_id::text=any(seen_ids) then raise exception 'Duplicate object ID';end if;seen_ids:=array_append(seen_ids,object_id::text);
 if exists(select 1 from public.character_items where source_object=object_id) or exists(select 1 from public.consumed_room_objects where id=object_id) then continue;end if;
 normalized:=normalized||jsonb_build_array(jsonb_build_object('id',object_id,'name',btrim(item->>'name'),'description',coalesce(item->>'description',''),'script',coalesce(item->>'script','none')) || public.item_appearance(p_world,item));
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
 if exists(select 1 from public.lock_use where character_id=c.id and expires_at>clock_timestamp()) then raise exception 'Finish using the lock first';end if;
 select * into r from public.world_locations where world_id=c.world_id and id=c.room_id for update;
 select x into obj from jsonb_array_elements(r.objects) x where x->>'id'=p_object::text;
 if obj is null or coalesce(obj->>'script','none')='none' then raise exception 'That item is no longer here';end if;
 if obj->>'script'='custom' then item_kind:='custom';item_capacity:=100;
 elsif obj->>'script'='room-c-key' then item_kind:='key';item_capacity:=100;
 elsif obj->>'script' in('lockpick-full','lockpick-damaged','lockpick-broken') then item_kind:='lockpick';item_capacity:=case obj->>'script' when 'lockpick-full' then 100 when 'lockpick-damaged' then 50 else 0 end;
 else raise exception 'Unknown scripted item';end if;
 free_slot:=public.inventory_slot(c.id,item_kind,item_capacity);
 if free_slot is null then raise exception 'Inventory limit reached for this item';end if;
 insert into public.character_items(character_id,kind,capacity,slot,source_object,key_room,appearance) values(c.id,item_kind,item_capacity,free_slot,p_object,case when item_kind='key' then 'roomC' else null end,public.item_appearance(c.world_id,obj)) returning * into item;
 update public.world_locations set objects=coalesce((select jsonb_agg(x) from jsonb_array_elements(objects) x where x->>'id'<>p_object::text),'[]'::jsonb) where world_id=c.world_id and id=c.room_id;
 return item;
end $$;

create function public.admin_issue_items(p_request uuid,p_world text,p_room text,p_character uuid,p_kind text,p_quantity int,p_key_room text default null,p_item jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$
declare args jsonb;prior public.inventory_batches;kind text;cap int;n int;slot int;appearance jsonb;c public.characters;destination text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_world,41));perform public.require_staff(p_world);
 if p_request is null then raise exception 'Request ID required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,84));
 args:=jsonb_build_object('operation','issue_items','world',p_world,'room',p_room,'character',p_character,'kind',p_kind,'quantity',p_quantity,'key',p_key_room,'item',p_item);
 select * into prior from public.inventory_batches where id=p_request;
 if found then if prior.actor=auth.uid() and prior.args=args then return;else raise exception 'Request ID already used';end if;end if;
 if p_quantity is null or p_quantity not between 1 and 100 or p_kind is null or p_kind not in('key','lockpick-full','lockpick-damaged','lockpick-broken','custom') then raise exception 'Choose an item and quantity (1–100 per delivery)';end if;
 if (p_room is null)=(p_character is null) then raise exception 'Choose a room or a character';end if;
 if p_character is not null then
  select * into c from public.characters where id=p_character and world_id=p_world for update;
  if not found or public.world_blocked(p_world,c.player_id,'ban') then raise exception 'Character unavailable in this world';end if;
  destination:='inventory of '||c.name;
 else
  select 'room '||name into destination from public.world_locations where world_id=p_world and id=p_room;
  if not found then raise exception 'Room unavailable';end if;
 end if;
 if p_kind='key' and not exists(select 1 from public.world_doors where world_id=p_world and door_id=p_key_room and enabled) then raise exception 'Choose a configured room door';end if;
 appearance:=public.item_appearance(p_world,p_item);
 if p_kind='custom' and length(appearance->>'name')=0 then raise exception 'Enter a custom item name';end if;
 kind:=case when p_kind in('key','custom') then p_kind else 'lockpick' end;
 cap:=case p_kind when 'lockpick-broken' then 0 when 'lockpick-damaged' then 50 else 100 end;
 for n in 1..p_quantity loop
  if p_character is null then
   insert into public.ground_items(id,world_id,room_id,kind,capacity,key_room,appearance) values(gen_random_uuid(),p_world,p_room,kind,cap,case when kind='key' then p_key_room end,appearance);
  else
   slot:=public.inventory_slot(c.id,kind,cap);
   if slot is null then raise exception 'That character already has three usable lockpicks. No items were delivered';end if;
   insert into public.character_items(character_id,kind,capacity,slot,key_room,appearance) values(c.id,kind,cap,slot,case when kind='key' then p_key_room end,appearance);
  end if;
 end loop;
 insert into public.world_moderation(id,world_id,actor,target,action,reason) values(p_request,p_world,auth.uid(),c.player_id,case when p_character is null then 'spawn_items' else 'give_items' end,p_quantity||' × '||coalesce(nullif(appearance->>'name',''),p_kind)||' → '||destination||case when p_kind='key' then ' · key for '||p_key_room else '' end);
 insert into public.inventory_batches values(p_request,auth.uid(),args);
end $$;
revoke all on function public.item_appearance(text,jsonb) from public,anon,authenticated;
revoke all on function public.admin_issue_items(uuid,text,text,uuid,text,int,text,jsonb),public.player_banner(uuid),public.save_player_banner(boolean) from public,anon;
grant execute on function public.admin_issue_items(uuid,text,text,uuid,text,int,text,jsonb),public.player_banner(uuid),public.save_player_banner(boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
