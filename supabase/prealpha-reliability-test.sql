begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); va uuid:=gen_random_uuid(); vb uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); nb int; n int;
begin
 insert into auth.users(id,raw_user_meta_data) values(a,'{"username":"Test Alice"}'),(b,'{"username":"Test Bob"}');
 insert into public.characters(id,player_id,world_id,slot,name,room_id) values(ca,a,'alska-mogue',1,'Alice','roomA'),(cb,b,'alska-mogue',1,'Bob','roomA');
 perform set_config('request.jwt.claim.sub',a::text,true);perform public.enter_chat(va,ca,'roomA');perform public.enter_chat(va,ca,'roomA');
 perform set_config('request.jwt.claim.sub',b::text,true);perform public.enter_chat(vb,cb,'roomA');
 select number into nb from public.room_chat_numbers where character_id=cb and room_id='roomA';
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform public.send_visit_message(m,va,'First');perform public.send_visit_message(m,va,'First');
 begin perform public.send_world_ooc(gen_random_uuid(),va,'Too soon');raise exception 'Rate limit bypass';exception when others then if sqlerrm not like 'Please slow down.%' then raise;end if;end;
 begin perform public.send_room_whisper(gen_random_uuid(),va,nb,'Too soon');raise exception 'Whisper rate bypass';exception when others then if sqlerrm not like 'Please slow down.%' then raise;end if;end;
 update public.player_rate_limits set sent_at=array_fill(clock_timestamp()-interval '2 seconds',array[20]) where player_id=a and scope='chat';
 begin perform public.send_room_command(gen_random_uuid(),va,'waves','action');raise exception 'Minute limit bypass';exception when others then if sqlerrm<>'Too many messages or commands. Please wait a minute.' then raise;end if;end;
 update public.player_rate_limits set sent_at=array[clock_timestamp()-interval '61 seconds'] where player_id=a;
 perform public.send_room_whisper(gen_random_uuid(),va,nb,'Allowed');
 select count(*) into n from public.world_online_players('alska-mogue') where player_id in(a,b);if n<>2 then raise exception 'Roster missing players';end if;
 perform public.touch_chat(va,true);
 select count(*) into n from public.world_online_players('alska-mogue') where player_id=a;if n<>0 then raise exception 'Departed player still online';end if;
 update public.chat_visits set seen_at=clock_timestamp()-interval '61 seconds' where id=vb;
 select count(*) into n from public.world_online_players('alska-mogue') where player_id=b;if n<>0 then raise exception 'Expired player still online';end if;
 if has_function_privilege('anon','public.world_online_players(text)','execute') or has_function_privilege('authenticated','public.take_rate_slot(text,text,interval,integer)','execute') then raise exception 'Private helper permissions';end if;
end $$;
rollback;
select 'PASS: shared chat cooldown, minute quota, retries, whisper cooldown, roster and lease expiry, private helpers' as result;
