-- Apply after prealpha-reliability.sql. Lead Admins and higher, scoped to this world.
begin;
create or replace function public.create_world_room(p_request uuid,p_world text,p_anchor text,p_direction text,p_name text,p_description text default '')
returns text language plpgsql security definer set search_path='' as $$
declare anchor public.world_locations; previous public.world_moderation; room_id text; x int; y int; details jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_world,41));
 perform public.require_staff(p_world,2);
 if p_request is null or p_direction is null or p_direction not in('top','right','bottom','left') or p_name is null or length(btrim(p_name)) not between 1 and 80 or length(coalesce(p_description,''))>4000 then raise exception 'Choose a direction, a name of 1–80 characters, and a description up to 4000 characters';end if;
 room_id:='room-'||p_request::text;
 details:=jsonb_build_object('room',room_id,'anchor',p_anchor,'direction',p_direction,'name',btrim(p_name),'description',coalesce(p_description,''));
 select * into previous from public.world_moderation where id=p_request;
 if found then
  if previous.actor=auth.uid() and previous.world_id=p_world and previous.action='create_room' and previous.reason=details::text then return room_id;end if;
  raise exception 'This request was already used';
 end if;
 select * into anchor from public.world_locations where world_id=p_world and id=p_anchor;
 if not found then raise exception 'Choose an existing room in this world';end if;
 x:=anchor.map_x+case p_direction when 'left' then -1 when 'right' then 1 else 0 end;
 y:=anchor.map_y+case p_direction when 'top' then -1 when 'bottom' then 1 else 0 end;
 if exists(select 1 from public.world_locations where world_id=p_world and map_x=x and map_y=y) then raise exception 'That map position is occupied. Choose another direction.';end if;
 insert into public.world_locations(world_id,id,region_id,name,description,map_x,map_y) values(p_world,room_id,anchor.region_id,btrim(p_name),coalesce(p_description,''),x,y);
 insert into public.room_connections(world_id,from_room,to_room) values(p_world,p_anchor,room_id),(p_world,room_id,p_anchor);
 insert into public.world_moderation(id,world_id,actor,action,reason) values(p_request,p_world,auth.uid(),'create_room',details::text);
 return room_id;
end $$;
revoke all on function public.create_world_room(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.create_world_room(uuid,text,text,text,text,text) to authenticated;
commit;
