create table public.agent_house_reports (
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id text not null check (length(run_id) between 1 and 128 and run_id ~ '^[A-Za-z0-9._-]+$'),
  mode text not null check (mode in ('sample', 'live')),
  generated_at timestamptz not null check (isfinite(generated_at)),
  report jsonb not null check (octet_length(report::text) <= 196608),
  primary key (user_id, run_id)
);
create index agent_house_reports_latest on public.agent_house_reports (user_id, mode, generated_at desc, run_id desc);

alter table public.agent_house_reports enable row level security;
revoke all on public.agent_house_reports from public, anon, authenticated, service_role;
grant select on public.agent_house_reports to authenticated;

create function private.agent_house_eligible(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.classroom_accounts a
    where a.id = p_user_id and a.status = 'approved'
      and (a.role = 'student' or (a.role = 'admin' and public.mcp_owner_allowed(a.id)))
  )
$$;
revoke all on function private.agent_house_eligible(uuid) from public, anon, authenticated, service_role;

-- The RLS predicate can check the caller's own account without exposing the
-- classroom account table or accepting an arbitrary user ID from the caller.
create function private.agent_house_can_read() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_browser_session() and private.agent_house_eligible(auth.uid())
$$;
revoke all on function private.agent_house_can_read() from public, anon, authenticated, service_role;
grant execute on function private.agent_house_can_read() to authenticated;
create policy agent_house_read_self on public.agent_house_reports for select to authenticated
  using (user_id = (select auth.uid()) and (select private.agent_house_can_read()));

-- Both authorized publication paths share an immutable insert and replay check.
create function private.agent_house_insert_report(p_user_id uuid, p_report jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  saved_report jsonb;
begin
  if jsonb_typeof(p_report) is distinct from 'object'
    or p_report->'schema_version' is distinct from '1'::jsonb
    or jsonb_typeof(p_report->'run_id') is distinct from 'string'
    or jsonb_typeof(p_report->'mode') is distinct from 'string'
    or jsonb_typeof(p_report->'generated_at') is distinct from 'string'
    or jsonb_typeof(p_report->'week_start') is distinct from 'string'
    or jsonb_typeof(p_report->'title') is distinct from 'string'
    or jsonb_typeof(p_report->'agents') is distinct from 'array'
    or p_report - array['schema_version','run_id','mode','generated_at','week_start','title','agents'] <> '{}'::jsonb
    or octet_length(p_report::text) > 196608
  then raise exception 'INVALID_INPUT'; end if;

  insert into public.agent_house_reports (user_id, run_id, mode, generated_at, report)
    values (p_user_id, p_report->>'run_id', p_report->>'mode', (p_report->>'generated_at')::timestamptz, p_report)
    on conflict (user_id, run_id) do nothing returning report into saved_report;
  if found then return jsonb_build_object('run', saved_report, 'created', true); end if;

  select report into saved_report from public.agent_house_reports
    where user_id = p_user_id and run_id = p_report->>'run_id';
  if saved_report is distinct from p_report then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('run', saved_report, 'created', false);
end $$;
revoke all on function private.agent_house_insert_report(uuid, jsonb) from public, anon, authenticated, service_role;

-- Publish through the server so all browser and MCP writes pass the same
-- strict application schema before reaching these service-only RPCs.
create function private.agent_house_save_for_user(p_user_id uuid, p_report jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.agent_house_eligible(p_user_id) then raise exception 'STUDENT_REQUIRED'; end if;
  return private.agent_house_insert_report(p_user_id, p_report);
end $$;
create function public.agent_house_save_for_user(p_user_id uuid, p_report jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.agent_house_save_for_user(p_user_id, p_report)
$$;
revoke all on function private.agent_house_save_for_user(uuid, jsonb), public.agent_house_save_for_user(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.agent_house_save_for_user(uuid, jsonb), public.agent_house_save_for_user(uuid, jsonb)
  to service_role;

create function private.agent_house_publish_for_owner(p_user_id uuid, p_report jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.mcp_owner_allowed(p_user_id) then raise exception 'OWNER_REQUIRED'; end if;
  return private.agent_house_save_for_user(p_user_id, p_report);
end $$;
create function public.agent_house_publish_for_owner(p_user_id uuid, p_report jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select private.agent_house_publish_for_owner(p_user_id, p_report)
$$;
revoke all on function private.agent_house_publish_for_owner(uuid, jsonb), public.agent_house_publish_for_owner(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.agent_house_publish_for_owner(uuid, jsonb), public.agent_house_publish_for_owner(uuid, jsonb)
  to service_role;
