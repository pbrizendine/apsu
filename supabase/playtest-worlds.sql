-- World tools and profile scope. Apply after playtest-chat.sql.
begin;
create table if not exists public.world_members(world_id text references public.worlds(id),player_id uuid references auth.users(id),joined_at timestamptz not null default clock_timestamp(),primary key(world_id,player_id));
alter table public.world_members enable row level security;
revoke all on public.world_members from public,anon,authenticated;
insert into public.world_members(world_id,player_id,joined_at) select world_id,player_id,min(created_at) from public.characters group by world_id,player_id on conflict do nothing;
create or replace function public.record_world_member() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into public.world_members(world_id,player_id,joined_at) values(new.world_id,new.player_id,new.created_at) on conflict do nothing;return new;
end $$;
drop trigger if exists record_world_member on public.characters;
create trigger record_world_member after insert on public.characters for each row execute function public.record_world_member();
create or replace function public.join_world(p_world text) returns void language plpgsql security definer set search_path='' as $$ begin
 if auth.uid() is null or public.world_blocked(p_world,auth.uid(),'ban') then raise exception 'World unavailable';end if;
 insert into public.world_members(world_id,player_id) values(p_world,auth.uid()) on conflict do nothing;
end $$;

alter table public.world_locations add column if not exists owner_character uuid references public.characters(id) on delete set null;
create or replace function public.world_character_directory(p_world text) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 perform public.require_staff(p_world);
 return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'player_id',c.player_id,'player_name',coalesce(u.raw_user_meta_data->>'username','Player'),'room_id',c.room_id,'room_name',l.name,'online',exists(select 1 from public.chat_visits v where v.character_id=c.id and v.room_id=c.room_id and v.active and v.seen_at>now()-interval '60 seconds')) order by c.name,c.id) from public.characters c join auth.users u on u.id=c.player_id join public.world_locations l on l.world_id=c.world_id and l.id=c.room_id where c.world_id=p_world),'[]'::jsonb);
end $$;
create or replace function public.set_room_owner(p_world text,p_room text,p_character uuid default null) returns void language plpgsql security definer set search_path='' as $$ begin
 perform pg_advisory_xact_lock(hashtextextended(p_world,41));perform public.require_staff(p_world);
 if p_character is not null and not exists(select 1 from public.characters where id=p_character and world_id=p_world) then raise exception 'Choose a character from this world';end if;
 update public.world_locations set owner_character=p_character where world_id=p_world and id=p_room;
 if not found then raise exception 'Room unavailable';end if;
 insert into public.world_moderation(id,world_id,actor,action,reason) values(gen_random_uuid(),p_world,auth.uid(),'room_owner',p_room||': '||coalesce(p_character::text,'unassigned'));
end $$;
create or replace function public.edit_owned_room(p_character uuid,p_room text,p_description text,p_image text) returns void language plpgsql security definer set search_path='' as $$
declare c public.characters;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid();
 if not found or public.world_blocked(c.world_id,auth.uid(),'ban') then raise exception 'Character unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(c.world_id,41));
 if p_description is null or length(p_description)>4000 then raise exception 'Use up to 4000 characters';end if;
 if p_image is not null and (split_part(p_image,'/',1)<>c.world_id or not exists(select 1 from storage.objects where bucket_id='room-images' and name=p_image)) then raise exception 'Image unavailable';end if;
 update public.world_locations set description=p_description,image_path=p_image where world_id=c.world_id and id=p_room and owner_character=c.id;
 if not found then raise exception 'This character does not own this room';end if;
