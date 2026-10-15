begin;
create table public.character_items (
 id uuid primary key default gen_random_uuid(),
 character_id uuid not null references public.characters(id),
 kind text not null check (kind in ('room-c-key','lockpick')),
 capacity smallint not null default 100 check (capacity in (0,50,100)),
 unique(character_id,kind)
);
alter table public.character_items enable row level security;
revoke all on public.character_items from anon, authenticated;
grant select on public.character_items to authenticated;
create policy "Read own character items" on public.character_items for select to authenticated
using (exists(select 1 from public.characters c where c.id=character_id and c.player_id=(select auth.uid())));
-- Prototype supplies: one key and one pick per character. Room position is still local.
create function public.pickup_item(p_character uuid,p_kind text) returns public.character_items
language plpgsql security definer set search_path='' as $$
declare item public.character_items;
begin
 if not exists(select 1 from public.characters where id=p_character and player_id=auth.uid() and world_id='alska-mogue') then raise exception 'Character not available'; end if;
 if p_kind not in ('room-c-key','lockpick') then raise exception 'Unknown item'; end if;
 insert into public.character_items(character_id,kind) values(p_character,p_kind)
 on conflict(character_id,kind) do nothing;
 select * into item from public.character_items where character_id=p_character and kind=p_kind;
 return item;
end $$;
-- Wear can only decrease; another tab or a restart cannot repair a damaged pick.
create function public.wear_lockpick(p_character uuid,p_capacity integer) returns public.character_items
language plpgsql security definer set search_path='' as $$
declare item public.character_items;
begin
 if not exists(select 1 from public.characters where id=p_character and player_id=auth.uid()) then raise exception 'Character not available'; end if;
 if p_capacity not in (0,50) then raise exception 'Invalid wear'; end if;
 update public.character_items set capacity=least(capacity,p_capacity)
 where character_id=p_character and kind='lockpick' returning * into item;
 if item.id is null then raise exception 'No lockpick'; end if;
 return item;
end $$;
revoke all on function public.pickup_item(uuid,text) from public,anon;
revoke all on function public.wear_lockpick(uuid,integer) from public,anon;
grant execute on function public.pickup_item(uuid,text) to authenticated;
grant execute on function public.wear_lockpick(uuid,integer) to authenticated;
commit;
