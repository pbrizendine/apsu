begin;
create table public.lock_use (
 world_id text not null references public.worlds(id),
 door_id text not null,
 player_id uuid references auth.users(id),
 token uuid,
 expires_at timestamptz not null default '-infinity',
 primary key(world_id,door_id)
);
insert into public.lock_use(world_id,door_id) values('alska-mogue','roomC');
alter table public.lock_use enable row level security;
revoke all on public.lock_use from anon,authenticated;
create function public.acquire_lock_use(p_character uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare t uuid;
begin
 if not exists(select 1 from public.characters where id=p_character and player_id=auth.uid() and world_id='alska-mogue') then raise exception 'Character not available'; end if;
 update public.lock_use set player_id=auth.uid(), token=gen_random_uuid(), expires_at=clock_timestamp()+interval '30 seconds'
 where world_id='alska-mogue' and door_id='roomC' and expires_at<=clock_timestamp() returning token into t;
 return t;
end $$;
create function public.renew_lock_use(p_token uuid,p_idle_ms integer) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_idle_ms is null or p_idle_ms<0 or p_idle_ms>=30000 then return false; end if;
 update public.lock_use set expires_at=clock_timestamp()+((30000-p_idle_ms)*interval '1 millisecond')
 where token=p_token and player_id=auth.uid() and expires_at>clock_timestamp();
 return found;
end $$;
create function public.release_lock_use(p_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare live boolean;
begin
 select expires_at>clock_timestamp() into live from public.lock_use where token=p_token and player_id=auth.uid() for update;
 if not found then return false; end if;
 update public.lock_use set token=null,player_id=null,expires_at='-infinity' where token=p_token and player_id=auth.uid();
 return live;
end $$;
revoke all on function public.acquire_lock_use(uuid) from public,anon;
revoke all on function public.renew_lock_use(uuid,integer) from public,anon;
revoke all on function public.release_lock_use(uuid) from public,anon;
grant execute on function public.acquire_lock_use(uuid) to authenticated;
grant execute on function public.renew_lock_use(uuid,integer) to authenticated;
grant execute on function public.release_lock_use(uuid) to authenticated;
commit;
