-- Apply after playtest-chat.sql and playtest-worlds.sql. No existing rows are removed.
begin;
create or replace function public.save_character_location(p_character uuid,p_from text,p_to text) returns text language plpgsql security definer set search_path='' as $$
declare c public.characters; edge public.room_connections; d public.world_doors; wid text;
begin
 select world_id into wid from public.characters where id=p_character and player_id=auth.uid();
 if wid is null then raise exception 'Character unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(wid,41));
 select * into c from public.characters where id=p_character and player_id=auth.uid() for update;
 if public.world_blocked(c.world_id,auth.uid(),'ban') then raise exception 'Character unavailable';end if;
 if c.room_id is distinct from p_from then raise exception 'Location changed. Reload before moving.';end if;
 select * into edge from public.room_connections where world_id=c.world_id and from_room=p_from and to_room=p_to;
 if not found then raise exception 'Rooms are not adjacent';end if;
 -- A lock belongs to one exact passage, never to the whole destination room.
 select * into d from public.world_doors where world_id=c.world_id and door_id=edge.door_id and enabled
 and ((inside_room=p_from and outside_room=p_to) or (inside_room=p_to and outside_room=p_from)) for update;
 -- A locked entrance never prevents leaving from its inside. Lock state is unchanged.
 if found and d.locked and d.outside_room=p_from then raise exception 'The door is locked';end if;
 perform public.room_departure(c.id,p_to);
 update public.characters set room_id=p_to where id=c.id;
 update public.chat_visits set active=false,typing_until='-infinity' where character_id=c.id and active;
 update public.lock_use set token=null,player_id=null,character_id=null,expires_at='-infinity' where character_id=c.id;
 return p_to;
end $$;
create or replace function public.world_map(p_world text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'doors',coalesce((select jsonb_agg(jsonb_build_object('door_id',d.door_id,'inside_room',d.inside_room,'outside_room',d.outside_room,'enabled',d.enabled)) from public.world_doors d where d.world_id=p_world),'[]'::jsonb),
 'regions',coalesce((select jsonb_agg(r order by r.id) from public.world_regions r where r.world_id=p_world),'[]'::jsonb),
 'rooms',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('owner_name',c.name) order by l.id) from public.world_locations l left join public.characters c on c.id=l.owner_character and c.world_id=l.world_id where l.world_id=p_world),'[]'::jsonb),
 'connections',coalesce((select jsonb_agg(e order by e.from_room,e.to_room) from public.room_connections e where e.world_id=p_world),'[]'::jsonb))
 where auth.uid() is not null;
$$;
notify pgrst, 'reload schema';
commit;
