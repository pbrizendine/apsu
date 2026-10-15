-- LOCAL DRAFT. Apply only as part of the reviewed October 4 release, before
-- community.sql and age-world-guards.sql. Existing pre-alpha accounts receive an explicitly recorded administrative 18+ override.
begin;
create table public.account_eligibility (
 player_id uuid primary key references auth.users(id) on delete cascade,
 birth_date date,
 terms_version text,
 accepted_at timestamptz,
 adult_override boolean not null default false,
 override_reason text,
 check (birth_date is not null or adult_override)
);
alter table public.account_eligibility enable row level security;
revoke all on public.account_eligibility from public,anon,authenticated;
alter table public.worlds add column minimum_age integer not null default 13 check(minimum_age in(13,18));
create function public.account_is_eligible(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.account_eligibility e where e.player_id=p_user and (e.adult_override or (e.birth_date<=(current_date-interval '13 years')::date and e.terms_version='2026-10-04')));
$$;
create function public.can_access_world(p_world text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.account_eligibility e join public.worlds w on w.id=p_world
 where e.player_id=auth.uid() and (e.adult_override or (e.terms_version='2026-10-04' and e.birth_date<=(current_date-make_interval(years=>w.minimum_age))::date)));
$$;
create function public.require_world_access(p_world text) returns void
language plpgsql security definer set search_path='' as $$ begin
 if not public.account_is_eligible() then raise exception 'Complete age and terms confirmation before entering a world' using errcode='AP013';end if;
 if not public.can_access_world(p_world) then raise exception 'This world is unavailable for your age group' using errcode='AP018';end if;
end $$;
create function public.get_account_eligibility() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('confirmed',public.account_is_eligible(),'adult',exists(select 1 from public.account_eligibility where player_id=auth.uid() and (adult_override or birth_date<=(current_date-interval '18 years')::date)),'terms_version','2026-10-04') where auth.uid() is not null;
$$;
create function public.accept_account_terms(p_birth date,p_version text) returns void
language plpgsql security definer set search_path='' as $$ begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 if p_birth is null or p_birth>current_date or p_birth<date '1900-01-01' then raise exception 'Enter a valid date of birth';end if;
 if p_birth>(current_date-interval '13 years')::date then raise exception 'APSU is available to people aged 13 and older';end if;
 if p_version is distinct from '2026-10-04' then raise exception 'Read the current terms before continuing';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,147));
 if exists(select 1 from public.account_eligibility where player_id=auth.uid() and birth_date<>p_birth) then raise exception 'Use a privacy request to correct an existing date of birth';end if;
 insert into public.account_eligibility(player_id,birth_date,terms_version,accepted_at) values(auth.uid(),p_birth,p_version,clock_timestamp())
 on conflict(player_id) do update set birth_date=excluded.birth_date,terms_version=excluded.terms_version,accepted_at=clock_timestamp(),adult_override=false,override_reason=null;
end $$;
-- Owner-authorized legacy eligibility: do not fabricate birthdays or terms consent.
insert into public.account_eligibility(player_id,adult_override,override_reason)
select id,true,'Owner-authorized 18+ status for existing pre-alpha accounts, 2026-10-04' from auth.users;

-- Reject ineligible registrations transactionally; copy birthday into private storage
-- and remove it from editable auth metadata. Never trust later metadata edits for age.
create function public.register_account_eligibility() returns trigger
language plpgsql security definer set search_path='' as $$
declare birthday date;
begin
 if new.raw_user_meta_data->>'apsu_terms' is distinct from '2026-10-04' then raise exception 'Accept the APSU terms to create an account';end if;
 begin birthday:=(new.raw_user_meta_data->>'apsu_birth_date')::date;
 exception when others then raise exception 'Enter a valid date of birth';end;
 if birthday is null or birthday<date '1900-01-01' or birthday>(current_date-interval '13 years')::date then raise exception 'APSU is available to people aged 13 and older';end if;
 insert into public.account_eligibility(player_id,birth_date,terms_version,accepted_at) values(new.id,birthday,'2026-10-04',clock_timestamp());
 update auth.users set raw_user_meta_data=raw_user_meta_data-'apsu_birth_date'-'apsu_terms' where id=new.id;
 return new;
