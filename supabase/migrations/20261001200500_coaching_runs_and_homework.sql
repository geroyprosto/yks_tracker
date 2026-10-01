-- Coaching decisions use a frozen server cutoff and an owner-specific annual plan.
create table private.coaching_plans(
 user_id uuid primary key references auth.users(id) on delete cascade,
 plan jsonb not null check(jsonb_typeof(plan)='object'),updated_at timestamptz not null default now()
);
create table private.coaching_runs(
 user_id uuid not null references auth.users(id) on delete cascade,run_id uuid not null,
 cutoff timestamptz not null,previous_cutoff timestamptz,previous_report_id uuid,
 source_state jsonb not null,previous_metrics jsonb,plan jsonb,
 status text not null default 'running' check(status in ('running','failed','completed')),
 report_id uuid references public.analysis_reports(id),metrics jsonb,
 lease_until timestamptz not null default now()+interval '5 minutes',primary key(user_id,run_id)
);
create table private.coaching_homework(
 user_id uuid not null references auth.users(id) on delete cascade,assignment_key text not null,
 task_id uuid references public.tasks(id) on delete set null,run_id uuid not null,
 receipt jsonb not null,created_at timestamptz not null default now(),
 primary key(user_id,assignment_key),
 foreign key(user_id,run_id) references private.coaching_runs(user_id,run_id) on delete cascade
);
alter table private.coaching_plans enable row level security;
alter table private.coaching_runs enable row level security;
alter table private.coaching_homework enable row level security;
revoke all on private.coaching_plans,private.coaching_runs,private.coaching_homework from public,anon,authenticated,service_role;
create index coaching_runs_report_fk on private.coaching_runs(report_id);
create index coaching_homework_task_fk on private.coaching_homework(task_id);

