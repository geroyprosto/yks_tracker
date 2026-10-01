-- A review series is rooted in the first recorded transition into completed
-- instruction. Existing review tasks remain linked; empty legacy identities
-- are pending work, not proof that a task was delivered.
drop trigger if exists schedule_topic_reviews_after_completion on public.topic_history;

alter table public.tasks drop constraint if exists tasks_study_type_check;
alter table public.tasks add constraint tasks_study_type_check check (
 study_type in ('Konu anlatımı','Soru çözümü','Tekrar','Aralıklı tekrar',
  'Hızlı gözden geçirme','Yanlış analizi','Hâkimiyet kontrolü')
);
alter table public.study_sessions drop constraint if exists study_sessions_study_type_check;
alter table public.study_sessions add constraint study_sessions_study_type_check check (
 study_type in ('Konu anlatımı','Soru çözümü','Tekrar','Aralıklı tekrar',
  'Hızlı gözden geçirme','Yanlış analizi','Hâkimiyet kontrolü')
);

create index topic_history_first_instruction_for_review
 on public.topic_history(user_id,topic_id,changed_at,id)
 where old_mastery<2 and new_mastery>=2;

create table private.topic_review_series (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 topic_id uuid not null,
 event_id uuid not null unique references public.topic_history(id) on delete cascade,
 completed_at timestamptz not null,
 timezone text not null default 'Europe/Istanbul' check(timezone='Europe/Istanbul'),
 created_at timestamptz not null default now(),
 unique(user_id,topic_id),
 unique(id,user_id,topic_id),
 foreign key(topic_id,user_id) references public.topics(id,user_id) on delete cascade
);
create index topic_review_series_event_scope on private.topic_review_series(user_id,completed_at);
create index topic_review_series_topic_fk on private.topic_review_series(topic_id,user_id);
alter table private.topic_review_series enable row level security;

create table private.topic_review_stages (
 series_id uuid not null,
 user_id uuid not null,
 topic_id uuid not null,
 stage int not null check(stage between 0 and 4),
 plan_date date not null,
 status text not null default 'pending' check(status in
  ('pending','retry_pending','created','existing','skipped_past')),
 task_id uuid unique references public.tasks(id) on delete set null,
 attempt_count int not null default 0 check(attempt_count>=0),
 last_error text,
 updated_at timestamptz not null default now(),
 primary key(series_id,stage),
 foreign key(series_id,user_id,topic_id)
  references private.topic_review_series(id,user_id,topic_id) on delete cascade
);
create index topic_review_stages_retry on private.topic_review_stages(user_id,status,plan_date)
 where status in ('pending','retry_pending');
alter table private.topic_review_stages enable row level security;

create table private.topic_review_receipts (
 user_id uuid not null references auth.users(id) on delete cascade,
 run_id uuid not null,
 current_cutoff timestamptz not null,
 result jsonb not null check(jsonb_typeof(result)='object'),
 created_at timestamptz not null default now(),
 primary key(user_id,run_id)
);
create index topic_review_receipts_latest on private.topic_review_receipts(user_id,created_at desc);
alter table private.topic_review_receipts enable row level security;

-- Only T0 and T1 are Sundays. T2-T4 use consecutive calendar-month
-- anniversaries, with PostgreSQL's standard month-end clamping.
create function private.topic_review_stage_dates(completion_day date)
 returns table(stage int,plan_date date)
 language plpgsql immutable strict security invoker set search_path='' as $$
declare d0 date; d1 date; d2 date; d3 date; d4 date;
begin
 d0:=private.next_review_sunday(completion_day);
 d1:=d0+14;
 d2:=(d1+interval '1 month')::date;
 d3:=(d2+interval '2 months')::date;
 d4:=(d3+interval '3 months')::date;
 return query select v.stage,v.plan_date from
  (values (0,d0),(1,d1),(2,d2),(3,d3),(4,d4)) v(stage,plan_date);
end $$;

-- The trigger records identity only. The service reconciliation writes tasks
-- in a single locked call and snapshots each affected day once.
create function private.topic_review_capture(p_history_id uuid)
 returns uuid language plpgsql security definer set search_path='' as $$
