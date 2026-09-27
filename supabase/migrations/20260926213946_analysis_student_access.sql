-- The verified server may generate reports for approved students as well as
-- the existing owner. The older owner assertion still protects MCP and diary AI.
create function private.analysis_require_target_study_user(p_user_id uuid) returns uuid
 language plpgsql security definer set search_path='' as $$
begin
 if p_user_id is null or not (
  exists (select 1 from public.classroom_accounts a
   where a.id=p_user_id and a.role='student' and a.status='approved')
  or (exists (select 1 from public.owner_allowlist o where o.user_id=p_user_id)
   and not exists (select 1 from public.classroom_accounts a
    where a.id=p_user_id and (a.role<>'admin' or a.status<>'approved')))
 ) then raise exception 'STUDENT_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 return p_user_id;
end $$;
revoke all on function private.analysis_require_target_study_user(uuid)
 from public,anon,authenticated,service_role;

create or replace function public.analysis_schedule_set_for_owner(
 p_user_id uuid,p_enabled boolean,p_start_date date
) returns public.analysis_settings
 language plpgsql security definer set search_path='' as $$
begin
 perform private.analysis_require_target_study_user(p_user_id);
 return private.analysis_schedule_set_for(p_user_id,p_enabled,p_start_date);
end $$;

create or replace function public.analysis_report_claim_for_owner(
 p_user_id uuid,p_request_id uuid,p_start_date date,p_end_date date,p_source_hash text,
 p_max_requests integer,p_monthly_budget_usd numeric,p_reserved_cost_usd numeric
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.analysis_require_target_study_user(p_user_id);
 return private.analysis_claim_for(p_user_id,p_request_id,p_start_date,p_end_date,
  p_source_hash,p_max_requests,p_monthly_budget_usd,p_reserved_cost_usd);
end $$;

create or replace function public.analysis_report_finalize(
 p_user_id uuid,p_report_id uuid,p_request_id uuid,p_body text,p_summary jsonb,
 p_usage jsonb,p_actual_cost_usd numeric
) returns public.analysis_reports language plpgsql security definer set search_path='' as $$
begin
 perform private.analysis_require_target_study_user(p_user_id);
 return private.analysis_finalize_for(p_user_id,p_report_id,p_request_id,p_body,
  p_summary,p_usage,p_actual_cost_usd);
end $$;

create or replace function public.analysis_report_fail(
 p_user_id uuid,p_report_id uuid,p_request_id uuid,p_error_message text
) returns public.analysis_reports language plpgsql security definer set search_path='' as $$
begin
 perform private.analysis_require_target_study_user(p_user_id);
 return private.analysis_fail_for(p_user_id,p_report_id,p_request_id,p_error_message);
end $$;

-- Keep the manual study field added in the later owner-only source migration.
create or replace function public.analysis_source_state(p_user_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
begin
 perform private.analysis_require_target_study_user(p_user_id);
 return private.analysis_source_state_for(p_user_id) || jsonb_build_object(
  'manual_study_entries',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by t.study_date desc,t.created_at desc,t.id)
   from public.manual_study_entries t where t.user_id=p_user_id),'[]'::jsonb));
end $$;

-- These public RPCs remain server-only despite their broader target check.
revoke all on function public.analysis_schedule_set_for_owner(uuid,boolean,date),
 public.analysis_report_claim_for_owner(uuid,uuid,date,date,text,integer,numeric,numeric),
 public.analysis_report_finalize(uuid,uuid,uuid,text,jsonb,jsonb,numeric),
 public.analysis_report_fail(uuid,uuid,uuid,text),public.analysis_source_state(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.analysis_schedule_set_for_owner(uuid,boolean,date),
 public.analysis_report_claim_for_owner(uuid,uuid,date,date,text,integer,numeric,numeric),
 public.analysis_report_finalize(uuid,uuid,uuid,text,jsonb,jsonb,numeric),
 public.analysis_report_fail(uuid,uuid,uuid,text),public.analysis_source_state(uuid)
 to service_role;
