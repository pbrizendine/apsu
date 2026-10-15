begin;
alter table public.character_items add column slot smallint not null default 1;
alter table public.character_items drop constraint character_items_character_id_kind_key;
alter table public.character_items add constraint item_slot_limit check ((kind='lockpick' and slot between 1 and 3) or (kind='room-c-key' and slot=1));
alter table public.character_items add constraint item_unique_slot unique(character_id,kind,slot);
create or replace function public.pickup_item(p_character uuid,p_kind text) returns public.character_items
language plpgsql security definer set search_path='' as $$
declare item public.character_items; free_slot integer;
begin
 -- Serialize pickups for this character, including simultaneous browser tabs.
 perform 1 from public.characters where id=p_character and player_id=auth.uid() and world_id='alska-mogue' for update;
 if not found then raise exception 'Character not available'; end if;
 if p_kind is null or p_kind not in ('room-c-key','lockpick') then raise exception 'Unknown item'; end if;
 select s into free_slot from generate_series(1,case when p_kind='lockpick' then 3 else 1 end) s
 where not exists(select 1 from public.character_items i where i.character_id=p_character and i.kind=p_kind and i.slot=s) order by s limit 1;
 if free_slot is null then raise exception 'Item limit reached'; end if;
 insert into public.character_items(character_id,kind,slot) values(p_character,p_kind,free_slot) returning * into item;
 return item;
end $$;
create function public.wear_lockpick_item(p_item uuid,p_capacity integer) returns public.character_items
language plpgsql security definer set search_path='' as $$
declare item public.character_items;
begin
 if p_capacity is null or p_capacity not in (0,50) then raise exception 'Invalid wear'; end if;
 update public.character_items i set capacity=least(i.capacity,p_capacity)
 where i.id=p_item and i.kind='lockpick' and exists(select 1 from public.characters c where c.id=i.character_id and c.player_id=auth.uid()) returning i.* into item;
 if item.id is null then raise exception 'Lockpick not available'; end if;
 return item;
end $$;
revoke all on function public.wear_lockpick(uuid,integer) from authenticated;
revoke all on function public.wear_lockpick_item(uuid,integer) from public,anon;
grant execute on function public.wear_lockpick_item(uuid,integer) to authenticated;
commit;