create function public.coaching_plan_set(p_user_id uuid,p_plan jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.analysis_require_target_study_user(p_user_id);
 if jsonb_typeof(p_plan) is distinct from 'object'
  or jsonb_typeof(p_plan->'months') is distinct from 'array'
  or jsonb_typeof(p_plan->'daily_minutes') is distinct from 'number'
  or jsonb_typeof(p_plan->'buffer_ratio') is distinct from 'number'
 then raise exception 'INVALID_COACHING_PLAN'; end if;
 if not ((p_plan->>'daily_minutes')::numeric between 30 and 960
  and mod((p_plan->>'daily_minutes')::numeric,1)=0
  and (p_plan->>'buffer_ratio')::numeric between .1 and .5)
 then raise exception 'INVALID_COACHING_PLAN'; end if;
 insert into private.coaching_plans(user_id,plan) values(p_user_id,p_plan)
 on conflict(user_id) do update set plan=excluded.plan,updated_at=now();
end $$;

create function public.coaching_context(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous private.coaching_runs;
begin
 perform private.analysis_require_target_study_user(p_user_id);
 select * into previous from private.coaching_runs where user_id=p_user_id and status='completed' order by cutoff desc limit 1;
 return jsonb_build_object('plan',(select plan from private.coaching_plans where user_id=p_user_id),
 'previous_cutoff',previous.cutoff,'previous_report_id',previous.report_id,'previous_metrics',previous.metrics,
 'homework_results',coalesce((select jsonb_agg(h.receipt || jsonb_build_object('task_ids',case when h.task_id is null then '[]'::jsonb else jsonb_build_array(h.task_id) end,'status',case when h.task_id is null then 'removed' else h.receipt->>'status' end))
 from private.coaching_homework h where h.user_id=p_user_id and h.created_at>=date_trunc('week',now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul'),'[]'::jsonb));
end $$;

create function public.coaching_run_begin(p_user_id uuid,p_run_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare run private.coaching_runs; previous private.coaching_runs; cutoff_time timestamptz:=clock_timestamp(); source jsonb;
begin
 perform private.analysis_require_target_study_user(p_user_id);
 select * into run from private.coaching_runs where user_id=p_user_id and run_id=p_run_id;
 if found then
  if run.status='running' and run.lease_until>now() then raise exception 'COACHING_BUSY'; end if;
  if run.status<>'completed' then
   if exists(select 1 from private.coaching_runs other
     where other.user_id=p_user_id and other.run_id<>p_run_id
      and other.status='running' and other.lease_until>now()) then
    raise exception 'COACHING_BUSY';
   end if;
   update private.coaching_runs set status='running',lease_until=now()+interval '5 minutes'
    where user_id=p_user_id and run_id=p_run_id returning * into run;
  end if;
  return to_jsonb(run)-'user_id';
 end if;
 if exists(select 1 from private.coaching_runs where user_id=p_user_id and status='running' and lease_until>now()) then raise exception 'COACHING_BUSY'; end if;
 select * into previous from private.coaching_runs where user_id=p_user_id and status='completed' order by cutoff desc limit 1;
 source:=public.analysis_source_state(p_user_id)||jsonb_build_object('server_now',cutoff_time);
 -- Only the final day-plan version is needed by the planner; retain immutable raw task state.
 source:=source||jsonb_build_object('day_plans',coalesce((select jsonb_agg(to_jsonb(d)-'user_id') from
 (select distinct on (plan_date) * from public.daily_plan_versions where user_id=p_user_id order by plan_date,version desc) d),'[]'::jsonb));
 insert into private.coaching_runs(user_id,run_id,cutoff,previous_cutoff,previous_report_id,source_state,previous_metrics,plan)
 values(p_user_id,p_run_id,cutoff_time,coalesce(previous.cutoff,(select max(created_at) from public.analysis_reports where user_id=p_user_id and status='completed')),
 previous.report_id,source,previous.metrics,(select plan from private.coaching_plans where user_id=p_user_id)) returning * into run;
 return to_jsonb(run)-'user_id';
end $$;

create function public.coaching_homework_create(p_user_id uuid,p_run_id uuid,p_candidates jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; topic public.topics; task public.tasks; saved private.coaching_homework; receipt jsonb;
 results jsonb:='[]'; changed_days date[]:='{}'; day date; minutes int; capacity int; used int; annual jsonb; course uuid; reused boolean;
begin
 perform private.analysis_require_target_study_user(p_user_id);
 if jsonb_typeof(p_candidates) is distinct from 'array' or jsonb_array_length(p_candidates)>6 then raise exception 'INVALID_HOMEWORK'; end if;
 select run.plan into annual from private.coaching_runs run
  where run.user_id=p_user_id and run.run_id=p_run_id
   and run.status='running' and run.lease_until>now();
 if not found then raise exception 'COACHING_RUN_REQUIRED'; end if;
 if annual is null then return jsonb_build_object('results','[]'::jsonb,'data_gap','Aylık plan kayıtlı değil.'); end if;
 for item in select value from jsonb_array_elements(p_candidates) loop
  if length(item->>'key') not between 1 and 200 then raise exception 'INVALID_HOMEWORK_KEY'; end if;
  select * into saved from private.coaching_homework where user_id=p_user_id and assignment_key=item->>'key';
  if found then
   results:=results||jsonb_build_array(saved.receipt||jsonb_build_object('status',case when saved.task_id is null then 'removed' else 'existing' end,'task_ids',case when saved.task_id is null then '[]'::jsonb else jsonb_build_array(saved.task_id) end));continue;
  end if;
  select * into topic from public.topics where user_id=p_user_id and id=(item->>'topic_id')::uuid;
  if not found then raise exception 'INVALID_HOMEWORK_TOPIC'; end if;
  day:=(item->>'plan_date')::date; minutes:=(item->>'planned_minutes')::int;
  if day<(now() at time zone 'Europe/Istanbul')::date or day>(now() at time zone 'Europe/Istanbul')::date+14
   or minutes not between 15 and 360 or item->>'priority' not in ('normal','high')
   or item->>'study_type' not in ('Konu anlatımı','Soru çözümü','Yanlış analizi','Hâkimiyet kontrolü')
   or length(item->>'completion_criteria') not between 5 and 500 then raise exception 'INVALID_HOMEWORK'; end if;
  -- A repeated analysis must not duplicate an existing manual assignment for this topic and learning phase.
  select * into task from public.tasks t where t.user_id=p_user_id and t.topic_id=topic.id
   and t.plan_date>=date_trunc('week',day)::date and t.plan_date<date_trunc('week',day)::date+7
   and t.study_type=item->>'study_type' order by t.created_at limit 1;
  reused:=found;
  if not reused then
   capacity:=floor((annual->>'daily_minutes')::int*(1-(annual->>'buffer_ratio')::numeric));
   select coalesce(sum(planned_minutes),0) into used from public.tasks where user_id=p_user_id and plan_date=day;
   if used+minutes>capacity then
    results:=results||jsonb_build_array(jsonb_build_object('key',item->>'key','title',item->>'title','topic_id',topic.id,'status','capacity_exceeded','task_ids','[]'::jsonb));continue;
   end if;
   select c.id into course from public.education_courses c where c.user_id=p_user_id and c.context='yks' and c.term_id is null and c.exam=topic.exam and not c.archived and private.education_course_key(c.catalog_subject)=private.education_course_key(topic.subject) limit 1;
   insert into public.tasks(user_id,course_id,title,plan_date,exam,subject,topic_id,planned_minutes,priority,study_type,completion_criteria,notes,position)
   values(p_user_id,course,left(item->>'title',240),day,topic.exam,topic.subject,topic.id,minutes,item->>'priority',item->>'study_type',item->>'completion_criteria',left(coalesce(item->>'notes','')||E'\nGerekçe: '||coalesce(item->>'reason',''),10000),
   coalesce((select max(position)+1 from public.tasks where user_id=p_user_id and plan_date=day),0)) returning * into task;
   changed_days:=array_append(changed_days,day);
   insert into public.audit_log(user_id,entity,entity_id,action,new_value,source) values(p_user_id,'task',task.id,'coaching.homework.create',to_jsonb(task),'system');
  end if;
  receipt:=jsonb_build_object('key',item->>'key','topic_id',topic.id,'title',task.title,'exam',task.exam,'subject',task.subject,'plan_date',task.plan_date,'status',case when reused then 'existing' else 'created' end,'task_ids',jsonb_build_array(task.id),'reason',item->>'reason');
  insert into private.coaching_homework(user_id,assignment_key,task_id,run_id,receipt) values(p_user_id,item->>'key',task.id,p_run_id,receipt);
  results:=results||jsonb_build_array(receipt);
 end loop;
 for day in select distinct unnest(changed_days) loop perform private.snapshot_day(p_user_id,day); end loop;
 return jsonb_build_object('results',results);
end $$;

create function public.coaching_run_fail(p_user_id uuid,p_run_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.analysis_require_target_study_user(p_user_id);
 update private.coaching_runs set status='failed',lease_until=now() where user_id=p_user_id and run_id=p_run_id and status<>'completed';
end $$;

create function public.coaching_report_finalize(p_user_id uuid,p_run_id uuid,p_report_id uuid,p_body text,p_summary jsonb,p_usage jsonb,p_actual_cost_usd numeric)
returns public.analysis_reports language plpgsql security definer set search_path='' as $$
declare run private.coaching_runs; report public.analysis_reports; receipt jsonb;
begin
 perform private.analysis_require_target_study_user(p_user_id);
 select * into run from private.coaching_runs where user_id=p_user_id and run_id=p_run_id for update;
 if not found then raise exception 'COACHING_RUN_REQUIRED'; end if;
 if run.status='completed' then select * into report from public.analysis_reports where id=run.report_id and user_id=p_user_id;return report;end if;
 if run.status<>'running' then raise exception 'COACHING_RUN_NOT_ACTIVE'; end if;
 if exists(select 1 from private.coaching_runs newer where newer.user_id=p_user_id
  and newer.run_id<>p_run_id and newer.status in ('running','completed')
  and newer.cutoff>run.cutoff) then raise exception 'COACHING_STALE_RUN'; end if;
 receipt:=public.topic_review_receipt(p_user_id,p_run_id);
 if receipt is null then raise exception 'COACHING_REVIEW_RECEIPT_REQUIRED'; end if;
 if exists(select 1 from jsonb_array_elements(coalesce(receipt->'results','[]'::jsonb)) r,
 jsonb_array_elements(coalesce(r->'stages','[]'::jsonb)) s where s->>'status' in ('pending','retry_pending')) then raise exception 'COACHING_REVIEWS_PENDING'; end if;
 report:=private.analysis_finalize_for(p_user_id,p_report_id,p_run_id,p_body,p_summary,p_usage,p_actual_cost_usd);
 update private.coaching_runs set status='completed',report_id=p_report_id,metrics=p_summary->'coaching',lease_until=now() where user_id=p_user_id and run_id=p_run_id;
 return report;
end $$;

revoke all on function public.coaching_plan_set(uuid,jsonb),public.coaching_context(uuid),public.coaching_run_begin(uuid,uuid),public.coaching_homework_create(uuid,uuid,jsonb),public.coaching_run_fail(uuid,uuid),public.coaching_report_finalize(uuid,uuid,uuid,text,jsonb,jsonb,numeric) from public,anon,authenticated,service_role;
grant execute on function public.coaching_plan_set(uuid,jsonb),public.coaching_context(uuid),public.coaching_run_begin(uuid,uuid),public.coaching_homework_create(uuid,uuid,jsonb),public.coaching_run_fail(uuid,uuid),public.coaching_report_finalize(uuid,uuid,uuid,text,jsonb,jsonb,numeric) to service_role;