end $$;
create or replace function public.can_upload_room_image(p_name text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (public.staff_rank(split_part(p_name,'/',1))>=2 or exists(select 1 from public.world_locations l join public.characters c on c.id=l.owner_character where l.world_id=split_part(p_name,'/',1) and l.id=split_part(p_name,'/',2) and c.player_id=auth.uid() and not public.world_blocked(l.world_id,auth.uid(),'ban')));
$$;
alter policy "Owner room image upload" on storage.objects with check(bucket_id='room-images' and public.can_upload_room_image(name));

create or replace function public.connect_world_rooms(p_world text,p_from text,p_to text,p_connected boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_world,41));perform public.require_staff(p_world,2);
 if p_connected is null or p_from=p_to or (select count(*) from public.world_locations where world_id=p_world and id in(p_from,p_to))<>2 then raise exception 'Choose two different rooms in this world';end if;
 if p_connected then
  insert into public.room_connections(world_id,from_room,to_room) values(p_world,p_from,p_to),(p_world,p_to,p_from) on conflict do nothing;
 else
  if exists(select 1 from public.room_connections e join public.world_doors d on d.world_id=e.world_id and d.door_id=e.door_id where e.world_id=p_world and e.from_room in(p_from,p_to) and e.to_room in(p_from,p_to) and d.enabled) then raise exception 'Disable the passage’s door before removing this connection';end if;
  if exists(select 1 from public.world_locations l where l.world_id=p_world and l.id in(p_from,p_to) and not exists(select 1 from public.room_connections e where e.world_id=p_world and e.from_room=l.id and e.to_room not in(p_from,p_to))) then raise exception 'Keep at least one exit for each room';end if;
  delete from public.room_connections where world_id=p_world and from_room in(p_from,p_to) and to_room in(p_from,p_to);
 end if;
 insert into public.world_moderation(id,world_id,actor,action,reason) values(gen_random_uuid(),p_world,auth.uid(),'room_connection',p_from||' ↔ '||p_to||case when p_connected then ': connected' else ': removed' end);
end $$;
create or replace function public.admin_teleport(p_character uuid,p_to text) returns text language plpgsql security definer set search_path='' as $$
declare c public.characters;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid();
 if not found then raise exception 'Choose your own character';end if;
 perform pg_advisory_xact_lock(hashtextextended(c.world_id,41));perform public.require_staff(c.world_id);
 select * into c from public.characters where id=p_character and player_id=auth.uid() for update;
 if not exists(select 1 from public.world_locations where world_id=c.world_id and id=p_to) then raise exception 'Room unavailable';end if;
 if c.room_id=p_to then return p_to;end if;
 perform public.room_departure(c.id,p_to);
 update public.characters set room_id=p_to where id=c.id;
 update public.chat_visits set active=false,typing_until='-infinity' where character_id=c.id and active;
 update public.lock_use set token=null,player_id=null,character_id=null,expires_at='-infinity' where character_id=c.id;
 insert into public.world_moderation(id,world_id,actor,action,reason) values(gen_random_uuid(),c.world_id,auth.uid(),'teleport',c.name||': '||c.room_id||' → '||p_to);
 return p_to;
end $$;

-- Decorative badges never grant admin rights. Platform badge writes are founder-only.
create table if not exists public.world_badge_definitions(id uuid primary key,world_id text not null references public.worlds(id),name text not null check(length(name) between 1 and 60),color text not null check(color ~ '^#[0-9a-fA-F]{6}$'),description text not null default '' check(length(description)<=200),unique(world_id,name),unique(world_id,id));
create table if not exists public.world_player_badges(world_id text,player_id uuid references auth.users(id),badge_id uuid,primary key(world_id,player_id,badge_id),foreign key(world_id,badge_id) references public.world_badge_definitions(world_id,id) on delete cascade);
alter table public.world_badge_definitions enable row level security;
alter table public.world_player_badges enable row level security;
revoke all on public.world_badge_definitions,public.world_player_badges from public,anon,authenticated;
create or replace function public.world_badge_editor(p_world text) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 perform public.require_staff(p_world);
 return jsonb_build_object('definitions',coalesce((select jsonb_agg(b order by b.name) from public.world_badge_definitions b where world_id=p_world),'[]'::jsonb),'awards',coalesce((select jsonb_agg(b) from public.world_player_badges b where world_id=p_world),'[]'::jsonb));
end $$;
create or replace function public.save_world_badge(p_id uuid,p_world text,p_name text,p_color text,p_description text) returns void language plpgsql security definer set search_path='' as $$ begin
 perform pg_advisory_xact_lock(hashtextextended(p_world,41));perform public.require_staff(p_world);
 if p_id is null or p_name is null or length(btrim(p_name)) not between 1 and 60 or p_color is null or p_color !~ '^#[0-9a-fA-F]{6}$' or length(coalesce(p_description,''))>200 then raise exception 'Enter a badge name, color and description';end if;
 if lower(p_name) ~ '(apsu|founder|admin|owner|staff|moderator)' then raise exception 'That name is reserved for official roles';end if;
 if exists(select 1 from public.world_badge_definitions where id=p_id and world_id<>p_world) then raise exception 'Badge belongs to another world';end if;
 insert into public.world_badge_definitions values(p_id,p_world,btrim(p_name),p_color,coalesce(p_description,'')) on conflict(id) do update set name=excluded.name,color=excluded.color,description=excluded.description;
 insert into public.world_moderation(id,world_id,actor,action,reason) values(gen_random_uuid(),p_world,auth.uid(),'edit_badge',btrim(p_name));
