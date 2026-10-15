begin;
create table public.character_profiles(character_id uuid primary key references public.characters(id) on delete cascade, description text not null default '' check(length(description)<=4000), avatar_id uuid);
create table public.character_images(id uuid primary key default gen_random_uuid(),character_id uuid not null references public.characters(id) on delete cascade,path text not null unique,title text not null check(length(title) between 1 and 100),created_at timestamptz not null default now());
alter table public.character_profiles add foreign key(avatar_id) references public.character_images(id) on delete set null;
alter table public.character_profiles enable row level security;
alter table public.character_images enable row level security;
revoke all on public.character_profiles,public.character_images from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('character-images','character-images',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy "Character image upload by owner" on storage.objects for insert to authenticated with check(bucket_id='character-images' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.characters c where c.id::text=(storage.foldername(storage.objects.name))[2] and c.player_id=auth.uid()));
create policy "Character image read" on storage.objects for select to authenticated using(bucket_id='character-images');
create policy "Character image removal by owner" on storage.objects for delete to authenticated using(bucket_id='character-images' and (storage.foldername(name))[1]=auth.uid()::text);
create function public.character_profile(p_character uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'name',c.name,'world_id',c.world_id,'player_id',c.player_id,'is_owner',c.player_id=auth.uid(),'description',coalesce(p.description,''),'avatar_id',p.avatar_id,'images',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'path',i.path,'title',i.title) order by i.created_at,i.id) from public.character_images i where i.character_id=c.id),'[]'::jsonb)) from public.characters c left join public.character_profiles p on p.character_id=c.id where c.id=p_character and auth.uid() is not null;
$$;
create function public.save_character_description(p_character uuid,p_description text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.characters where id=p_character and player_id=auth.uid() for update;
 if not found then raise exception 'Only the character owner can edit this profile'; end if;
 if p_description is null or length(p_description)>4000 then raise exception 'Use up to 4000 characters'; end if;
 insert into public.character_profiles(character_id,description) values(p_character,p_description) on conflict(character_id) do update set description=excluded.description;
end $$;
create function public.add_character_image(p_character uuid,p_path text,p_title text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform 1 from public.characters where id=p_character and player_id=auth.uid() for update;
 if not found then raise exception 'Only the character owner can upload images'; end if;
 if p_title is null or length(btrim(p_title)) not between 1 and 100 then raise exception 'Image title must be 1 to 100 characters'; end if;
 if p_path is null or split_part(p_path,'/',1)<>auth.uid()::text or split_part(p_path,'/',2)<>p_character::text or not exists(select 1 from storage.objects where bucket_id='character-images' and name=p_path) then raise exception 'Uploaded image not found'; end if;
 select id into result from public.character_images where path=p_path and character_id=p_character;
 if result is not null then return result; end if;
 if (select count(*) from public.character_images where character_id=p_character)>=20 then raise exception 'Maximum 20 images per character'; end if;
 insert into public.character_images(character_id,path,title) values(p_character,p_path,btrim(p_title)) returning id into result;
 return result;
end $$;
create function public.set_character_avatar(p_character uuid,p_image uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.characters where id=p_character and player_id=auth.uid() for update;
 if not found then raise exception 'Only the character owner can change the portrait'; end if;
 if p_image is not null and not exists(select 1 from public.character_images where id=p_image and character_id=p_character) then raise exception 'Choose an image from this character'; end if;
 insert into public.character_profiles(character_id,avatar_id) values(p_character,p_image) on conflict(character_id) do update set avatar_id=excluded.avatar_id;
end $$;
create function public.remove_character_image(p_character uuid,p_image uuid) returns text language plpgsql security definer set search_path='' as $$
declare result text;
begin
 perform 1 from public.characters where id=p_character and player_id=auth.uid() for update;
 if not found then raise exception 'Only the character owner can remove images'; end if;
 delete from public.character_images where id=p_image and character_id=p_character returning path into result;
 return result;
end $$;
revoke all on function public.character_profile(uuid),public.save_character_description(uuid,text),public.add_character_image(uuid,text,text),public.set_character_avatar(uuid,uuid),public.remove_character_image(uuid,uuid) from public,anon;
grant execute on function public.character_profile(uuid),public.save_character_description(uuid,text),public.add_character_image(uuid,text,text),public.set_character_avatar(uuid,uuid),public.remove_character_image(uuid,uuid) to authenticated;

create table public.world_regions(world_id text references public.worlds(id),id text,name text not null,primary key(world_id,id));
create table public.world_locations(world_id text,id text,region_id text not null,name text not null,description text not null default '',map_x integer not null default 0,map_y integer not null default 0,primary key(world_id,id),foreign key(world_id,region_id) references public.world_regions(world_id,id));
create table public.room_connections(world_id text,from_room text,to_room text,door_id text,primary key(world_id,from_room,to_room),foreign key(world_id,from_room) references public.world_locations(world_id,id),foreign key(world_id,to_room) references public.world_locations(world_id,id),foreign key(world_id,door_id) references public.world_doors(world_id,door_id),check(from_room<>to_room));
alter table public.world_regions enable row level security;
alter table public.world_locations enable row level security;
alter table public.room_connections enable row level security;
revoke all on public.world_regions,public.world_locations,public.room_connections from public,anon,authenticated;
insert into public.world_regions values('alska-mogue','moonCrossing','Moon Crossing');
insert into public.world_locations values('alska-mogue','roomA','moonCrossing','Room A','Description of Room A.',0,0),('alska-mogue','roomB','moonCrossing','Room B','Description of Room B.',1,0),('alska-mogue','roomC','moonCrossing','Room C','Description of Room C.',2,0);
insert into public.room_connections values('alska-mogue','roomA','roomB',null),('alska-mogue','roomB','roomA',null),('alska-mogue','roomB','roomC','roomC'),('alska-mogue','roomC','roomB','roomC');
alter table public.characters drop constraint characters_room_id_check;
alter table public.chat_visits drop constraint chat_visits_room_id_check;
alter table public.room_messages drop constraint room_messages_room_id_check;
alter table public.characters add foreign key(world_id,room_id) references public.world_locations(world_id,id);
alter table public.chat_visits add foreign key(world_id,room_id) references public.world_locations(world_id,id);
alter table public.room_messages add foreign key(world_id,room_id) references public.world_locations(world_id,id);
create function public.world_map(p_world text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('regions',coalesce((select jsonb_agg(r order by r.id) from public.world_regions r where r.world_id=p_world),'[]'::jsonb),'rooms',coalesce((select jsonb_agg(l order by l.id) from public.world_locations l where l.world_id=p_world),'[]'::jsonb),'connections',coalesce((select jsonb_agg(e order by e.from_room,e.to_room) from public.room_connections e where e.world_id=p_world),'[]'::jsonb)) where auth.uid() is not null;
$$;
create or replace function public.enter_chat(p_visit uuid,p_character uuid,p_room text) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.characters;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid();
 if not found or p_visit is null or p_room is null or c.room_id<>p_room then raise exception 'Invalid chat visit'; end if;
 insert into public.chat_visits(id,player_id,character_id,world_id,room_id) values(p_visit,auth.uid(),c.id,c.world_id,p_room);
 return p_visit;
end $$;
create or replace function public.save_character_location(p_character uuid,p_from text,p_to text) returns text language plpgsql security definer set search_path='' as $$
declare c public.characters; door text; blocked boolean;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid() for update;
 if not found then raise exception 'Character unavailable'; end if;
 if c.room_id is distinct from p_from then raise exception 'Location changed. Reload before moving.'; end if;
 select door_id into door from public.room_connections where world_id=c.world_id and from_room=p_from and to_room=p_to for share;
 if not found then raise exception 'Rooms are not adjacent'; end if;
 if door is not null then
  select locked into blocked from public.world_doors where world_id=c.world_id and door_id=door for update;
  if blocked then raise exception 'The door is locked'; end if;
 end if;
 update public.characters set room_id=p_to where id=c.id;
 update public.chat_visits set active=false where character_id=c.id and active;
 update public.lock_use set token=null,player_id=null,character_id=null,expires_at='-infinity' where character_id=c.id;
 return p_to;
end $$;
revoke all on function public.world_map(text) from public,anon;
grant execute on function public.world_map(text) to authenticated;
commit;
