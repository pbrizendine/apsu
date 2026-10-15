begin;
revoke insert on public.characters from authenticated;
grant insert(player_id,world_id,slot,name) on public.characters to authenticated;
create table public.world_doors(world_id text references public.worlds(id),door_id text,locked boolean not null default true,primary key(world_id,door_id));
insert into public.world_doors values('alska-mogue','roomC',true);
alter table public.world_doors enable row level security;
revoke all on public.world_doors from anon,authenticated;
alter table public.lock_use add column character_id uuid references public.characters(id);
create or replace function public.save_character_location(p_character uuid,p_from text,p_to text) returns text language plpgsql security definer set search_path='' as $$
declare c public.characters; blocked boolean;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid() and world_id='alska-mogue' for update;
 if not found then raise exception 'Character unavailable'; end if;
 if c.room_id is distinct from p_from then raise exception 'Location changed. Reload before moving.'; end if;
 if p_to is null or not ((p_from='roomA' and p_to='roomB') or (p_from='roomB' and p_to in ('roomA','roomC')) or (p_from='roomC' and p_to='roomB')) then raise exception 'Rooms are not adjacent'; end if;
 select locked into blocked from public.world_doors where world_id=c.world_id and door_id='roomC' for update;
 if blocked and (p_from='roomC' or p_to='roomC') then raise exception 'The door is locked'; end if;
 update public.characters set room_id=p_to where id=c.id;
 update public.chat_visits set active=false where character_id=c.id and active;
 update public.lock_use set token=null,player_id=null,character_id=null,expires_at='-infinity' where character_id=c.id;
 return p_to;
end $$;
-- An old tab cannot join chat in a room its character has left.
create function public.check_chat_location() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.characters where id=new.character_id and player_id=new.player_id and world_id=new.world_id and room_id=new.room_id for update;
 if not found then raise exception 'Character is not in this room'; end if;
 return new;
end $$;
create trigger chat_location before insert on public.chat_visits for each row execute function public.check_chat_location();
create or replace function public.acquire_lock_use(p_character uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.characters; blocked boolean; t uuid;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid() and world_id='alska-mogue' and room_id='roomB' for update;
 if not found then raise exception 'Character is not outside this door'; end if;
 select locked into blocked from public.world_doors where world_id=c.world_id and door_id='roomC' for update;
 if not blocked then raise exception 'The door is unlocked'; end if;
 update public.lock_use set player_id=auth.uid(),character_id=c.id,token=gen_random_uuid(),expires_at=clock_timestamp()+interval '30 seconds'
 where world_id=c.world_id and door_id='roomC' and expires_at<=clock_timestamp() returning token into t;
 return t;
end $$;
create function public.change_room_door(p_character uuid,p_locked boolean,p_token uuid default null,p_item uuid default null,p_key boolean default true) returns boolean language plpgsql security definer set search_path='' as $$
declare c public.characters; lease public.lock_use;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid() and world_id='alska-mogue' and room_id in ('roomB','roomC') for update;
 if not found or p_locked is null then raise exception 'Character is not at this door'; end if;
 perform 1 from public.world_doors where world_id=c.world_id and door_id='roomC' for update;
 select * into lease from public.lock_use where world_id=c.world_id and door_id='roomC' for update;
 if p_token is not null then
  if p_locked or c.room_id<>'roomB' or lease.token is distinct from p_token or lease.player_id is distinct from auth.uid() or lease.character_id is distinct from c.id or lease.expires_at<=clock_timestamp() then raise exception 'Lock session ended'; end if;
 else
  if lease.expires_at>clock_timestamp() then raise exception 'Someone is using the lock.'; end if;
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
create function public.room_snapshot(p_character uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.characters; result jsonb;
begin
 select * into c from public.characters where id=p_character and player_id=auth.uid() and world_id='alska-mogue';
 if not found then raise exception 'Character unavailable'; end if;
 select jsonb_build_object('room_id',c.room_id,'locked',d.locked,'characters',coalesce((
 select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) order by x.name,x.id) from public.characters x
 where x.world_id=c.world_id and x.room_id=c.room_id and exists(select 1 from public.chat_visits v where v.character_id=x.id and v.room_id=x.room_id and v.active and v.seen_at>now()-interval '60 seconds')
 ),'[]'::jsonb)) into result from public.world_doors d where d.world_id=c.world_id and d.door_id='roomC';
 return result;
end $$;
revoke all on function public.change_room_door(uuid,boolean,uuid,uuid,boolean),public.room_snapshot(uuid),public.check_chat_location() from public,anon;
grant execute on function public.change_room_door(uuid,boolean,uuid,uuid,boolean),public.room_snapshot(uuid) to authenticated;
commit;
