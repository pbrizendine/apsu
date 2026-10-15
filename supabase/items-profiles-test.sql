-- Rollback-only fixtures; never retain test users, items, uploads, or worlds.
begin;
do $$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();ca uuid:=gen_random_uuid();cb uuid:=gen_random_uuid();cx uuid:=gen_random_uuid();va uuid:=gen_random_uuid();vb uuid:=gen_random_uuid();req uuid:=gen_random_uuid();obj uuid:=gen_random_uuid();iid uuid;ids uuid[];wid text:='test-'||gen_random_uuid();w2 text:='test-'||gen_random_uuid();picture text;item jsonb;n int;saved public.character_items;
begin
 insert into auth.users(id,raw_user_meta_data) values(a,'{"username":"Item Admin"}'),(b,'{"username":"Item Member"}'),(outsider,'{"username":"Item Outsider"}');
 insert into public.worlds(id,name) values(wid,'Item Test World'),(w2,'Other Item Test World');
 insert into public.world_regions values(wid,'r','Test Region'),(w2,'r','Other Region');
 insert into public.world_locations(world_id,id,region_id,name,map_x,map_y) values(wid,'a','r','Room A',0,0),(w2,'a','r','Other Room',0,0);
 insert into public.world_staff values(wid,a,'Lead Admin');
 insert into public.characters(id,player_id,world_id,slot,name,room_id) values(ca,a,wid,1,'Alice','a'),(cb,b,wid,1,'Bob','a'),(cx,outsider,w2,1,'Other Character','a');
 perform set_config('request.jwt.claim.sub',a::text,true);perform public.enter_chat(va,ca,'a');
 perform set_config('request.jwt.claim.sub',b::text,true);perform public.enter_chat(vb,cb,'a');
 perform set_config('request.jwt.claim.sub',a::text,true);
 picture:=wid||'/'||gen_random_uuid();
 execute 'set local role authenticated';
 insert into storage.objects(bucket_id,name) values('item-images',picture),('player-banners',a::text||'/banner');
 perform public.save_player_banner();
 execute 'reset role';
 if public.player_banner(a) is distinct from a::text||'/banner' then raise exception 'Banner save failed';end if;
 item:=jsonb_build_object('name','Bussdown watch','description','A test watch','icon','watch','image_path',picture);
 perform public.admin_issue_items(req,wid,null,cb,'custom',2,null,item);
 perform public.admin_issue_items(req,wid,null,cb,'custom',2,null,item);
 if (select count(*) from public.character_items where character_id=cb and kind='custom')<>2 then raise exception 'Delivery retry duplicated';end if;
 if (select count(*) from public.world_moderation where id=req and target=b and action='give_items')<>1 then raise exception 'Delivery audit missing';end if;
 begin perform public.admin_issue_items(req,wid,null,cb,'custom',3,null,item);raise exception 'Retry changed arguments';exception when others then if sqlerrm<>'Request ID already used' then raise;end if;end;
 begin perform public.admin_issue_items(gen_random_uuid(),wid,null,cx,'custom',1,null,item);raise exception 'Cross-world delivery allowed';exception when others then if sqlerrm<>'Character unavailable in this world' then raise;end if;end;
 perform public.admin_issue_items(gen_random_uuid(),wid,null,cb,'lockpick-full',3);
 begin perform public.admin_issue_items(gen_random_uuid(),wid,null,cb,'lockpick-damaged',1);raise exception 'Fourth usable pick allowed';exception when others then if sqlerrm not like 'That character already has three usable lockpicks.%' then raise;end if;end;
 -- More than three broken picks coexist with three usable ones; the old smallint boundary no longer caps them.
 perform public.admin_issue_items(gen_random_uuid(),wid,null,cb,'lockpick-broken',100);
 insert into public.character_items(character_id,kind,capacity,slot) values(cb,'lockpick',0,40000);
 if (select count(*) from public.character_items where character_id=cb and kind='lockpick' and capacity=0)<>101 then raise exception 'Broken picks incorrectly limited';end if;
 -- A whole batch fails atomically rather than delivering just the first three.
 begin perform public.admin_issue_items(gen_random_uuid(),wid,null,ca,'lockpick-full',4);raise exception 'Over-cap delivery allowed';exception when others then if sqlerrm not like 'That character already has three usable lockpicks.%' then raise;end if;end;
 if exists(select 1 from public.character_items where character_id=ca) then raise exception 'Partial delivery survived';end if;
 perform public.save_room(wid,'a','Room A','Test Region','',jsonb_build_array(item||jsonb_build_object('id',obj,'script','custom')),null);
 perform set_config('request.jwt.claim.sub',b::text,true);
 saved:=public.pickup_room_object(cb,obj);
 if saved.appearance->>'name'<>'Bussdown watch' then raise exception 'Custom pickup missing metadata';end if;
 perform public.pickup_room_object(cb,obj);
 if (select count(*) from public.character_items where source_object=obj)<>1 then raise exception 'Pickup retry duplicated';end if;
 select array_agg(id order by id) into ids from public.character_items where character_id=cb and kind='custom';
 perform public.inventory_batch(gen_random_uuid(),cb,ids,'drop');
 if (select count(*) from public.room_ground_items(cb) where appearance->>'image_path'=picture)<>3 then raise exception 'Drop lost appearance';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 foreach iid in array ids loop perform public.inventory_action(gen_random_uuid(),ca,iid,'pickup');end loop;
 perform public.inventory_batch(gen_random_uuid(),ca,ids,'give',cb);
 if (select count(*) from public.character_items where character_id=cb and appearance->>'image_path'=picture)<>3 then raise exception 'Give lost appearance';end if;
 -- Editing a stale room draft must never recreate a consumed object.
 perform public.save_room(wid,'a','Room A','Test Region','',jsonb_build_array(item||jsonb_build_object('id',obj,'script','custom')),null);
 if exists(select 1 from public.world_locations where world_id=wid and objects @> jsonb_build_array(jsonb_build_object('id',obj))) then raise exception 'Stale editor duplicated object';end if;
 perform set_config('request.jwt.claim.sub',b::text,true);
 execute 'set local role authenticated';
 begin perform public.admin_issue_items(gen_random_uuid(),wid,null,cb,'custom',1,null,item);raise exception 'Member spawned items';exception when others then if sqlerrm<>'Admin permission required for this world' then raise;end if;end;
 select count(*) into n from storage.objects where bucket_id='item-images' and name=picture;
 if n<>1 then raise exception 'Member cannot view item image';end if;
 begin insert into storage.objects(bucket_id,name) values('player-banners',a::text||'/other-banner');raise exception 'Other player banner write';exception when insufficient_privilege then null;end;
 begin update storage.objects set name=b::text||'/banner' where bucket_id='player-banners' and name=a::text||'/banner';if found then raise exception 'Other banner update';end if;exception when insufficient_privilege then null;end;
 begin insert into storage.objects(bucket_id,name) values('item-images',wid||'/unauthorized');raise exception 'Member uploaded item image';exception when insufficient_privilege then null;end;
 select count(*) into n from public.character_items where character_id=ca;if n<>0 then raise exception 'Inventory privacy leak';end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',outsider::text,true);execute 'set local role authenticated';
 select count(*) into n from storage.objects where bucket_id='item-images' and name=picture;if n<>0 then raise exception 'Other-world image leak';end if;
 execute 'reset role';
 if has_function_privilege('anon','public.admin_issue_items(uuid,text,text,uuid,text,int,text,jsonb)','execute') or has_function_privilege('authenticated','public.item_appearance(text,jsonb)','execute') or has_function_privilege('anon','public.save_player_banner(boolean)','execute') then raise exception 'Unexpected RPC privileges';end if;
end $$;
rollback;
select 'PASS: custom pickup/drop/give metadata, delivery retry and audit, world permissions, atomic three-pick cap, uncapped broken picks, stale room edits, private inventories, item-image RLS, own-player banners' as result;
