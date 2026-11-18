-- Review intervals remain the earliest eligible dates. Calendar placement is per
-- student, using the same day override and weekday targets as the plan screen.
alter table private.topic_review_stages
 add column scheduled_revision integer not null default 1;

create function private.topic_review_free_slots(p_user_id uuid, p_day date, p_exclude uuid default null)
 returns integer language sql stable security invoker set search_path='' as $$
 with load as (
  select coalesce(sum(t.planned_minutes),0) as total_minutes,
   coalesce(sum(t.planned_minutes) filter (where st.task_id is null),0) as base_minutes,
   coalesce(sum(t.planned_minutes) filter (where st.task_id is not null),0) as review_minutes,
   count(st.task_id) as reviews
  from public.tasks t
  left join private.topic_review_stages st on st.task_id=t.id and st.user_id=t.user_id
  where t.user_id=p_user_id and t.plan_date=p_day and t.id is distinct from p_exclude
 ), limits as (
  select load.*,case when base_minutes>=360 then 1 else 2 end as daily_reviews,
   coalesce((select v.target_minutes from public.daily_plan_versions v
    where v.user_id=p_user_id and v.plan_date=p_day order by v.version desc limit 1),
    p.weekday_targets[extract(isodow from p_day)::int],p.daily_target_minutes) as target
  from load join public.profiles p on p.user_id=p_user_id
 )
 select least(daily_reviews-reviews,
  floor((daily_reviews*20-review_minutes)/20.0),
  floor((target-total_minutes)/20.0))::int from limits
$$;

create function private.topic_review_slot(
 p_user_id uuid, p_series_id uuid, p_stage integer, p_earliest date, p_from date, p_exclude uuid default null
) returns date language plpgsql security invoker set search_path='' as $$
declare
 candidate date:=p_earliest;
 previous_date date;
 next_fixed date;
 last_day date;
 override_day date;
begin
 -- When an earlier stage was delayed, space the next exposure from the
 -- actual plan, while never bringing it forward from its original date.
 select t.plan_date into previous_date from private.topic_review_stages s
 join public.tasks t on t.user_id=s.user_id and t.id=s.task_id
 where s.series_id=p_series_id and s.stage=p_stage-1;
 if previous_date is not null then
  candidate:=greatest(candidate,(previous_date+case p_stage
   when 1 then interval '14 days' when 2 then interval '1 month'
   when 3 then interval '2 months' when 4 then interval '3 months' end)::date);
 end if;
 if exists(select 1 from private.topic_review_stages s where s.series_id=p_series_id
  and s.stage<p_stage and s.task_id is null and s.last_error='DEFERRED_CAPACITY') then
  return null;
 end if;
 -- A manually changed or started future stage is a fixed point in the series.
 select min(t.plan_date) into next_fixed from private.topic_review_stages s
 join public.tasks t on t.user_id=s.user_id and t.id=s.task_id
 where s.series_id=p_series_id and s.stage>p_stage
  and (t.plan_date<p_from or t.plan_date<>s.plan_date or t.revision<>s.scheduled_revision or t.progress>0
   or exists(select 1 from public.study_sessions ss where ss.user_id=t.user_id and ss.task_id=t.id));
 last_day:=least(candidate+366,next_fixed-1);
 -- Fully disabled weeks can only have capacity through explicit day overrides.
 if not exists(select 1 from public.profiles p where p.user_id=p_user_id
  and 20<=any(p.weekday_targets)) then
  for override_day in select distinct v.plan_date from public.daily_plan_versions v
   where v.user_id=p_user_id and v.plan_date between candidate and last_day and v.target_minutes>=20
   order by v.plan_date
  loop
   if private.topic_review_free_slots(p_user_id,override_day,p_exclude)>0 then return override_day; end if;
  end loop;
  return null;
 end if;
 while candidate<=last_day loop
  if private.topic_review_free_slots(p_user_id,candidate,p_exclude)>0 then return candidate; end if;
  candidate:=candidate+1;
 end loop;
 return null;
end $$;

