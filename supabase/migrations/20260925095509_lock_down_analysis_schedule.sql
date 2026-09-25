-- A signed-in client must not call a public SECURITY DEFINER schedule mutation.
-- The verified Next.js server forwards the authenticated owner's UUID with its
-- server-only Supabase secret key.
revoke all on function public.analysis_schedule_set(boolean,date)
 from public,anon,authenticated,service_role;

create function public.analysis_schedule_set_for_owner(
 p_user_id uuid,p_enabled boolean,p_start_date date
) returns public.analysis_settings
 language plpgsql security definer set search_path='' as $$
begin
 perform private.analysis_require_target_owner(p_user_id);
 return private.analysis_schedule_set_for(p_user_id,p_enabled,p_start_date);
end $$;
revoke all on function public.analysis_schedule_set_for_owner(uuid,boolean,date)
 from public,anon,authenticated,service_role;
grant execute on function public.analysis_schedule_set_for_owner(uuid,boolean,date)
 to service_role;
