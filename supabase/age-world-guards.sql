-- LOCAL DRAFT. LAST migration in this release. Review generated wrappers before release.
-- Keeps the existing RPC signatures and permission logic; an outer guard adds age checks.
-- Original implementations move into an unexposed schema, not into another public endpoint.
begin;
create schema if not exists apsu_private;
revoke all on schema apsu_private from public,anon,authenticated;
create function public.account_access_allowed() returns boolean
language sql stable security definer set search_path='' as $$ select public.account_is_eligible(); $$;
revoke all on function public.account_access_allowed() from public,anon;
grant execute on function public.account_access_allowed() to authenticated;

-- One boundary covers both SQL and PL/pgSQL RPCs, including security-definer reads.
-- Wrapping only RLS would be insufficient: those functions intentionally bypass RLS.
do $wrap$
declare f record; args text; guard text; call_sql text; code text;
begin
 for f in select p.*,pg_get_function_identity_arguments(p.oid) as identity_args,
  pg_get_function_arguments(p.oid) as declaration_args,pg_get_function_result(p.oid) as result_type
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and p.prosecdef
  and has_function_privilege('authenticated',p.oid,'execute')
  and (p.proargnames && array['p_world','p_character','p_visit'])
  and p.proname not in('staff_rank','can_access_world')
 loop
  select string_agg(quote_ident(a),' , ' order by pos) into args
   from unnest(f.proargnames[1:f.pronargs]) with ordinality t(a,pos);
  if 'p_world'=any(f.proargnames) then guard:='perform public.require_world_access(p_world);';
  elsif 'p_character'=any(f.proargnames) then
   guard:='if p_character is not null then perform public.require_world_access((select world_id from public.characters where id=p_character)); elsif not public.account_is_eligible() then raise exception ''Complete age and terms confirmation'' using errcode=''AP013''; end if;';
  else guard:='perform public.require_world_access((select world_id from public.chat_visits where id=p_visit and player_id=auth.uid()));';end if;
  -- Policy predicates must filter inaccessible rows rather than abort a whole query.
  if f.proname='can_view_character' then
   guard:='if not public.can_access_world((select world_id from public.characters where id=p_character)) then return false; end if;';
  end if;
  if f.proretset then call_sql:=format('return query select * from apsu_private.%I(%s);',f.proname,args);
  elsif f.prorettype='void'::regtype then call_sql:=format('perform apsu_private.%I(%s); return;',f.proname,args);
  else call_sql:=format('return apsu_private.%I(%s);',f.proname,args);end if;
  execute format('alter function public.%I(%s) set schema apsu_private',f.proname,f.identity_args);
  execute format('revoke all on function apsu_private.%I(%s) from public,anon,authenticated',f.proname,f.identity_args);
  code:='begin '||guard||' '||call_sql||' end';
  execute format('create function public.%I(%s) returns %s language plpgsql security definer set search_path='''' as %L',f.proname,f.declaration_args,f.result_type,code);
  execute format('revoke all on function public.%I(%s) from public,anon',f.proname,f.identity_args);
  execute format('grant execute on function public.%I(%s) to authenticated',f.proname,f.identity_args);
 end loop;
end $wrap$;

-- Direct reads and Realtime must obey the same age rules, not only RPC calls.
do $policies$
declare t record; expression text;
begin
 for t in select c.table_name from information_schema.tables c
 where c.table_schema='public' and c.table_type='BASE TABLE'
 and c.table_name not in('account_eligibility','privacy_requests','direct_messages','dm_blocks')
 loop
  expression:=null;
  if t.table_name='worlds' then expression:='public.can_access_world(id)';
  elsif exists(select 1 from information_schema.columns where table_schema='public' and table_name=t.table_name and column_name='world_id') then expression:='public.can_access_world(world_id)';
  elsif exists(select 1 from information_schema.columns where table_schema='public' and table_name=t.table_name and column_name='character_id') then expression:='public.can_access_world((select world_id from public.characters where id=character_id))';
  elsif t.table_name='room_message_images' then expression:='exists(select 1 from public.room_messages where id=message_id)';end if;
  if expression is not null then
   execute format('alter table public.%I enable row level security',t.table_name);
   execute format('create policy "Account world age access" on public.%I as restrictive for all to authenticated using (%s) with check (%s)',t.table_name,expression,expression);
  end if;
 end loop;
end $policies$;
create policy "Age appropriate storage access" on storage.objects as restrictive for all to authenticated
using (
 public.account_access_allowed() and
 case when bucket_id in('room-images','world-maps','item-images') then public.can_access_world(split_part(name,'/',1))
 when bucket_id='character-images' then exists(select 1 from public.characters c where c.id::text=split_part(name,'/',2) and public.can_access_world(c.world_id))
 else true end
) with check (
 public.account_access_allowed() and
 case when bucket_id in('room-images','world-maps','item-images') then public.can_access_world(split_part(name,'/',1))
 when bucket_id='character-images' then exists(select 1 from public.characters c where c.id::text=split_part(name,'/',2) and public.can_access_world(c.world_id))
 else true end
);
notify pgrst,'reload schema';
commit;
