-- Apply after items-profiles.sql. Replaces only the existing status RPC;
-- permissions, kick audit history, bans and active-visit revocation stay intact.
-- NULL starts a new page session using database time, never the player's clock.
begin;
create or replace function public.moderation_status(p_world text,p_since timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
declare boundary timestamptz:=coalesce(p_since,clock_timestamp());
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 return jsonb_build_object('since',boundary,'rank',public.staff_rank(p_world),'banned',public.world_blocked(p_world,auth.uid(),'ban'),'kicked',exists(select 1 from public.world_moderation where world_id=p_world and target=auth.uid() and action='kick' and created_at>boundary),'notices',coalesce((select jsonb_agg(n order by n.created_at,n.id) from public.world_notices n where n.world_id=p_world and (n.target is null or n.target=auth.uid()) and n.created_at>boundary),'[]'::jsonb),'staff',coalesce((select jsonb_agg(jsonb_build_object('player_id',s.player_id,'role',s.role,'characters',coalesce((select jsonb_agg(c.id) from public.characters c where c.player_id=s.player_id and c.world_id=s.world_id),'[]'::jsonb))) from (select world_id,player_id,role from public.world_staff where world_id=p_world union all select p_world,player_id,'APSU Founder' from public.player_badges where badge='APSU Founder') s where s.world_id=p_world),'[]'::jsonb));
end $$;
notify pgrst, 'reload schema';
commit;