end $$;
create or replace function public.award_world_badge(p_world text,p_badge uuid,p_player uuid,p_award boolean) returns void language plpgsql security definer set search_path='' as $$ begin
 perform pg_advisory_xact_lock(hashtextextended(p_world,41));perform public.require_staff(p_world);
 if p_award is null or not exists(select 1 from public.world_badge_definitions where id=p_badge and world_id=p_world) or not exists(select 1 from public.world_members where world_id=p_world and player_id=p_player) then raise exception 'Choose a badge and a member of this world';end if;
 if p_award then insert into public.world_player_badges values(p_world,p_player,p_badge) on conflict do nothing;
 else delete from public.world_player_badges where world_id=p_world and player_id=p_player and badge_id=p_badge;end if;
 insert into public.world_moderation(id,world_id,actor,target,action,reason) values(gen_random_uuid(),p_world,auth.uid(),p_player,case when p_award then 'award_badge' else 'remove_badge' end,p_badge::text);
end $$;
-- Existing global badge table remains protected; world admins receive no write access.
create or replace function public.player_profile_extras(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('photo_path',(select photo_path from public.player_appearance where player_id=p_user),'badges',coalesce((select jsonb_agg(badge order by badge) from public.player_badges where player_id=p_user),'[]'::jsonb)) where auth.uid() is not null;
$$;
create or replace function public.player_world_profile(p_world text,p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('world_name',(select name from public.worlds where id=p_world),'joined_at',(select joined_at from public.world_members where world_id=p_world and player_id=p_user),
 'badges',coalesce((select jsonb_agg(jsonb_build_object('name',replace(role,'Server Owner','World Owner'),'color','#479663','description','World role') order by case role when 'Server Owner' then 3 when 'Lead Admin' then 2 else 1 end desc) from public.world_staff where world_id=p_world and player_id=p_user),'[]'::jsonb)||coalesce((select jsonb_agg(jsonb_build_object('name',b.name,'color',b.color,'description',b.description) order by b.name) from public.world_player_badges a join public.world_badge_definitions b on b.id=a.badge_id where a.world_id=p_world and a.player_id=p_user),'[]'::jsonb))
 where auth.uid() is not null and exists(select 1 from public.world_members where world_id=p_world and player_id=auth.uid());
$$;

alter table public.character_profiles add column if not exists avatar_framing jsonb not null default '{"zoom":1,"x":0.5,"y":0.5}';
create or replace function public.can_view_character(p_character uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.characters c where c.id=p_character and (c.player_id=auth.uid() or exists(select 1 from public.chat_visits mine where mine.player_id=auth.uid() and mine.world_id=c.world_id and mine.room_id=c.room_id and mine.active and mine.seen_at>now()-interval '60 seconds' and exists(select 1 from public.chat_visits theirs where theirs.character_id=c.id and theirs.room_id=c.room_id and theirs.active and theirs.seen_at>now()-interval '60 seconds'))));
$$;
create or replace function public.character_profile(p_character uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'name',c.name,'world_id',c.world_id,'player_id',c.player_id,'is_owner',c.player_id=auth.uid(),'description',coalesce(p.description,''),'avatar_id',p.avatar_id,'avatar_framing',coalesce(p.avatar_framing,'{"zoom":1,"x":0.5,"y":0.5}'::jsonb),'images',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'path',i.path,'title',i.title) order by i.created_at,i.id) from public.character_images i where i.character_id=c.id),'[]'::jsonb)) from public.characters c left join public.character_profiles p on p.character_id=c.id where c.id=p_character and public.can_view_character(c.id);
$$;
create or replace function public.can_read_character_image(p_path text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.character_images i where i.path=p_path and public.can_view_character(i.character_id)); $$;
alter policy "Character image read" on storage.objects using(bucket_id='character-images' and public.can_read_character_image(name));
revoke all on function public.can_read_character_image(text) from public,anon;
grant execute on function public.can_read_character_image(text) to authenticated;
create or replace function public.set_character_portrait(p_character uuid,p_image uuid,p_zoom numeric,p_x numeric,p_y numeric) returns void language plpgsql security definer set search_path='' as $$ begin
 if p_zoom is null or p_x is null or p_y is null or p_zoom not between 1 and 4 or p_x not between 0 and 1 or p_y not between 0 and 1 then raise exception 'Invalid portrait framing';end if;
 perform public.set_character_avatar(p_character,p_image);
 update public.character_profiles set avatar_framing=jsonb_build_object('zoom',p_zoom,'x',p_x,'y',p_y) where character_id=p_character;