declare first_event public.topic_history; v_series_id uuid;
begin
 select h.* into first_event from public.topic_history h
  where h.id=p_history_id and h.old_mastery<2 and h.new_mastery>=2;
 if not found then return null; end if;
 select h.* into first_event from public.topic_history h
  where h.user_id=first_event.user_id and h.topic_id=first_event.topic_id
   and h.old_mastery<2 and h.new_mastery>=2
  order by h.changed_at,h.id limit 1;
 insert into private.topic_review_series(user_id,topic_id,event_id,completed_at)
  values(first_event.user_id,first_event.topic_id,first_event.id,first_event.changed_at)
  on conflict(user_id,topic_id) do nothing returning id into v_series_id;
 if v_series_id is null then
  select s.id into v_series_id from private.topic_review_series s
   where s.user_id=first_event.user_id and s.topic_id=first_event.topic_id;
 end if;
 insert into private.topic_review_stages(series_id,user_id,topic_id,stage,plan_date)
  select v_series_id,first_event.user_id,first_event.topic_id,d.stage,d.plan_date
  from private.topic_review_stage_dates(
   (first_event.changed_at at time zone 'Europe/Istanbul')::date
  ) d on conflict(series_id,stage) do nothing;
 -- Preserve tasks that survived the earlier backfill correction. Do not
 -- mistake a NULL legacy identity for an existing task.
 update private.topic_review_stages stage set
  task_id=legacy.task_id,status='existing',plan_date=task.plan_date,
  updated_at=clock_timestamp()
 from private.topic_review_schedule legacy
 join public.tasks task on task.id=legacy.task_id and task.user_id=legacy.user_id
  where stage.series_id=v_series_id and stage.stage=legacy.step-1
  and legacy.user_id=stage.user_id and legacy.topic_id=stage.topic_id
  and stage.task_id is null;
 return v_series_id;
end $$;

create function private.topic_review_capture_history()
 returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.old_mastery<2 and new.new_mastery>=2 then
  perform private.topic_review_capture(new.id);
 end if;
 return new;
end $$;
create trigger topic_review_capture_after_instruction_completion
 after insert on public.topic_history for each row
 execute function private.topic_review_capture_history();

