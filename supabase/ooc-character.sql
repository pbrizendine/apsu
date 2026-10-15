begin;
alter table public.room_messages add column played_character_name text;
-- Store the name at send time so future renames do not rewrite the log.
create function public.stamp_chat_character() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select name into new.played_character_name from public.characters where id=new.character_id;
 return new;
end $$;
revoke all on function public.stamp_chat_character() from public,anon,authenticated;
create trigger stamp_chat_character before insert on public.room_messages for each row execute function public.stamp_chat_character();
update public.room_messages m set played_character_name=c.name from public.characters c where c.id=m.character_id and m.played_character_name is null;
commit;