end $$;
create or replace function public.room_snapshot(p_character uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.characters;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid();
 if not found then raise exception 'Character unavailable';end if;
 return jsonb_build_object('room_id',c.room_id,'doors',coalesce((select jsonb_agg(d) from public.world_doors d where d.world_id=c.world_id and d.enabled),'[]'::jsonb),
 'characters',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'player_id',x.player_id,'name',x.name,'number',n.number,'portrait',i.path,'framing',p.avatar_framing,'typing',exists(select 1 from public.chat_visits tv where tv.character_id=x.id and tv.room_id=x.room_id and tv.active and tv.typing_until>clock_timestamp())) order by n.number,x.id)
 from public.characters x join public.room_chat_numbers n on n.character_id=x.id and n.world_id=x.world_id and n.room_id=x.room_id
 left join public.character_profiles p on p.character_id=x.id left join public.character_images i on i.id=p.avatar_id
 where x.world_id=c.world_id and x.room_id=c.room_id and exists(select 1 from public.chat_visits v where v.character_id=x.id and v.room_id=x.room_id and v.active and v.seen_at>now()-interval '60 seconds')),'[]'::jsonb));
end $$;
revoke all on function public.record_world_member() from public,anon,authenticated;
revoke all on function public.join_world(text),public.world_character_directory(text),public.set_room_owner(text,text,uuid),public.edit_owned_room(uuid,text,text,text),public.can_upload_room_image(text),public.connect_world_rooms(text,text,text,boolean),public.admin_teleport(uuid,text),public.world_badge_editor(text),public.save_world_badge(uuid,text,text,text,text),public.award_world_badge(text,uuid,uuid,boolean),public.player_world_profile(text,uuid),public.can_view_character(uuid),public.set_character_portrait(uuid,uuid,numeric,numeric,numeric) from public,anon;
grant execute on function public.join_world(text),public.world_character_directory(text),public.set_room_owner(text,text,uuid),public.edit_owned_room(uuid,text,text,text),public.can_upload_room_image(text),public.connect_world_rooms(text,text,text,boolean),public.admin_teleport(uuid,text),public.world_badge_editor(text),public.save_world_badge(uuid,text,text,text,text),public.award_world_badge(text,uuid,uuid,boolean),public.player_world_profile(text,uuid),public.can_view_character(uuid),public.set_character_portrait(uuid,uuid,numeric,numeric,numeric) to authenticated;
create or replace function public.save_room(p_world text,p_room text,p_name text,p_region text,p_description text,p_objects jsonb,p_image text default null) returns void language plpgsql security definer set search_path='' as $$
declare region text; item jsonb; normalized jsonb:='[]'; seen_ids text[]:='{}'; object_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_world,41));perform public.require_staff(p_world,2);
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
create or replace function public.configure_room_door(p_world text,p_room text,p_outside text,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_world,41));perform public.require_staff(p_world,2);
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
create or replace function public.create_owned_world_room(p_request uuid,p_world text,p_anchor text,p_direction text,p_name text,p_description text,p_owner uuid default null) returns text language plpgsql security definer set search_path='' as $$
declare room text;
begin
 room:=public.create_world_room(p_request,p_world,p_anchor,p_direction,p_name,p_description);
 perform public.set_room_owner(p_world,room,p_owner);return room;
end $$;
revoke all on function public.create_owned_world_room(uuid,text,text,text,text,text,uuid) from public,anon;
grant execute on function public.create_owned_world_room(uuid,text,text,text,text,text,uuid) to authenticated;
create or replace function public.save_room_details(p_world text,p_room text,p_name text,p_region text,p_description text,p_objects jsonb,p_image text,p_enabled boolean,p_outside text,p_owner uuid default null) returns void language plpgsql security definer set search_path='' as $$ begin
 perform public.save_room_settings(p_world,p_room,p_name,p_region,p_description,p_objects,p_image,p_enabled,p_outside);
 perform public.set_room_owner(p_world,p_room,p_owner);
end $$;
revoke all on function public.save_room_details(text,text,text,text,text,jsonb,text,boolean,text,uuid) from public,anon;
grant execute on function public.save_room_details(text,text,text,text,text,jsonb,text,boolean,text,uuid) to authenticated;
commit;
