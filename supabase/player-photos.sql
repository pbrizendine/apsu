-- Public snapshot: owner@example.invalid is a placeholder, never an automatic grant to the original operator.
begin;
create or replace function public.add_character_image(p_character uuid,p_path text,p_title text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform 1 from public.characters where id=p_character and player_id=auth.uid() for update;
 if not found then raise exception 'Only the character owner can upload images'; end if;
 if p_title is null or length(btrim(p_title)) not between 1 and 100 then raise exception 'Image title must be 1 to 100 characters'; end if;
 if p_path is null or split_part(p_path,'/',1)<>auth.uid()::text or split_part(p_path,'/',2)<>p_character::text or not exists(select 1 from storage.objects where bucket_id='character-images' and name=p_path) then raise exception 'Uploaded image not found'; end if;
 select id into result from public.character_images where path=p_path and character_id=p_character;
 if result is not null then return result; end if;
 if (select count(*) from public.character_images where character_id=p_character)>=3 then raise exception 'Maximum 3 images per character'; end if;
 insert into public.character_images(character_id,path,title) values(p_character,p_path,btrim(p_title)) returning id into result;
 return result;
end $$;

create table public.player_appearance(player_id uuid primary key references auth.users(id) on delete cascade, photo_path text not null);
create table public.player_badges(player_id uuid references auth.users(id) on delete cascade,badge text not null check(length(badge) between 1 and 80),primary key(player_id,badge));
alter table public.player_appearance enable row level security;
alter table public.player_badges enable row level security;
revoke all on public.player_appearance,public.player_badges from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('player-pictures','player-pictures',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy "Read player pictures" on storage.objects for select to authenticated using(bucket_id='player-pictures');
create policy "Upload own player picture" on storage.objects for insert to authenticated with check(bucket_id='player-pictures' and name=auth.uid()::text||'/portrait');
create policy "Replace own player picture" on storage.objects for update to authenticated using(bucket_id='player-pictures' and name=auth.uid()::text||'/portrait') with check(bucket_id='player-pictures' and name=auth.uid()::text||'/portrait');
create function public.save_player_picture() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from storage.objects where bucket_id='player-pictures' and name=auth.uid()::text||'/portrait') then raise exception 'Upload your picture first';end if;
 insert into public.player_appearance values(auth.uid(),auth.uid()::text||'/portrait') on conflict(player_id) do update set photo_path=excluded.photo_path;
end $$;
create function public.player_profile_extras(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('photo_path',(select photo_path from public.player_appearance where player_id=p_user),'badges',coalesce((select jsonb_agg(badge order by badge) from public.player_badges where player_id=p_user),'[]'::jsonb)) where auth.uid() is not null;
$$;
revoke all on function public.save_player_picture(),public.player_profile_extras(uuid) from public,anon;
grant execute on function public.save_player_picture(),public.player_profile_extras(uuid) to authenticated;
-- Prefer the exact account address supplied by its owner; never assign by an ambiguous display name.
do $$ declare target uuid; begin
 select id into target from auth.users where lower(email)='owner@example.invalid';
 if target is null then raise exception 'Founder account not found';end if;
 insert into public.player_badges values(target,'Founder') on conflict do nothing;
end $$;
commit;
select coalesce(raw_user_meta_data->>'username','Player') as founder_username from auth.users where lower(email)='owner@example.invalid';
select count(*) as characters_over_three from (select character_id from public.character_images group by character_id having count(*)>3) x;
