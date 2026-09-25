-- Phase 3 report persistence. The server verifies the owner before using
-- service_role to claim or complete a report.
create table public.analysis_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 start_date date,
 updated_at timestamptz not null default now(),
 check (not enabled or start_date is not null)
);

create table public.analysis_reports (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 start_date date not null,
 end_date date not null,
 source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
 status text not null check (status in ('pending','running','completed','failed','uncertain')),
 body text check (body is null or length(body) between 1 and 100000),
 summary jsonb check (summary is null or jsonb_typeof(summary)='object'),
 usage jsonb check (usage is null or jsonb_typeof(usage)='object'),
 error_message text check (error_message is null or length(error_message) between 1 and 1000),
 request_id uuid not null,
 lease_expires_at timestamptz,
 reserved_month date,
 reserved_cost_usd numeric not null default 0 check (reserved_cost_usd>=0),
 actual_cost_usd numeric check (actual_cost_usd is null or actual_cost_usd>=0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (id,user_id),
 unique (user_id,start_date,end_date,source_hash),
 unique (user_id,request_id),
 check (start_date<=end_date),
 check (status<>'completed' or body is not null),
 check (status<>'running' or lease_expires_at is not null)
);
create index analysis_reports_user_period on public.analysis_reports(user_id,end_date desc,created_at desc);

-- Bind every request id to its original period and source hash.
create table public.analysis_report_requests (
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 report_id uuid not null,
 start_date date not null,
 end_date date not null,
 source_hash text not null,
 created_at timestamptz not null default now(),
 primary key (user_id,request_id),
 foreign key (report_id,user_id) references public.analysis_reports(id,user_id) on delete cascade
);

-- This amount includes active reservations and completed estimated costs.
create table public.analysis_usage (
 user_id uuid not null references auth.users(id) on delete cascade,
 month date not null check (extract(day from month)=1),
 requests integer not null default 0 check (requests>=0),
 estimated_cost_usd numeric not null default 0 check (estimated_cost_usd>=0),
 primary key (user_id,month)
);

do $$ declare t text; begin
 foreach t in array array['analysis_settings','analysis_reports','analysis_report_requests','analysis_usage'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy analysis_owner_read on public.%I for select to authenticated using (user_id=(select auth.uid()) and exists (select 1 from public.owner_allowlist where user_id=(select auth.uid())))',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated,service_role',t);
 end loop;
end $$;

create function private.analysis_require_target_owner(p_user_id uuid) returns uuid
 language plpgsql security definer set search_path='' as $$
begin
 if p_user_id is null or not exists (
  select 1 from public.owner_allowlist where user_id=p_user_id
 ) then raise exception 'OWNER_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 return p_user_id;
end $$;

create function private.analysis_schedule_set_for(p_user_id uuid,p_enabled boolean,p_start_date date)
 returns public.analysis_settings language plpgsql security definer set search_path='' as $$
declare result public.analysis_settings;
begin
 if p_enabled is null or (p_enabled and p_start_date is null) then raise exception 'INVALID_INPUT'; end if;
 insert into public.analysis_settings(user_id,enabled,start_date,updated_at)
 values(p_user_id,p_enabled,p_start_date,clock_timestamp())
 on conflict (user_id) do update set
  enabled=excluded.enabled,start_date=excluded.start_date,updated_at=excluded.updated_at
 returning * into result;
 insert into public.audit_log(user_id,entity,entity_id,action,new_value,source)
 values(p_user_id,'analysis_settings',p_user_id,'analysis.schedule.set',
  jsonb_build_object('enabled',p_enabled,'start_date',p_start_date),'app');
 return result;
end $$;

create function private.analysis_claim_for(
 p_user_id uuid,p_request_id uuid,p_start_date date,p_end_date date,p_source_hash text,
 p_max_requests integer,p_monthly_budget_usd numeric,p_reserved_cost_usd numeric
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 report public.analysis_reports;
 prior public.analysis_report_requests;
 monthly public.analysis_usage;
 at_time timestamptz:=clock_timestamp();
 billing_month date:=(clock_timestamp() at time zone 'Europe/Istanbul')::date;
begin
 if p_request_id is null or p_start_date is null or p_end_date is null
    or p_end_date<p_start_date or p_source_hash is null
    or p_source_hash !~ '^[0-9a-f]{64}$'
    or p_max_requests is null or p_max_requests<1
    or p_monthly_budget_usd is null or p_monthly_budget_usd<0
    or p_reserved_cost_usd is null or p_reserved_cost_usd<0
    or p_reserved_cost_usd>p_monthly_budget_usd
    or p_monthly_budget_usd::text='NaN' or p_reserved_cost_usd::text='NaN'
 then raise exception 'INVALID_INPUT'; end if;
 billing_month:=date_trunc('month',billing_month::timestamp)::date;

 select * into prior from public.analysis_report_requests
 where user_id=p_user_id and request_id=p_request_id;
 if found then
  if prior.start_date<>p_start_date or prior.end_date<>p_end_date
     or prior.source_hash<>p_source_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  select * into report from public.analysis_reports where id=prior.report_id and user_id=p_user_id;
  return jsonb_build_object('report',to_jsonb(report),'claimed',false,'replayed',true);
 end if;

 select * into report from public.analysis_reports
 where user_id=p_user_id and start_date=p_start_date and end_date=p_end_date
   and source_hash=p_source_hash for update;

 if found and report.status='running' and report.lease_expires_at<=at_time then
  update public.analysis_reports set status='uncertain',
   error_message='REPORT_LEASE_EXPIRED',updated_at=at_time
  where id=report.id returning * into report;
 end if;

 -- An uncertain or failed provider call must not be sent again automatically.
 if found then
  insert into public.analysis_report_requests(user_id,request_id,report_id,start_date,end_date,source_hash)
  values(p_user_id,p_request_id,report.id,p_start_date,p_end_date,p_source_hash);
  return jsonb_build_object('report',to_jsonb(report),'claimed',false,'replayed',false);
 end if;

 insert into public.analysis_usage(user_id,month) values(p_user_id,billing_month)
 on conflict (user_id,month) do nothing;
 select * into monthly from public.analysis_usage
 where user_id=p_user_id and month=billing_month for update;
 if monthly.requests>=p_max_requests
    or monthly.estimated_cost_usd+p_reserved_cost_usd>p_monthly_budget_usd
 then raise exception 'AI_LIMIT_REACHED'; end if;
 update public.analysis_usage set requests=requests+1,
  estimated_cost_usd=estimated_cost_usd+p_reserved_cost_usd
 where user_id=p_user_id and month=billing_month;

 insert into public.analysis_reports(
  user_id,start_date,end_date,source_hash,status,request_id,
  lease_expires_at,reserved_month,reserved_cost_usd
 ) values (
  p_user_id,p_start_date,p_end_date,p_source_hash,'running',p_request_id,
  at_time+interval '10 minutes',billing_month,p_reserved_cost_usd
 ) returning * into report;
 insert into public.analysis_report_requests(user_id,request_id,report_id,start_date,end_date,source_hash)
 values(p_user_id,p_request_id,report.id,p_start_date,p_end_date,p_source_hash);
 insert into public.audit_log(user_id,entity,entity_id,action,new_value,source)
 values(p_user_id,'analysis_report',report.id,'analysis.report.claim',
  jsonb_build_object('start_date',p_start_date,'end_date',p_end_date,'source_hash',p_source_hash),'app');
 return jsonb_build_object('report',to_jsonb(report),'claimed',true,'replayed',false);
end $$;

create function private.analysis_finalize_for(
 p_user_id uuid,p_report_id uuid,p_request_id uuid,p_body text,p_summary jsonb,
 p_usage jsonb,p_actual_cost_usd numeric
) returns public.analysis_reports language plpgsql security definer set search_path='' as $$
declare report public.analysis_reports;
begin
 if p_report_id is null or p_request_id is null or p_body is null
    or length(btrim(p_body))=0 or length(p_body)>100000
    or p_summary is null or jsonb_typeof(p_summary)<>'object'
    or p_usage is null or jsonb_typeof(p_usage)<>'object'
    or p_actual_cost_usd is null or p_actual_cost_usd<0
    or p_actual_cost_usd::text='NaN'
 then raise exception 'INVALID_INPUT'; end if;
 select * into report from public.analysis_reports
 where id=p_report_id and user_id=p_user_id for update;
 if not found then raise exception 'REPORT_NOT_FOUND'; end if;
 if report.request_id<>p_request_id or report.status='failed'
 then raise exception 'STALE_ATTEMPT'; end if;
 if report.status='completed' then
  if report.body=p_body and report.summary=p_summary and report.usage=p_usage
     and report.actual_cost_usd=p_actual_cost_usd then return report; end if;
  raise exception 'IDEMPOTENCY_CONFLICT';
 end if;
 update public.analysis_usage set estimated_cost_usd=
  greatest(0,estimated_cost_usd-report.reserved_cost_usd+p_actual_cost_usd)
 where user_id=p_user_id and month=report.reserved_month;
 update public.analysis_reports set status='completed',body=p_body,summary=p_summary,
  usage=p_usage,actual_cost_usd=p_actual_cost_usd,error_message=null,
  lease_expires_at=null,updated_at=clock_timestamp()
 where id=report.id returning * into report;
 insert into public.audit_log(user_id,entity,entity_id,action,new_value,source)
 values(p_user_id,'analysis_report',report.id,'analysis.report.complete',
  jsonb_build_object('request_id',p_request_id,'actual_cost_usd',p_actual_cost_usd),'app');
 return report;
end $$;

create function private.analysis_fail_for(
 p_user_id uuid,p_report_id uuid,p_request_id uuid,p_error_message text
) returns public.analysis_reports language plpgsql security definer set search_path='' as $$
declare report public.analysis_reports;
begin
 if p_report_id is null or p_request_id is null or p_error_message is null
    or length(btrim(p_error_message))=0 or length(p_error_message)>1000
 then raise exception 'INVALID_INPUT'; end if;
 select * into report from public.analysis_reports
 where id=p_report_id and user_id=p_user_id for update;
 if not found then raise exception 'REPORT_NOT_FOUND'; end if;
 if report.request_id<>p_request_id then raise exception 'STALE_ATTEMPT'; end if;
 if report.status='completed' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 if report.status='failed' then return report; end if;
 -- A provider error may still have incurred cost; retain the reservation.
 update public.analysis_reports set status='failed',error_message=p_error_message,
  lease_expires_at=null,updated_at=clock_timestamp()
 where id=report.id returning * into report;
 insert into public.audit_log(user_id,entity,entity_id,action,new_value,source)
 values(p_user_id,'analysis_report',report.id,'analysis.report.fail',
  jsonb_build_object('request_id',p_request_id,'error_message',p_error_message),'app');
 return report;
end $$;

-- Explicit grants matter for new Supabase projects whose Data API does not
-- automatically expose newly created public tables/functions.
create function public.analysis_schedule_set(p_enabled boolean,p_start_date date)
 returns public.analysis_settings language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=private.require_owner();
begin return private.analysis_schedule_set_for(owner_id,p_enabled,p_start_date); end $$;

create function public.analysis_report_claim_for_owner(
 p_user_id uuid,p_request_id uuid,p_start_date date,p_end_date date,p_source_hash text,
 p_max_requests integer,p_monthly_budget_usd numeric,p_reserved_cost_usd numeric
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.analysis_require_target_owner(p_user_id);
 return private.analysis_claim_for(p_user_id,p_request_id,p_start_date,p_end_date,
  p_source_hash,p_max_requests,p_monthly_budget_usd,p_reserved_cost_usd);
end $$;

create function public.analysis_report_finalize(
 p_user_id uuid,p_report_id uuid,p_request_id uuid,p_body text,p_summary jsonb,
 p_usage jsonb,p_actual_cost_usd numeric
) returns public.analysis_reports language plpgsql security definer set search_path='' as $$
begin
 perform private.analysis_require_target_owner(p_user_id);
 return private.analysis_finalize_for(p_user_id,p_report_id,p_request_id,p_body,
  p_summary,p_usage,p_actual_cost_usd);
end $$;

create function public.analysis_report_fail(
 p_user_id uuid,p_report_id uuid,p_request_id uuid,p_error_message text
) returns public.analysis_reports language plpgsql security definer set search_path='' as $$
begin
 perform private.analysis_require_target_owner(p_user_id);
 return private.analysis_fail_for(p_user_id,p_report_id,p_request_id,p_error_message);
end $$;

revoke all on function private.analysis_require_target_owner(uuid),
 private.analysis_schedule_set_for(uuid,boolean,date),
 private.analysis_claim_for(uuid,uuid,date,date,text,integer,numeric,numeric),
 private.analysis_finalize_for(uuid,uuid,uuid,text,jsonb,jsonb,numeric),
 private.analysis_fail_for(uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role;
revoke all on function public.analysis_schedule_set(boolean,date),
 public.analysis_report_claim_for_owner(uuid,uuid,date,date,text,integer,numeric,numeric),
 public.analysis_report_finalize(uuid,uuid,uuid,text,jsonb,jsonb,numeric),
 public.analysis_report_fail(uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.analysis_schedule_set(boolean,date) to authenticated;
grant execute on function public.analysis_report_claim_for_owner(uuid,uuid,date,date,text,integer,numeric,numeric),
 public.analysis_report_finalize(uuid,uuid,uuid,text,jsonb,jsonb,numeric),
 public.analysis_report_fail(uuid,uuid,uuid,text)
 to service_role;
-- Scheduled reports need the same input shape as yks_state(), but cannot use
-- a browser session. This route is available only to the trusted server key.
create function private.analysis_source_state_for(p_user_id uuid) returns jsonb
 language sql security definer set search_path='' as $$
 select jsonb_build_object(
  'server_now',date_trunc('second',clock_timestamp()),
  'settings',(select to_jsonb(p)-'user_id'-'updated_at'
   from public.profiles p where p.user_id=p_user_id),
  'tasks',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by plan_date,position,created_at,id)
   from public.tasks t where t.user_id=p_user_id),'[]'::jsonb),
  'topics',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by exam,subject,name)
   from public.topics t where t.user_id=p_user_id),'[]'::jsonb),
  'sessions',coalesce((select jsonb_agg(to_jsonb(s)-'user_id' order by started_at desc)
   from public.study_sessions s where s.user_id=p_user_id),'[]'::jsonb),
  'intervals',coalesce((select jsonb_agg(to_jsonb(i)-'user_id' order by started_at)
   from public.study_intervals i where i.user_id=p_user_id),'[]'::jsonb),
  'day_plans',coalesce((select jsonb_agg(to_jsonb(d)-'user_id' order by plan_date,version desc)
   from public.daily_plan_versions d where d.user_id=p_user_id),'[]'::jsonb),
  'topic_history',coalesce((select jsonb_agg(to_jsonb(h)-'user_id' order by changed_at desc)
   from public.topic_history h where h.user_id=p_user_id),'[]'::jsonb),
  'practice_entries',coalesce((select jsonb_agg(to_jsonb(p)-'user_id' order by practice_date desc,created_at desc,id)
   from public.practice_entries p where p.user_id=p_user_id),'[]'::jsonb),
  'exam_formats',coalesce((select jsonb_agg(to_jsonb(f) order by code,version desc)
   from public.exam_format_versions f),'[]'::jsonb),
  'exams',coalesce((select jsonb_agg(
   (to_jsonb(e)-'user_id') || jsonb_build_object('results',coalesce(
    (select jsonb_agg(to_jsonb(r)-'exam_id'-'user_id' order by section_key)
     from public.exam_results r where r.exam_id=e.id),'[]'::jsonb))
   order by exam_date desc,created_at desc,id)
   from public.exams e where e.user_id=p_user_id),'[]'::jsonb),
  'journal_entries',coalesce((select jsonb_agg(to_jsonb(j)-'user_id' order by journal_date desc,created_at desc)
   from public.journal_entries j where j.user_id=p_user_id),'[]'::jsonb),
  'day_marks',coalesce((select jsonb_agg(to_jsonb(d)-'user_id' order by mark_date desc)
   from public.day_marks d where d.user_id=p_user_id),'[]'::jsonb)
 )
$$;

create function public.analysis_source_state(p_user_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
begin
 perform private.analysis_require_target_owner(p_user_id);
 return private.analysis_source_state_for(p_user_id);
end $$;
revoke all on function private.analysis_source_state_for(uuid),
 public.analysis_source_state(uuid) from public,anon,authenticated,service_role;
grant execute on function public.analysis_source_state(uuid) to service_role;
