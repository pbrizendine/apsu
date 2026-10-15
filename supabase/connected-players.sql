-- Return counts only; do not expose other players' visit records.
create or replace function public.connected_player_counts()
returns table(world_id text, player_count bigint)
language sql stable security definer set search_path='' as $$
 select v.world_id, count(distinct v.player_id)
 from public.chat_visits v
 where auth.uid() is not null and v.active and v.seen_at>now()-interval '60 seconds'
 group by v.world_id;
$$;
revoke all on function public.connected_player_counts() from public,anon;
grant execute on function public.connected_player_counts() to authenticated;
