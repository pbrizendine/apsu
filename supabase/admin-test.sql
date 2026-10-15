begin;
do $$
declare owner_id uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); player_id uuid:=gen_random_uuid(); ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); va uuid:=gen_random_uuid(); vb uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid(); target_number int; owner_number int; j jsonb; t text;
begin
 insert into auth.users(id,raw_user_meta_data) values(owner_id,'{"username":"Test owner"}'),(admin_id,'{"username":"Test admin"}'),(player_id,'{"username":"Test player"}');
 insert into public.world_staff values('alska-mogue',owner_id,'Server Owner'),('alska-mogue',admin_id,'Admin');
 insert into public.characters(id,player_id,world_id,slot,name,room_id) values(ca,owner_id,'alska-mogue',1,'Test owner','roomA'),(cb,player_id,'alska-mogue',1,'Test player','roomA');
 perform set_config('request.jwt.claim.sub',owner_id::text,true);perform public.enter_chat(va,ca,'roomA');
 perform set_config('request.jwt.claim.sub',player_id::text,true);perform public.enter_chat(vb,cb,'roomA');
 select number into target_number from public.room_chat_numbers where character_id=cb and room_id='roomA';
 select number into owner_number from public.room_chat_numbers where character_id=ca and room_id='roomA';
 execute 'set local role authenticated';
 perform public.world_command(request_id,vb,'Test report','report');perform public.world_command(request_id,vb,'Test report','report');
 begin perform public.admin_panel('alska-mogue');raise exception 'Nonstaff panel allowed';exception when others then if sqlerrm<>'Admin permission required for this world' then raise;end if;end;
 begin perform public.admin_chat(gen_random_uuid(),'alska-mogue','No');raise exception 'Nonstaff chat allowed';exception when others then if sqlerrm<>'Admin permission required for this world' then raise;end if;end;
 begin perform public.world_command(gen_random_uuid(),vb,'No','global');raise exception 'Nonstaff global allowed';exception when others then if sqlerrm<>'Admin permission required for this world' then raise;end if;end;
 begin perform public.player_world_warnings('alska-mogue',player_id);raise exception 'Warnings leaked';exception when others then if sqlerrm<>'Admin permission required for this world' then raise;end if;end;
 begin perform count(*) from public.world_moderation;raise exception 'Direct private access';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.world_command(gen_random_uuid(),va,target_number||' Test warning','warn');
 if jsonb_array_length(public.player_world_warnings('alska-mogue',player_id))<>1 then raise exception 'Missing warning';end if;
 perform public.world_command(gen_random_uuid(),va,'Test announcement','global');
 perform public.admin_chat(gen_random_uuid(),'alska-mogue','Private staff text');
 perform public.moderation_action(gen_random_uuid(),'alska-mogue','mute',player_id,'Test mute',5);
 perform set_config('request.jwt.claim.sub',player_id::text,true);
 begin perform public.send_visit_message(gen_random_uuid(),vb,'Blocked');raise exception 'Mute bypass';exception when others then if sqlerrm<>'You are muted in this world' then raise;end if;end;
 begin perform public.send_world_ooc(gen_random_uuid(),vb,'Blocked');raise exception 'OOC mute bypass';exception when others then if sqlerrm<>'You are muted in this world' then raise;end if;end;

 begin perform public.send_room_whisper(gen_random_uuid(),vb,owner_number,'Blocked');raise exception 'Whisper mute bypass';exception when others then if sqlerrm<>'You are muted in this world' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 begin perform public.moderation_action(gen_random_uuid(),'alska-mogue','grant_admin',player_id,'Bad promotion');raise exception 'Admin promoted staff';exception when others then if sqlerrm<>'Admin permission required for this world' then raise;end if;end;
 begin perform public.save_room('alska-mogue','roomA','Wrong','Wrong','Wrong','[]',null);raise exception 'Admin edited room';exception when others then if sqlerrm<>'Admin permission required for this world' then raise;end if;end;
 begin perform public.admin_panel('other-world');raise exception 'Cross-world staff access';exception when others then if sqlerrm<>'Admin permission required for this world' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.save_room('alska-mogue','roomA','Test room','Test region','Test description','[{"name":"Bench","description":"Wooden"}]',null);
 perform public.moderation_action(gen_random_uuid(),'alska-mogue','ban',player_id,'Test ban');
 perform set_config('request.jwt.claim.sub',player_id::text,true);
 begin perform public.enter_chat(gen_random_uuid(),cb,'roomA');raise exception 'Ban bypass';exception when others then if sqlerrm<>'You are banned from this world' then raise;end if;end;
 j:=public.moderation_status('other-world',clock_timestamp()-interval '1 hour');if (j->>'banned')::boolean then raise exception 'Ban crossed worlds';end if;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.moderation_action(gen_random_uuid(),'alska-mogue','unban',player_id,'Test unban');
 perform public.moderation_action(gen_random_uuid(),'alska-mogue','grant_lead',admin_id,'Test promotion');
 if public.staff_rank('alska-mogue',admin_id)<>2 then raise exception 'Promotion failed';end if;

 perform public.moderation_action(gen_random_uuid(),'alska-mogue','remove_admin',admin_id,'Test demotion');
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 begin perform public.admin_panel('alska-mogue');raise exception 'Demoted staff access';exception when others then if sqlerrm<>'Admin permission required for this world' then raise;end if;end;
 begin insert into storage.objects(bucket_id,name) values('room-images','alska-mogue/test.png');raise exception 'Nonowner room upload';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 insert into storage.objects(bucket_id,name) values('room-images','alska-mogue/test.png');
 execute 'reset role';
 foreach t in array array['world_staff','world_moderation','world_restrictions','world_reports','world_notices','staff_messages'] loop
 if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'Missing RLS %',t;end if;end loop;
end $$;
rollback;
select 'PASS: reports, private warnings/chat, role hierarchy, world bans, IC/OOC mutes, room editing, RLS' as result;
