begin;
alter table public.room_messages add column chat_kind text not null default 'ic' check(chat_kind in ('ic','ooc'));
create function public.send_world_ooc(p_id uuid,p_visit uuid,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare v public.chat_visits; existing public.room_messages; audience uuid[]; username text;
begin
 select * into v from public.chat_visits where id=p_visit and player_id=auth.uid() and active and seen_at>clock_timestamp()-interval '60 seconds' for update;
 if not found then raise exception 'Chat visit expired'; end if;
 if p_id is null or p_body is null or char_length(btrim(p_body)) not between 1 and 500 or p_body ~ E'[\n\r]' then raise exception 'Use 1 to 500 characters on one line'; end if;
 select coalesce(nullif(btrim(raw_user_meta_data->>'username'),''),'Player') into username from auth.users where id=auth.uid();
 select array_agg(id) into audience from public.chat_visits where world_id=v.world_id and active and seen_at>clock_timestamp()-interval '60 seconds';
 insert into public.room_messages(id,world_id,room_id,character_id,character_name,body,created_at,visit_ids,chat_kind)
 values(p_id,v.world_id,v.room_id,v.character_id,username,btrim(p_body),clock_timestamp(),audience,'ooc') on conflict(id) do nothing;
 select * into existing from public.room_messages where id=p_id;
 if existing.chat_kind<>'ooc' or existing.character_id<>v.character_id or existing.body<>btrim(p_body) or not(p_visit=any(existing.visit_ids)) then raise exception 'Message identifier already used'; end if;
 return p_id;
end $$;
revoke all on function public.send_world_ooc(uuid,uuid,text) from public,anon;
grant execute on function public.send_world_ooc(uuid,uuid,text) to authenticated;
commit;
