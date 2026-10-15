begin;
alter table public.characters add column room_id text not null default 'roomA'
 check (room_id in ('roomA','roomB','roomC'));
-- Only this owned character's location can be updated. Movement rules follow separately.
create function public.save_character_location(p_character uuid,p_from text,p_to text)
returns text language plpgsql security definer set search_path='' as $$
begin
 if p_to is null or p_to not in ('roomA','roomB','roomC') then raise exception 'Invalid room'; end if;
 update public.characters set room_id=p_to
 where id=p_character and player_id=auth.uid() and world_id='alska-mogue' and room_id=p_from;
 if not found then raise exception 'Character unavailable or location changed. Reload before moving.'; end if;
 return p_to;
end $$;
revoke all on function public.save_character_location(uuid,text,text) from public,anon;
grant execute on function public.save_character_location(uuid,text,text) to authenticated;
commit;