end $$;
create trigger apsu_account_eligibility after insert on auth.users for each row execute function public.register_account_eligibility();

create table public.privacy_requests (
 id uuid primary key, player_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in('deletion','access','correction','other')),
 details text not null default '' check(length(details)<=2000),
 status text not null default 'pending' check(status in('pending','reviewing','completed','cancelled')),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
alter table public.privacy_requests enable row level security;
revoke all on public.privacy_requests from public,anon,authenticated;
create function public.request_privacy_action(p_id uuid,p_kind text,p_details text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.privacy_requests;
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 if p_id is null or p_kind is null or p_kind not in('deletion','access','correction','other') or p_details is null or length(p_details)>2000 then raise exception 'Choose a request type and use up to 2000 characters';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,148));
 select * into old from public.privacy_requests where id=p_id;
 if found then if old.player_id=auth.uid() and old.kind=p_kind and old.details=p_details then return p_id;end if;raise exception 'Request identifier already used';end if;
 if exists(select 1 from public.privacy_requests where player_id=auth.uid() and kind=p_kind and status in('pending','reviewing')) then raise exception 'You already have an open request of this type';end if;
 insert into public.privacy_requests(id,player_id,kind,details) values(p_id,auth.uid(),p_kind,p_details);return p_id;
end $$;
create function public.my_privacy_requests() returns setof public.privacy_requests
language sql stable security definer set search_path='' as $$ select * from public.privacy_requests where player_id=auth.uid() order by created_at desc; $$;
create function public.cancel_privacy_request(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
 update public.privacy_requests set status='cancelled',updated_at=clock_timestamp() where id=p_id and player_id=auth.uid() and status='pending';
 if not found then raise exception 'Only your pending requests can be cancelled';end if;
end $$;
create function public.review_privacy_requests(p_id uuid default null,p_status text default null) returns setof public.privacy_requests
language plpgsql security definer set search_path='' as $$ begin
 if not exists(select 1 from public.player_badges where player_id=auth.uid() and badge='APSU Founder') then raise exception 'APSU staff only';end if;
 if p_id is not null then
  if p_status is null or p_status not in('reviewing','completed') then raise exception 'Invalid request status';end if;
  update public.privacy_requests set status=p_status,updated_at=clock_timestamp() where id=p_id and status<>'cancelled';
 end if;
 return query select * from public.privacy_requests order by created_at desc limit 100;
end $$;
create function public.set_world_minimum_age(p_world text,p_age integer) returns void
language plpgsql security definer set search_path='' as $$ begin
 perform public.require_staff(p_world,3);
 if p_age is null or p_age not in(13,18) then raise exception 'Choose 13+ or 18+';end if;
 update public.worlds set minimum_age=p_age where id=p_world;
 insert into public.world_moderation(id,world_id,actor,action,reason) values(gen_random_uuid(),p_world,auth.uid(),'world_age_rating',p_age||'+');
 -- Stop existing visits that no longer meet the rating immediately.
 update public.chat_visits v set active=false where v.world_id=p_world and not exists(select 1 from public.account_eligibility e where e.player_id=v.player_id and (e.adult_override or e.birth_date<=(current_date-make_interval(years=>p_age))::date));
end $$;
revoke all on function public.account_is_eligible(uuid),public.can_access_world(text),public.require_world_access(text),public.register_account_eligibility() from public,anon,authenticated;
grant execute on function public.can_access_world(text) to authenticated;
revoke all on function public.get_account_eligibility(),public.accept_account_terms(date,text),public.request_privacy_action(uuid,text,text),public.my_privacy_requests(),public.cancel_privacy_request(uuid),public.review_privacy_requests(uuid,text),public.set_world_minimum_age(text,integer) from public,anon;
grant execute on function public.get_account_eligibility(),public.accept_account_terms(date,text),public.request_privacy_action(uuid,text,text),public.my_privacy_requests(),public.cancel_privacy_request(uuid),public.review_privacy_requests(uuid,text),public.set_world_minimum_age(text,integer) to authenticated;
commit;
