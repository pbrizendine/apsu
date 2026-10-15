begin;
do $$
declare lead uuid:=gen_random_uuid(); regular uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); rid text; n int;
begin
 insert into auth.users(id,raw_user_meta_data) values(lead,'{"username":"Room test lead"}'),(regular,'{"username":"Room test admin"}');
 insert into public.world_staff(world_id,player_id,role) values('alska-mogue',lead,'Lead Admin'),('alska-mogue',regular,'Admin');
 -- Isolated world geometry keeps tests independent of the user's real map.
 insert into public.world_locations(world_id,id,region_id,name,map_x,map_y)
 select 'alska-mogue','test-anchor-'||req,region_id,'Test anchor',1000000,1000000 from public.world_locations where world_id='alska-mogue' limit 1;
 perform set_config('request.jwt.claim.sub',regular::text,true);
 begin perform public.create_world_room(req,'alska-mogue','test-anchor-'||req,'top','Test room','');raise exception 'Admin unexpectedly allowed';exception when others then if sqlerrm='Admin unexpectedly allowed' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',lead::text,true);
 rid:=public.create_world_room(req,'alska-mogue','test-anchor-'||req,'top','Test room','');
 if public.create_world_room(req,'alska-mogue','test-anchor-'||req,'top','Test room','')<>rid then raise exception 'Retry changed room';end if;
 select count(*) into n from public.room_connections where world_id='alska-mogue' and ((from_room=rid and to_room='test-anchor-'||req) or (to_room=rid and from_room='test-anchor-'||req));
 if n<>2 then raise exception 'Missing reciprocal connection';end if;
 if not exists(select 1 from public.world_locations where id=rid and map_x=1000000 and map_y=999999) then raise exception 'Wrong position';end if;
 begin perform public.create_world_room(gen_random_uuid(),'alska-mogue','test-anchor-'||req,'top','Overlap','');raise exception 'Overlap allowed';exception when others then if sqlerrm not like 'That map position is occupied.%' then raise;end if;end;
 if not exists(select 1 from public.world_moderation where id=req and action='create_room' and actor=lead) then raise exception 'Audit missing';end if;
 if has_function_privilege('anon','public.create_world_room(uuid,text,text,text,text,text)','execute') then raise exception 'Anonymous access';end if;
end $$;
rollback;
select 'PASS: Lead Admin creation, Admin denial, reciprocal passage, position, occupied slot, retry, audit, anonymous denial' as result;