-- Capture each user edit through the existing optimistic revision. A revision
-- written by this scheduler is recorded so its own future moves remain eligible.
create function private.topic_review_move_tasks(p_user_id uuid,p_from date,p_series_id uuid)
 returns table(old_date date,new_date date) language plpgsql security invoker set search_path='' as $$
declare
 review record;
 destination date;
 new_revision int;
begin
 for review in
  select s.series_id,s.stage,t.id,t.plan_date,t.revision
  from private.topic_review_stages s
  join public.tasks t on t.id=s.task_id and t.user_id=s.user_id and t.topic_id=s.topic_id
  join private.topic_review_schedule legacy on legacy.task_id=t.id
   and legacy.user_id=s.user_id and legacy.topic_id=s.topic_id and legacy.step=s.stage+1
  where s.user_id=p_user_id and (p_series_id is null or s.series_id=p_series_id)
   and t.plan_date>=p_from and t.plan_date=s.plan_date
   and legacy.plan_date=s.plan_date and t.revision=s.scheduled_revision and t.progress=0
   and not exists(select 1 from public.study_sessions ss where ss.user_id=t.user_id and ss.task_id=t.id)
  order by s.stage,t.plan_date,s.series_id
 loop
  destination:=private.topic_review_slot(p_user_id,review.series_id,review.stage,review.plan_date,p_from,review.id);
  if destination is null or destination=review.plan_date then continue; end if;
  update public.tasks t set plan_date=destination,revision=t.revision+1,updated_at=clock_timestamp(),
   position=coalesce((select max(other.position) from public.tasks other
     where other.user_id=p_user_id and other.plan_date=destination),-1)+1
   where t.user_id=p_user_id and t.id=review.id returning revision into new_revision;
  update private.topic_review_stages set plan_date=destination,scheduled_revision=new_revision,
   updated_at=clock_timestamp() where series_id=review.series_id and stage=review.stage;
  update private.topic_review_schedule set plan_date=destination where task_id=review.id and user_id=p_user_id;
  insert into public.audit_log(user_id,entity,entity_id,action,old_value,new_value,source)
   values(p_user_id,'task',review.id,'topic.review.reschedule',
    jsonb_build_object('plan_date',review.plan_date),jsonb_build_object('plan_date',destination),'system');
  old_date:=review.plan_date;
  new_date:=destination;
  return next;
 end loop;
end $$;

create function private.topic_review_rebalance(p_user_id uuid,p_from date)
 returns integer language plpgsql security invoker set search_path='' as $$
declare moved_count integer; affected_days date[]; affected_day date;
begin
 perform private.analysis_require_target_study_user(p_user_id);
 if p_from is null then raise exception 'REVIEW_START_DATE_REQUIRED'; end if;
 with moves as materialized (
  select * from private.topic_review_move_tasks(p_user_id,p_from,null)
 ), days as (select old_date as day from moves union select new_date from moves)
 select (select count(*) from moves),array(select day from days order by day) into moved_count,affected_days;
 foreach affected_day in array affected_days loop
  perform private.snapshot_day(p_user_id,affected_day);
 end loop;
 return moved_count;
end $$;

revoke all on function private.topic_review_free_slots(uuid,date,uuid),
 private.topic_review_slot(uuid,uuid,integer,date,date,uuid),
 private.topic_review_move_tasks(uuid,date,uuid),
 private.topic_review_rebalance(uuid,date) from public,anon,authenticated,service_role;

-- Receipts retain the identity and outcome of the original run. When they
-- are read again, show the current calendar date of each still-linked task.
create function private.topic_review_receipt_dates(p_user_id uuid,p_receipt jsonb)
 returns jsonb language sql stable strict security invoker set search_path='' as $$
 select jsonb_set(p_receipt,'{results}',coalesce((
  select jsonb_agg(jsonb_set(r.item,'{stages}',coalesce((
   select jsonb_agg(case when t.id is null then s.item
    else jsonb_set(s.item,'{plan_date}',to_jsonb(t.plan_date)) end order by s.ordinal)
   from jsonb_array_elements(r.item->'stages') with ordinality s(item,ordinal)
   left join public.tasks t on t.id=(s.item->>'task_id')::uuid and t.user_id=p_user_id
  ),'[]'::jsonb)) order by r.ordinal)
  from jsonb_array_elements(p_receipt->'results') with ordinality r(item,ordinal)
 ),'[]'::jsonb))
