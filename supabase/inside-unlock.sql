create or replace function public.change_room_door(p_character uuid,p_locked boolean,p_token uuid default null,p_item uuid default null,p_key boolean default true) returns boolean language plpgsql security definer set search_path='' as $$
declare c public.characters; lease public.lock_use;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid() and world_id='alska-mogue' and room_id in ('roomB','roomC') for update;
 if not found or p_locked is null then raise exception 'Character is not at this door'; end if;
 perform 1 from public.world_doors where world_id=c.world_id and door_id='roomC' for update;
 select * into lease from public.lock_use where world_id=c.world_id and door_id='roomC' for update;
 if p_token is not null then
  if p_locked or c.room_id<>'roomB' or lease.token is distinct from p_token or lease.player_id is distinct from auth.uid() or lease.character_id is distinct from c.id or lease.expires_at<=clock_timestamp() then raise exception 'Lock session ended'; end if;
 else
  if lease.expires_at>clock_timestamp() and not (c.room_id='roomC' and p_locked=false and p_key=true) then raise exception 'Someone is using the lock.'; end if;
  if not p_locked and c.room_id<>'roomC' then raise exception 'Use the lock interaction outside'; end if;
  if not p_key then raise exception 'A key is required'; end if;
 end if;
 if p_key then
  if not exists(select 1 from public.character_items where character_id=c.id and kind='room-c-key') then raise exception 'A matching key is required'; end if;
 else
  if p_token is null or not exists(select 1 from public.character_items where id=p_item and character_id=c.id and kind='lockpick' and capacity>0) then raise exception 'Usable lockpick required'; end if;
 end if;
 update public.world_doors set locked=p_locked where world_id=c.world_id and door_id='roomC';
 update public.lock_use set token=null,player_id=null,character_id=null,expires_at='-infinity' where world_id=c.world_id and door_id='roomC';
 return p_locked;
end $$;
