-- Run after whispers.sql. All test data is rolled back.
begin;
do $$
declare
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); observer uuid:=gen_random_uuid();
 ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); co uuid:=gen_random_uuid();
 va uuid:=gen_random_uuid(); vb uuid:=gen_random_uuid(); vo uuid:=gen_random_uuid();
 m uuid:=gen_random_uuid(); n integer; na integer; nb integer;
begin
 insert into auth.users(id,raw_user_meta_data) values(a,'{"username":"Whisper test A"}'),(b,'{"username":"Whisper test B"}'),(observer,'{"username":"Observer"}');
 insert into public.characters(id,player_id,world_id,slot,name,room_id) values(ca,a,'alska-mogue',1,'Test A','roomA'),(cb,b,'alska-mogue',1,'Test B','roomA'),(co,observer,'alska-mogue',1,'Observer','roomA');
 perform set_config('request.jwt.claim.sub',a::text,true); perform public.enter_chat(va,ca,'roomA');
 perform set_config('request.jwt.claim.sub',b::text,true); perform public.enter_chat(vb,cb,'roomA');
 perform set_config('request.jwt.claim.sub',observer::text,true); perform public.enter_chat(vo,co,'roomA');
 select number into na from public.room_chat_numbers where character_id=ca;
 select number into nb from public.room_chat_numbers where character_id=cb;
 if nb<>na+1 then raise exception 'IDs not sequential'; end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform public.send_room_whisper(m,va,nb,'Private test');
 perform public.send_room_whisper(m,va,nb,'Private test');
 select count(*) into n from public.room_messages where id=m;
 if n<>1 then raise exception 'Retry duplicated message'; end if;
 execute 'set local role authenticated';
 select count(*) into n from public.room_messages where id=m;
 if n<>1 then raise exception 'Sender cannot read own whisper'; end if;
 perform set_config('request.jwt.claim.sub',b::text,true);
 select count(*) into n from public.room_messages where id=m and body='Private test';
 if n<>1 then raise exception 'Recipient cannot read whisper'; end if;
 perform set_config('request.jwt.claim.sub',observer::text,true);
 select count(*) into n from public.room_messages where id=m;
 if n<>0 then raise exception 'Observer can read whisper'; end if;
 select count(*) into n from public.room_messages where character_id=ca and message_type='whisper_notice';
 if n<>1 then raise exception 'Observer missing public notice'; end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',b::text,true);
 perform public.send_room_whisper(gen_random_uuid(),vb,na,'Reply');
 select count(*) into n from public.room_messages where character_id in(ca,cb) and message_type='whisper_notice';
 if n<>1 then raise exception 'Reverse direction bypassed cooldown'; end if;
 update public.whisper_notices set last_notice=clock_timestamp()-interval '61 seconds' where first_character=least(ca,cb) and second_character=greatest(ca,cb);
 perform public.send_room_whisper(gen_random_uuid(),vb,na,'After cooldown');
 select count(*) into n from public.room_messages where character_id in(ca,cb) and message_type='whisper_notice';
 if n<>2 then raise exception 'Notice did not resume after a minute'; end if;
 update public.characters set room_id='roomB' where id=ca;
 begin
  perform public.send_room_whisper(gen_random_uuid(),vb,na,'Must fail');
  raise exception 'TEST FAILED: cross-room whisper accepted';
 exception when others then
  if sqlerrm<>'That character is not in this room' then raise; end if;
 end;
 if has_function_privilege('anon','public.send_room_whisper(uuid,uuid,integer,text)','execute') then raise exception 'Anonymous whisper permission'; end if;
end $$;
rollback;
select 'PASS: IDs, private RLS, retries, pair cooldown, room boundary, anonymous denial' as result;