create function public.topic_review_reconcile(
 p_user_id uuid,p_current_cutoff timestamptz,
 p_previous_cutoff timestamptz default null,
 p_initial_backfill boolean default false,
 p_run_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 run_key uuid:=coalesce(p_run_id,gen_random_uuid());
 existing_receipt jsonb;
 first_event record;
 series record;
 review record;
 topic public.topics;
 matching_course_id uuid;
 task public.tasks;
 today_local date;
 affected_days date[]:=array[]::date[];
 affected_day date;
 results jsonb:='[]'::jsonb;
 stages_json jsonb;
 task_ids jsonb;
 result_status text;
 created_in_call boolean;
 created_count int;
 failed_count int;
 linked_count int;
begin
 perform private.analysis_require_target_study_user(p_user_id);
 if p_current_cutoff is null or
    (p_previous_cutoff is not null and p_previous_cutoff>p_current_cutoff) then
  raise exception 'INVALID_CUTOFF';
 end if;
 select r.result into existing_receipt from private.topic_review_receipts r
  where r.user_id=p_user_id and r.run_id=run_key;
 if found and not exists(
  select 1 from jsonb_array_elements(coalesce(existing_receipt->'results','[]'::jsonb)) r,
   jsonb_array_elements(coalesce(r->'stages','[]'::jsonb)) st
  where st->>'status'='retry_pending'
 ) then return existing_receipt; end if;
 today_local:=(p_current_cutoff at time zone 'Europe/Istanbul')::date;

 -- Initial reconciliation admits all recorded first crossings for topics
 -- still at instruction-completed mastery. Normal runs admit only first
 -- crossings in the successful-analysis interval; pending captured series
 -- are also retried below.
 for first_event in
  select first_h.id,first_h.changed_at from (
   select distinct on (h.topic_id) h.id,h.topic_id,h.changed_at
   from public.topic_history h
   where h.user_id=p_user_id and h.old_mastery<2 and h.new_mastery>=2
   order by h.topic_id,h.changed_at,h.id
  ) first_h
  join public.topics t on t.id=first_h.topic_id and t.user_id=p_user_id
  where t.mastery>=2 and first_h.changed_at<=p_current_cutoff
   and (p_initial_backfill or
    (p_previous_cutoff is not null and first_h.changed_at>p_previous_cutoff))
  order by first_h.changed_at,first_h.id
 loop
  perform private.topic_review_capture(first_event.id);
 end loop;

 for series in
  select s.* from private.topic_review_series s
  join public.topics t on t.id=s.topic_id and t.user_id=s.user_id
  where s.user_id=p_user_id and t.mastery>=2 and s.completed_at<=p_current_cutoff
   and (p_initial_backfill or
    (p_previous_cutoff is not null and s.completed_at>p_previous_cutoff)
    or exists(select 1 from private.topic_review_stages st
      where st.series_id=s.id and st.status in ('pending','retry_pending'))
    or exists(select 1 from jsonb_array_elements(
      coalesce(existing_receipt->'results','[]'::jsonb)) prior
      where prior->>'series_id'=s.id::text))
  order by s.completed_at,s.id
 loop
  select * into topic from public.topics t where t.id=series.topic_id;
  select c.id into matching_course_id from public.education_courses c
   where c.user_id=p_user_id and c.context='yks' and c.term_id is null
    and c.exam=topic.exam and not c.archived
    and private.education_course_key(c.catalog_subject)=private.education_course_key(topic.subject)
   order by c.created_at,c.id limit 1;
  created_in_call:=false;
  for review in select * from private.topic_review_stages st
    where st.series_id=series.id order by st.stage for update
  loop
   if review.task_id is not null and exists(
    select 1 from public.tasks t where t.id=review.task_id and t.user_id=p_user_id
   ) then continue; end if;
   if review.plan_date<today_local then
    update private.topic_review_stages st set status='skipped_past',
     task_id=null,last_error=null,updated_at=clock_timestamp()
     where st.series_id=series.id and st.stage=review.stage
      and st.status is distinct from 'skipped_past';
    continue;
   end if;
   begin
    insert into public.tasks(user_id,course_id,title,plan_date,exam,subject,
      topic_id,priority,study_type,planned_minutes,position)
    values(p_user_id,matching_course_id,
      left(topic.name,240-char_length(' Pekiştirme'))||' Pekiştirme',
      review.plan_date,topic.exam,topic.subject,topic.id,'low',
      'Aralıklı tekrar',20,
      coalesce((select max(t.position) from public.tasks t
       where t.user_id=p_user_id and t.plan_date=review.plan_date),-1)+1)
    returning * into task;
    update private.topic_review_stages st set status='created',task_id=task.id,
     attempt_count=st.attempt_count+1,last_error=null,updated_at=clock_timestamp()
     where st.series_id=series.id and st.stage=review.stage;
    insert into private.topic_review_schedule(user_id,topic_id,step,plan_date,
      origin_history_id,task_id)
     values(p_user_id,topic.id,review.stage+1,review.plan_date,series.event_id,task.id)
     on conflict(user_id,topic_id,step) do update set
      task_id=excluded.task_id,plan_date=excluded.plan_date
      where private.topic_review_schedule.task_id is null;
    insert into public.audit_log(user_id,entity,entity_id,action,new_value,source)
     values(p_user_id,'task',task.id,'topic.review.schedule',to_jsonb(task),'system');
    if not review.plan_date=any(affected_days) then
     affected_days:=array_append(affected_days,review.plan_date);
    end if;
    created_in_call:=true;
   exception when others then
    update private.topic_review_stages st set status='retry_pending',task_id=null,
     attempt_count=st.attempt_count+1,last_error=left(sqlerrm,500),
     updated_at=clock_timestamp()
     where st.series_id=series.id and st.stage=review.stage;
   end;
  end loop;
  select count(*) filter(where st.status='created'),
   count(*) filter(where st.status='retry_pending'),
   count(*) filter(where st.task_id is not null),
   coalesce(jsonb_agg(jsonb_build_object(
    'stage',st.stage,'plan_date',st.plan_date,'status',st.status,
    'task_id',st.task_id,'attempt_count',st.attempt_count
   ) order by st.stage),'[]'::jsonb),
   coalesce(jsonb_agg(st.task_id order by st.stage)
    filter(where st.task_id is not null),'[]'::jsonb)
   into created_count,failed_count,linked_count,stages_json,task_ids
   from private.topic_review_stages st where st.series_id=series.id;
  result_status:=case when failed_count>0 then 'retry_pending'
   when created_in_call then 'created'
   when linked_count>0 then 'existing'
   else 'skipped_past' end;
  results:=results||jsonb_build_array(jsonb_build_object(
   'series_id',series.id,'topic_id',topic.id,'event_id',series.event_id,
   'completed_at',series.completed_at,'exam',topic.exam,'subject',topic.subject,
   'title',topic.name,'task_title',left(topic.name,240-char_length(' Pekiştirme'))||' Pekiştirme',
   'status',result_status,'task_ids',task_ids,'stages',stages_json
  ));
 end loop;
 foreach affected_day in array affected_days loop
  perform private.snapshot_day(p_user_id,affected_day);
 end loop;
 existing_receipt:=jsonb_build_object(
  'run_id',run_key,'current_cutoff',p_current_cutoff,
  'previous_cutoff',p_previous_cutoff,'initial_backfill',p_initial_backfill,
  'results',results
 );
 insert into private.topic_review_receipts(user_id,run_id,current_cutoff,result)
  values(p_user_id,run_key,p_current_cutoff,existing_receipt)
  on conflict(user_id,run_id) do update set result=excluded.result;
 return existing_receipt;
end $$;

create function public.topic_review_receipt(p_user_id uuid,p_run_id uuid default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.analysis_require_target_study_user(p_user_id);
 select r.result into result from private.topic_review_receipts r
  where r.user_id=p_user_id and (p_run_id is null or r.run_id=p_run_id)
  order by r.created_at desc,r.run_id desc limit 1;
 return result;
end $$;

-- A model-free worker can retry transient task writes. Passing a user keeps
-- the call scoped; NULL scans only users with pending stages.
create function public.topic_review_retry_pending(
 p_user_id uuid default null,p_current_cutoff timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid; cutoff timestamptz:=coalesce(p_current_cutoff,clock_timestamp());
 results jsonb:='[]'::jsonb;
begin
 if p_user_id is not null then
  perform private.analysis_require_target_study_user(p_user_id);
  return public.topic_review_reconcile(p_user_id,cutoff,cutoff,false,gen_random_uuid());
 end if;
 for owner_id in
  select distinct st.user_id from private.topic_review_stages st
  where st.status in ('pending','retry_pending')
   and (exists(select 1 from public.classroom_accounts account
      where account.id=st.user_id and account.role='student' and account.status='approved')
    or (exists(select 1 from public.owner_allowlist allowed where allowed.user_id=st.user_id)
     and not exists(select 1 from public.classroom_accounts account
      where account.id=st.user_id and (account.role<>'admin' or account.status<>'approved'))))
  order by st.user_id
 loop
  results:=results||jsonb_build_array(
   public.topic_review_reconcile(owner_id,cutoff,cutoff,false,gen_random_uuid())
  );
 end loop;
 return results;
end $$;

revoke all on private.topic_review_series,private.topic_review_stages,
 private.topic_review_receipts from public,anon,authenticated,service_role;
revoke all on function private.topic_review_stage_dates(date),
 private.topic_review_capture(uuid),private.topic_review_capture_history()
 from public,anon,authenticated,service_role;
revoke all on function public.topic_review_reconcile(uuid,timestamptz,timestamptz,boolean,uuid),
 public.topic_review_receipt(uuid,uuid),
 public.topic_review_retry_pending(uuid,timestamptz)
 from public,anon,authenticated,service_role;
grant execute on function public.topic_review_reconcile(uuid,timestamptz,timestamptz,boolean,uuid),
 public.topic_review_receipt(uuid,uuid),
 public.topic_review_retry_pending(uuid,timestamptz) to service_role;
