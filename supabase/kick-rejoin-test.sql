-- Disposable fixture accounts, rolled back along with every moderation action.
begin;
do $$
declare
 owner_id uuid:=gen_random_uuid(); player_id uuid:=gen_random_uuid();
 character_id uuid:=gen_random_uuid(); first_visit uuid:=gen_random_uuid();
 second_visit uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid();
 before_kick timestamptz; fresh timestamptz; result jsonb;
begin
 insert into auth.users(id,raw_user_meta_data) values
  (owner_id,'{"username":"Kick test owner"}'),(player_id,'{"username":"Kick test player"}');
 insert into public.world_staff values('alska-mogue',owner_id,'Server Owner');
 insert into public.characters(id,player_id,world_id,slot,name,room_id)
 values(character_id,player_id,'alska-mogue',1,'Kick test player','roomA');
 perform set_config('request.jwt.claim.sub',player_id::text,true);
 execute 'set local role authenticated';
 result:=public.moderation_status('alska-mogue',null);
 before_kick:=(result->>'since')::timestamptz;
 if before_kick is null or (result->>'kicked')::boolean then raise exception 'Initial session failed';end if;
 perform public.enter_chat(first_visit,character_id,'roomA');

 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.moderation_action(request_id,'alska-mogue','kick',player_id,'Regression fixture');
 perform set_config('request.jwt.claim.sub',player_id::text,true);
 result:=public.moderation_status('alska-mogue',before_kick);
 if not (result->>'kicked')::boolean then raise exception 'Current session was not kicked';end if;
 if public.touch_chat(first_visit,false) then raise exception 'Kicked visit revived';end if;
 begin
  perform public.enter_chat(first_visit,character_id,'roomA');
  raise exception 'Kicked visit reused';
 exception when others then if sqlerrm<>'Chat visit expired' then raise;end if;end;
 -- This reproduces the old device-clock bug without changing any machine clock.
 result:=public.moderation_status('alska-mogue',clock_timestamp()-interval '1 day');
 if not (result->>'kicked')::boolean then raise exception 'Clock-skew reproduction failed';end if;

 result:=public.moderation_status('alska-mogue',null);
 fresh:=(result->>'since')::timestamptz;
 if fresh<=before_kick or (result->>'kicked')::boolean or (result->>'banned')::boolean then
  raise exception 'Old kick rejected the new session';end if;
 if jsonb_array_length(result->'notices')<>0 then raise exception 'Old notice replayed';end if;
 perform public.enter_chat(second_visit,character_id,'roomA');
 if not public.touch_chat(second_visit,false) then raise exception 'Cannot play after rejoin';end if;
 -- Retrying the same moderation request must not kick a subsequent session again.
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.moderation_action(request_id,'alska-mogue','kick',player_id,'Regression fixture');
 perform set_config('request.jwt.claim.sub',player_id::text,true);
 if not public.touch_chat(second_visit,false) then raise exception 'Kick retry affected new visit';end if;
 result:=public.moderation_status('alska-mogue',fresh);
 if (result->>'kicked')::boolean or (result->>'since')::timestamptz<>fresh then raise exception 'Session boundary changed';end if;

 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.moderation_action(gen_random_uuid(),'alska-mogue','kick',player_id,'Another kick');
 perform set_config('request.jwt.claim.sub',player_id::text,true);
 result:=public.moderation_status('alska-mogue',fresh);
 if not (result->>'kicked')::boolean then raise exception 'Subsequent kick ignored';end if;
 result:=public.moderation_status('another-world',before_kick);
 if (result->>'kicked')::boolean or jsonb_array_length(result->'notices')<>0 then raise exception 'Kick crossed worlds';end if;

 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.moderation_action(gen_random_uuid(),'alska-mogue','ban',player_id,'Ban fixture');
 perform set_config('request.jwt.claim.sub',player_id::text,true);
 result:=public.moderation_status('alska-mogue',null);
 if not (result->>'banned')::boolean then raise exception 'Fresh session bypassed ban';end if;
 begin
  perform public.enter_chat(gen_random_uuid(),character_id,'roomA');
  raise exception 'Banned player joined';
 exception when others then if sqlerrm<>'You are banned from this world' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.moderation_status('alska-mogue',null);
  raise exception 'Anonymous status allowed';
 exception when others then if sqlerrm<>'Sign in required' then raise;end if;end;
 execute 'reset role';
 if (select count(*) from public.world_moderation where target=player_id and action='kick')<>2 then
  raise exception 'Kick history was lost or duplicated';end if;
end $$;
rollback;
select 'PASS: kick ends current visit; immediate rejoin, retry safety, later kicks, world scope, bans and anonymous denial' as result;
