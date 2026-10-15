-- Public snapshot: owner@example.invalid is a placeholder, never an automatic grant to the original operator.
begin;
do $$ declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); path text; n int; begin
 insert into auth.users(id,raw_user_meta_data) values(a,'{}'),(b,'{}');
 insert into public.characters(id,player_id,world_id,slot,name,room_id) values(c,a,'alska-mogue',1,'Photo test','roomA');
 perform set_config('request.jwt.claim.sub',a::text,true);
 for n in 1..4 loop
 path:=a::text||'/'||c::text||'/'||n||'.png';
 insert into storage.objects(bucket_id,name) values('character-images',path);
 if n<=3 then perform public.add_character_image(c,path,'Character photo');else
 begin perform public.add_character_image(c,path,'Character photo');raise exception 'Fourth photo allowed';exception when others then if sqlerrm<>'Maximum 3 images per character' then raise;end if;end;end if;
 end loop;
 execute 'set local role authenticated';
 insert into storage.objects(bucket_id,name) values('player-pictures',a::text||'/portrait');
 begin insert into storage.objects(bucket_id,name) values('player-pictures',b::text||'/portrait');raise exception 'Foreign upload allowed';exception when insufficient_privilege then null;end;
 perform public.save_player_picture();
 if public.player_profile_extras(a)->>'photo_path'<>a::text||'/portrait' then raise exception 'Missing player picture';end if;
 if public.player_profile_extras(a)->'badges'<>'[]'::jsonb then raise exception 'Unexpected badges';end if;
 begin insert into public.player_badges values(a,'Founder');raise exception 'Self-awarded badge';exception when insufficient_privilege then null;end;
 execute 'reset role';
end $$;
rollback;
select 'PASS: three-photo cap, owner-only player upload, player picture, empty badges, badge assignment protected' as result;
select coalesce(u.raw_user_meta_data->>'username','Player') as username,b.badge from public.player_badges b join auth.users u on u.id=b.player_id where lower(u.email)='owner@example.invalid';
