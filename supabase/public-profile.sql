-- Expose only public profile fields to signed-in players, never email or auth metadata.
create function public.player_profile(p_user uuid default null,p_character uuid default null)
returns table(id uuid,username text,about text,joined timestamptz)
language sql stable security definer set search_path='' as $$
 select u.id,coalesce(nullif(btrim(u.raw_user_meta_data->>'username'),''),'Player'),
 coalesce(u.raw_user_meta_data->>'about',''),u.created_at
 from auth.users u
 where auth.uid() is not null and u.id=case when p_character is not null
 then (select c.player_id from public.characters c where c.id=p_character) else p_user end;
$$;
revoke all on function public.player_profile(uuid,uuid) from public,anon;
grant execute on function public.player_profile(uuid,uuid) to authenticated;
