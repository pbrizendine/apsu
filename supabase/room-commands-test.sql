begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); o uuid:=gen_random_uuid();
 ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); co uuid:=gen_random_uuid();
 va uuid:=gen_random_uuid(); vb uuid:=gen_random_uuid(); vo uuid:=gen_random_uuid();
 m uuid:=gen_random_uuid(); me uuid:=gen_random_uuid(); descr uuid:=gen_random_uuid(); nb integer; n integer;
begin
 insert into auth.users(id,raw_user_meta_data) values(a,'{}'),(b,'{}'),(o,'{}');
 insert into public.characters(id,player_id,world_id,slot,name,room_id) values(ca,a,'alska-mogue',1,'Henry','roomA'),(cb,b,'alska-mogue',1,'Jacob','roomA'),(co,o,'alska-mogue',1,'Observer','roomA');
 perform set_config('request.jwt.claim.sub',a::text,true); perform public.enter_chat(va,ca,'roomA');
 perform set_config('request.jwt.claim.sub',b::text,true); perform public.enter_chat(vb,cb,'roomA');
 perform set_config('request.jwt.claim.sub',o::text,true); perform public.enter_chat(vo,co,'roomA');
 select number into nb from public.room_chat_numbers where character_id=cb;
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform public.send_room_command(m,va,'Hello','directed',nb);
 perform public.send_room_command(m,va,'Hello','directed',nb);
 perform public.send_room_command(me,va,'waves.','action');
 perform public.send_room_command(descr,va,'The door is dusty.','description');
 select count(*) into n from public.room_messages where id=m and recipient_character=cb and recipient_name='Jacob';
 if n<>1 then raise exception 'Target snapshot or retry failed'; end if;
 execute 'set local role authenticated';
 select count(*) into n from public.room_messages where id in(m,me,descr);
 if n<>3 then raise exception 'Sender cannot read commands'; end if;
 perform set_config('request.jwt.claim.sub',b::text,true);
 select count(*) into n from public.room_messages where id in(m,me,descr);
 if n<>3 then raise exception 'Recipient cannot read commands'; end if;
 perform set_config('request.jwt.claim.sub',o::text,true);
 select count(*) into n from public.room_messages where id in(m,me,descr);
 if n<>3 then raise exception 'Public command not visible to observer'; end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',a::text,true);
 update public.characters set room_id='roomB' where id=cb;
 begin
  perform public.send_room_command(gen_random_uuid(),va,'Fail','directed',nb);
  raise exception 'Cross-room target accepted';
 exception when others then if sqlerrm<>'That character is not connected in this room' then raise; end if; end;
 begin
  perform public.send_room_command(gen_random_uuid(),vb,'Fail','action');
  raise exception 'Foreign visit accepted';
 exception when others then if sqlerrm<>'Chat visit expired' then raise; end if; end;
 if has_function_privilege('authenticated','public.pickup_item(uuid,text)','execute') then raise exception 'Test pickup still enabled'; end if;
 if has_function_privilege('anon','public.send_room_command(uuid,uuid,text,text,integer)','execute') then raise exception 'Anonymous commands enabled'; end if;
end $$;
rollback;
select 'PASS: public commands, recipients, retries, room checks, ownership, pickup disabled' as result;
