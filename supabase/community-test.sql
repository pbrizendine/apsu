-- Run against a disposable database after the three October 4 migrations.
-- Fixtures roll back. Never use real player accounts for this test.
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end $$;
select pg_temp.assert((select count(*)>0 from public.account_eligibility where adult_override and birth_date is null and terms_version is null and accepted_at is null),'legacy adult override without invented birthday or consent');
insert into auth.users(id,email,raw_user_meta_data)
select ('00000000-0000-4000-8000-00000000000'||n)::uuid,'fixture'||n||'@apsu.invalid',jsonb_build_object('username','Fixture '||n,'apsu_birth_date',(current_date-make_interval(years=>case when n=2 then 15 else 25 end))::date,'apsu_terms','2026-10-04') from generate_series(1,4) n;
do $$ begin
 begin
 insert into auth.users(email,raw_user_meta_data) values('child@apsu.invalid',jsonb_build_object('apsu_birth_date',(current_date-interval '12 years')::date,'apsu_terms','2026-10-04'));
 raise exception 'TEST: child was accepted';
 exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
end $$;
select pg_temp.assert(not exists(select 1 from auth.users where email='child@apsu.invalid'),'under-13 registration rolls back');
select pg_temp.assert(not exists(select 1 from auth.users where raw_user_meta_data ? 'apsu_birth_date'),'DOB stripped from public auth metadata');
insert into public.characters(id,player_id,world_id,slot,name,room_id)
select ('10000000-0000-4000-8000-00000000000'||n)::uuid,('00000000-0000-4000-8000-00000000000'||n)::uuid,'alska-mogue',1,'Character '||n,case n when 1 then 'roomA' when 2 then 'roomB' else 'roomC' end from generate_series(1,4) n;
insert into public.chat_visits(id,player_id,character_id,world_id,room_id)
select ('20000000-0000-4000-8000-00000000000'||n)::uuid,('00000000-0000-4000-8000-00000000000'||n)::uuid,('10000000-0000-4000-8000-00000000000'||n)::uuid,'alska-mogue',case n when 1 then 'roomA' when 2 then 'roomB' else 'roomC' end from generate_series(1,4) n;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.send_room_command('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Hello neighbours','shout');
select public.send_room_command('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Hello neighbours','shout');
select pg_temp.assert((select count(*)=1 from public.room_messages where id='30000000-0000-4000-8000-000000000001'),'shout retry does not duplicate');
select public.send_dm('40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','Private words');
select public.send_dm('40000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','Private words');
select pg_temp.assert((select count(*)=1 from public.direct_messages),'sender DM and retry');
select public.request_privacy_action('50000000-0000-4000-8000-000000000001','deletion','Test request');
select pg_temp.assert((select count(*)=1 from public.my_privacy_requests()),'own deletion request');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.assert((select count(*)=1 from public.room_messages where id='30000000-0000-4000-8000-000000000001'),'adjacent room hears shout');
select pg_temp.assert((select count(*)=1 from public.direct_messages),'recipient sees DM');
select pg_temp.assert(jsonb_array_length(public.dm_thread('00000000-0000-4000-8000-000000000001')->'messages')=1,'DM thread recipient');
select pg_temp.assert((select count(*)=0 from public.my_privacy_requests()),'privacy request owner-only');
select public.set_dm_block('00000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select pg_temp.assert((select count(*)=0 from public.room_messages where id='30000000-0000-4000-8000-000000000001'),'two-hop room cannot hear shout');
select pg_temp.assert((select count(*)=0 from public.direct_messages),'third party cannot read DM');
select pg_temp.assert(jsonb_array_length(public.dm_thread('00000000-0000-4000-8000-000000000001')->'messages')=0,'third-party thread does not leak');
do $$ begin
 begin perform * from public.review_privacy_requests();raise exception 'TEST: privacy staff bypass';exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin perform * from public.account_eligibility;raise exception 'TEST: private birthday readable';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.direct_messages set created_at=clock_timestamp()-interval '2 seconds';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ begin
 begin perform public.send_dm(gen_random_uuid(),'00000000-0000-4000-8000-000000000002','Blocked');raise exception 'TEST: block bypass';exception when others then if sqlerrm like 'TEST:%' then raise;end if;end;
end $$;
select public.cancel_privacy_request('50000000-0000-4000-8000-000000000001');
select pg_temp.assert((select status='cancelled' from public.my_privacy_requests()),'cancel deletion request');
reset role;
-- Show-item and help messages remain scoped to their intended recipients.
update public.characters set room_id='roomA' where id='10000000-0000-4000-8000-000000000002';
update public.chat_visits set room_id='roomA' where id='20000000-0000-4000-8000-000000000002';
delete from public.player_rate_limits;
insert into public.character_items(id,character_id,kind,slot,appearance) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','custom',1,'{"name":"Fixture watch","icon":"watch"}');
insert into public.world_staff values('alska-mogue','00000000-0000-4000-8000-000000000003','Lead Admin');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.show_inventory_item('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
select public.show_inventory_item('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');
select pg_temp.assert((select count(*)=1 from public.character_items where id='60000000-0000-4000-8000-000000000001'),'show does not transfer inventory');
select public.world_command('80000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Need help','help');
select public.world_command('80000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Need help','help');
select pg_temp.assert(jsonb_array_length(public.online_world_admins('alska-mogue'))=1,'online world admin list');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.assert((select count(*)=1 from public.room_messages where id='70000000-0000-4000-8000-000000000001'),'recipient sees shown item');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select pg_temp.assert((select count(*)=0 from public.room_messages where id='70000000-0000-4000-8000-000000000001'),'unrelated admin cannot read item show');
reset role;
select pg_temp.assert((select count(*)=1 from public.world_reports where id='80000000-0000-4000-8000-000000000001'),'help retry does not duplicate');
select pg_temp.assert((select count(*)=1 from public.world_notices where body='Help request: Need help' and target='00000000-0000-4000-8000-000000000003'),'help alert targets world admin');
update public.worlds set minimum_age=18 where id='alska-mogue';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.assert(not public.can_access_world('alska-mogue'),'teen denied adult world');
select pg_temp.assert(not public.can_view_character('10000000-0000-4000-8000-000000000001'),'age predicate filters rather than throwing');
select pg_temp.assert((select count(*)=0 from public.characters),'age RLS blocks own adult-world character');
do $$ begin
 begin perform public.world_map('alska-mogue');raise exception 'TEST: RPC age bypass';exception when sqlstate 'AP018' then null;end;
 begin perform apsu_private.world_map('alska-mogue');raise exception 'TEST: private schema bypass';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.assert(public.can_access_world('alska-mogue'),'adult allowed');
select pg_temp.assert(public.world_map('alska-mogue') is not null,'wrapped adult map works');
reset role;
update public.direct_messages set created_at=clock_timestamp()-interval '25 hours';
set local role authenticated;
select pg_temp.assert((select count(*)=0 from public.direct_messages),'expired DM hidden');
select pg_temp.assert(jsonb_array_length(public.dm_thread('00000000-0000-4000-8000-000000000002')->'messages')=0,'expired DM hidden through RPC');
set local role anon;
do $$ begin
 begin perform public.send_dm(gen_random_uuid(),'00000000-0000-4000-8000-000000000002','anonymous');raise exception 'TEST: anonymous DM';exception when insufficient_privilege then null;end;
end $$;
rollback;