$$;
revoke all on function private.topic_review_receipt_dates(uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function public.topic_review_reconcile(
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
 deferred_count int;
 assigned_date date;
 recheck_successors boolean;
 movement record;
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
  where st->>'status' in ('retry_pending','pending','deferred_capacity')
 ) then return private.topic_review_receipt_dates(p_user_id,existing_receipt); end if;
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
  recheck_successors:=false;
  for review in select * from private.topic_review_stages st
    where st.series_id=series.id order by st.stage for update
  loop
   if review.task_id is not null and exists(
    select 1 from public.tasks t where t.id=review.task_id and t.user_id=p_user_id
   ) then continue; end if;
   if review.plan_date<today_local and review.status<>'retry_pending'
     and review.last_error is distinct from 'DEFERRED_CAPACITY' then
    update private.topic_review_stages st set status='skipped_past',
     task_id=null,last_error=null,updated_at=clock_timestamp()
     where st.series_id=series.id and st.stage=review.stage
      and st.status is distinct from 'skipped_past';
    continue;
   end if;
   begin
    assigned_date:=private.topic_review_slot(p_user_id,series.id,review.stage,
     greatest(today_local,review.plan_date),today_local);
    if assigned_date is null then
     update private.topic_review_stages st set status='pending',last_error='DEFERRED_CAPACITY',
      updated_at=clock_timestamp() where st.series_id=series.id and st.stage=review.stage
      and (st.status<>'pending' or st.last_error is distinct from 'DEFERRED_CAPACITY');
     continue;
    end if;
    insert into public.tasks(user_id,course_id,title,plan_date,exam,subject,
      topic_id,priority,study_type,planned_minutes,position)
    values(p_user_id,matching_course_id,
      left(topic.name,240-char_length(' Pekiştirme'))||' Pekiştirme',
      assigned_date,topic.exam,topic.subject,topic.id,'low',
      'Aralıklı tekrar',20,
      coalesce((select max(t.position) from public.tasks t
       where t.user_id=p_user_id and t.plan_date=assigned_date),-1)+1)
    returning * into task;
    update private.topic_review_stages st set status='created',task_id=task.id,plan_date=assigned_date,
     scheduled_revision=task.revision,
     attempt_count=st.attempt_count+1,last_error=null,updated_at=clock_timestamp()
     where st.series_id=series.id and st.stage=review.stage;
    insert into private.topic_review_schedule(user_id,topic_id,step,plan_date,
      origin_history_id,task_id)
     values(p_user_id,topic.id,review.stage+1,assigned_date,series.event_id,task.id)
     on conflict(user_id,topic_id,step) do update set
      task_id=excluded.task_id,plan_date=excluded.plan_date
      where private.topic_review_schedule.task_id is null;
    insert into public.audit_log(user_id,entity,entity_id,action,new_value,source)
     values(p_user_id,'task',task.id,'topic.review.schedule',to_jsonb(task),'system');
    if not assigned_date=any(affected_days) then
     affected_days:=array_append(affected_days,assigned_date);
    end if;
    created_in_call:=true;
    if assigned_date>review.plan_date and exists(
     select 1 from private.topic_review_stages st where st.series_id=series.id
      and st.stage>review.stage and st.task_id is not null
    ) then recheck_successors:=true; end if;
   exception when others then
    update private.topic_review_stages st set status='retry_pending',task_id=null,
     attempt_count=st.attempt_count+1,last_error=left(sqlerrm,500),
     updated_at=clock_timestamp()
     where st.series_id=series.id and st.stage=review.stage;
   end;
  end loop;
  -- An earlier failed stage can be delivered after its successors already
  -- exist. Move those tasks in place and snapshot every changed day once.
  if recheck_successors then
   for movement in select * from private.topic_review_move_tasks(p_user_id,today_local,series.id) loop
    affected_days:=array_append(array_append(affected_days,movement.old_date),movement.new_date);
   end loop;
  end if;
  select count(*) filter(where st.status='created'),
   count(*) filter(where st.status='retry_pending'),
   count(*) filter(where st.last_error='DEFERRED_CAPACITY'),
   count(*) filter(where st.task_id is not null),
   coalesce(jsonb_agg(jsonb_build_object(
    'stage',st.stage,'plan_date',st.plan_date,'status',
     case when st.last_error='DEFERRED_CAPACITY' then 'deferred_capacity' else st.status end,
    'task_id',st.task_id,'attempt_count',st.attempt_count
   ) order by st.stage),'[]'::jsonb),
   coalesce(jsonb_agg(st.task_id order by st.stage)
    filter(where st.task_id is not null),'[]'::jsonb)
   into created_count,failed_count,deferred_count,linked_count,stages_json,task_ids
   from private.topic_review_stages st where st.series_id=series.id;
  result_status:=case when failed_count>0 then 'retry_pending'
   when deferred_count>0 then 'deferred_capacity'
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
 for affected_day in select distinct d from unnest(affected_days) d order by d loop
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

create or replace function public.topic_review_receipt(p_user_id uuid,p_run_id uuid default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.analysis_require_target_study_user(p_user_id);
 select r.result into result from private.topic_review_receipts r
  where r.user_id=p_user_id and (p_run_id is null or r.run_id=p_run_id)
  order by r.created_at desc,r.run_id desc limit 1;
 return private.topic_review_receipt_dates(p_user_id,result);
end $$;

-- Later day plans can fill dates that had room when the series was created.
-- The normal model-free retry job also revisits already-delivered reviews.
create function private.topic_review_pending_owners(p_cutoff timestamptz)
 returns setof uuid language sql stable security invoker set search_path='' as $$
 select distinct s.user_id from private.topic_review_stages st
 join private.topic_review_series s on s.id=st.series_id
 join public.topics t on t.user_id=s.user_id and t.id=s.topic_id
 where st.status in ('pending','retry_pending') and s.completed_at<=p_cutoff and t.mastery>=2
$$;
revoke all on function private.topic_review_pending_owners(timestamptz) from public,anon,authenticated,service_role;

create or replace function public.topic_review_retry_pending(
 p_user_id uuid default null,p_current_cutoff timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 cutoff timestamptz:=coalesce(p_current_cutoff,clock_timestamp());
 today_local date:=(cutoff at time zone 'Europe/Istanbul')::date;
 owner_id uuid;
 moved_count integer;
 results jsonb:='[]'::jsonb;
begin
 if p_user_id is not null then
  perform private.topic_review_rebalance(p_user_id,today_local);
  return public.topic_review_reconcile(p_user_id,cutoff,cutoff,false,gen_random_uuid());
 end if;
 for owner_id in
  with days as (
   select distinct st.user_id,t.plan_date from private.topic_review_stages st
   join public.tasks t on t.user_id=st.user_id and t.id=st.task_id
   where t.plan_date>=today_local and t.plan_date=st.plan_date and t.progress=0
    and t.revision=st.scheduled_revision
  ), owners as (
   select p.user_id from private.topic_review_pending_owners(cutoff) p(user_id)
   union
   select d.user_id from days d where private.topic_review_free_slots(d.user_id,d.plan_date)<0
  )
  select o.user_id from owners o where
   exists(select 1 from public.classroom_accounts account where account.id=o.user_id
    and account.role='student' and account.status='approved')
   or (exists(select 1 from public.owner_allowlist a where a.user_id=o.user_id)
    and not exists(select 1 from public.classroom_accounts account where account.id=o.user_id
     and (account.role<>'admin' or account.status<>'approved')))
  order by o.user_id
 loop
  moved_count:=private.topic_review_rebalance(owner_id,today_local);
  if exists(select 1 from private.topic_review_pending_owners(cutoff) p(user_id) where p.user_id=owner_id) then
   results:=results||jsonb_build_array(public.topic_review_reconcile(owner_id,cutoff,cutoff,false,gen_random_uuid()));
  else
   results:=results||jsonb_build_array(jsonb_build_object('moved',moved_count,'results','[]'::jsonb));
  end if;
 end loop;
 return results;
end $$;
