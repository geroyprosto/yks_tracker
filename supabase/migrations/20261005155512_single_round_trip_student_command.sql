-- The website's student check and durable command share one PostgREST trip.
-- Keep the existing owner/MCP command gateway unchanged for its other callers.
create function public.yks_student_command(request_id uuid,command_type text,payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare account jsonb;
begin
 account:=public.classroom_identity();
 if account is null or account->>'role' is distinct from 'student'
  or account->>'status' is distinct from 'approved' then
  raise exception 'STUDENT_REQUIRED';
 end if;
 -- Existing command validation, owner locking, receipts, rate limits, revision
 -- checks and state-cache triggers remain in the same authoritative path.
 return public.yks_command(request_id,command_type,payload);
end $$;
revoke all on function public.yks_student_command(uuid,text,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.yks_student_command(uuid,text,jsonb) to authenticated;
