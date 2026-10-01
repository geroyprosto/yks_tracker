-- The preceding migration scheduled reviews for recorded completions from
-- the current week. A bulk status update shortly before deployment produced
-- unwanted historical backfill tasks. Keep the trigger for new completions;
-- remove only untouched tasks created well after their recorded transition.
do $$
declare
 candidate record;
 affected_day record;
 selected_count int;
 deleted_count int;
begin
 create temporary table review_backfill_cleanup (
  user_id uuid not null,
  topic_id uuid not null,
  step int not null,
  plan_date date not null,
  task_id uuid not null
 ) on commit drop;

 -- Lock the exact rows selected for cleanup. A task edit or topic update
 -- cannot race with deletion after the untouched predicate is checked.
 for candidate in
  select s.user_id,s.topic_id,s.step,s.plan_date,s.task_id
   from private.topic_review_schedule s
   join public.tasks t on t.id=s.task_id and t.user_id=s.user_id
   join public.topic_history h on h.id=s.origin_history_id
    and h.topic_id=s.topic_id and h.user_id=s.user_id
   join public.topics topic on topic.id=s.topic_id and topic.user_id=s.user_id
   where t.created_at>h.changed_at+interval '1 minute'
    and t.revision=1 and t.progress=0 and t.updated_at=t.created_at
    and t.topic_id=s.topic_id and t.plan_date=s.plan_date
    and t.priority='low' and t.study_type='Tekrar' and t.planned_minutes=20
    and t.difficulty='medium' and t.weight_override is null
    and t.steps='[]'::jsonb and t.notes='' and t.resource='' and t.completion_criteria=''
    and right(t.title,char_length(' Pekiştirme (Düşük Öncelik)'))=' Pekiştirme (Düşük Öncelik)'
    and not exists(select 1 from public.study_sessions session where session.task_id=t.id)
    and exists(select 1 from public.audit_log audit
     where audit.user_id=s.user_id and audit.entity='task' and audit.entity_id=t.id
      and audit.action='topic.review.schedule' and audit.source='system')
   order by s.user_id,s.topic_id,s.step
   for update of s,t,topic
 loop
  insert into pg_temp.review_backfill_cleanup(user_id,topic_id,step,plan_date,task_id)
   values(candidate.user_id,candidate.topic_id,candidate.step,candidate.plan_date,candidate.task_id);
 end loop;

 select count(*) into selected_count from pg_temp.review_backfill_cleanup;
 if selected_count=0 then return; end if;

 delete from private.topic_review_schedule s using pg_temp.review_backfill_cleanup c
  where s.user_id=c.user_id and s.topic_id=c.topic_id and s.step=c.step
   and s.task_id=c.task_id;
 get diagnostics deleted_count=row_count;
 if deleted_count<>selected_count then raise exception 'Review schedule cleanup count changed'; end if;

 delete from public.tasks t using pg_temp.review_backfill_cleanup c
  where t.id=c.task_id and t.user_id=c.user_id;
 get diagnostics deleted_count=row_count;
 if deleted_count<>selected_count then raise exception 'Review task cleanup count changed'; end if;

 delete from public.audit_log audit using pg_temp.review_backfill_cleanup c
  where audit.user_id=c.user_id and audit.entity='task' and audit.entity_id=c.task_id
   and audit.action='topic.review.schedule' and audit.source='system';

 -- One new current snapshot per affected user/day replaces the old plan.
 for affected_day in
  select distinct user_id,plan_date from pg_temp.review_backfill_cleanup
   order by user_id,plan_date
 loop
  perform private.snapshot_day(affected_day.user_id,affected_day.plan_date);
 end loop;
 raise notice 'Removed % untouched historical topic review tasks',selected_count;
end $$;
