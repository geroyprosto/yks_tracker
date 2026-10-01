-- A topic enters reinforcement when its instruction first reaches mastery 2.
-- Keep schedule identity separate from editable/deletable task rows, so retries,
-- metadata edits and later mastery changes cannot duplicate the five reviews.
create table private.topic_review_schedule (
 user_id uuid not null references auth.users(id) on delete cascade,
 topic_id uuid not null,
 step int not null check(step between 1 and 5),
 plan_date date not null,
 origin_history_id uuid not null references public.topic_history(id) on delete cascade,
 task_id uuid unique references public.tasks(id) on delete set null,
 primary key(user_id,topic_id,step),
 foreign key(topic_id,user_id) references public.topics(id,user_id) on delete cascade
);
create index topic_review_schedule_topic_fk on private.topic_review_schedule(topic_id,user_id);
create index topic_review_schedule_history_fk on private.topic_review_schedule(origin_history_id);
alter table private.topic_review_schedule enable row level security;

create function private.next_review_sunday(day_date date)
 returns date language sql immutable strict security invoker set search_path='' as $$
 select day_date + (7-extract(isodow from day_date)::int)
$$;

-- The first date is the Sunday of the completion week (Monday-Sunday).
-- Later month offsets use PostgreSQL calendar-month arithmetic, then move
-- forward to the first Sunday on or after that anniversary.
create function private.topic_review_dates(completion_day date)
 returns table(step int,plan_date date)
 language plpgsql immutable strict security invoker set search_path='' as $$
declare sunday_1 date; sunday_2 date; sunday_3 date; sunday_4 date; sunday_5 date;
begin
 sunday_1:=private.next_review_sunday(completion_day);
 sunday_2:=sunday_1+14;
 sunday_3:=private.next_review_sunday((sunday_2+interval '1 month')::date);
 sunday_4:=private.next_review_sunday((sunday_3+interval '2 months')::date);
 sunday_5:=private.next_review_sunday((sunday_4+interval '3 months')::date);
 return query
  select d.step,d.plan_date from (values
   (1,sunday_1),(2,sunday_2),(3,sunday_3),(4,sunday_4),(5,sunday_5)
  ) as d(step,plan_date);
end $$;

create function private.schedule_topic_reviews(history_id uuid)
 returns void language plpgsql security invoker set search_path='' as $$
declare
 history public.topic_history;
 topic public.topics;
 owner_zone text;
 matching_course_id uuid;
 today_local date;
 review record;
 inserted_schedule private.topic_review_schedule;
 created_task public.tasks;
 suffix constant text:=' Pekiştirme (Düşük Öncelik)';
begin
 select * into history from public.topic_history h where h.id=history_id;
 if not found or history.old_mastery>=2 or history.new_mastery<2 then return; end if;
 select * into topic from public.topics t where t.id=history.topic_id and t.user_id=history.user_id;
 if not found then return; end if;
 select p.timezone into owner_zone from public.profiles p where p.user_id=history.user_id;
 select c.id into matching_course_id from public.education_courses c
  where c.user_id=history.user_id and c.context='yks' and c.term_id is null
   and c.exam=topic.exam and not c.archived
   and private.education_course_key(c.catalog_subject)=private.education_course_key(topic.subject)
  limit 1;
 today_local:=(clock_timestamp() at time zone owner_zone)::date;
 for review in select * from private.topic_review_dates((history.changed_at at time zone owner_zone)::date) loop
  insert into private.topic_review_schedule(user_id,topic_id,step,plan_date,origin_history_id)
   values(history.user_id,history.topic_id,review.step,review.plan_date,history.id)
   on conflict(user_id,topic_id,step) do nothing returning * into inserted_schedule;
  if not found or review.plan_date<today_local then continue; end if;
  insert into public.tasks(user_id,course_id,title,plan_date,exam,subject,topic_id,priority,study_type,planned_minutes,position)
   values(history.user_id,matching_course_id,left(topic.name,240-char_length(suffix))||suffix,review.plan_date,
    topic.exam,topic.subject,topic.id,'low','Tekrar',20,
    coalesce((select max(t.position) from public.tasks t
     where t.user_id=history.user_id and t.plan_date=review.plan_date),-1)+1)
   returning * into created_task;
  update private.topic_review_schedule s set task_id=created_task.id
   where s.user_id=history.user_id and s.topic_id=history.topic_id and s.step=review.step;
  perform private.snapshot_day(history.user_id,review.plan_date);
  insert into public.audit_log(user_id,entity,entity_id,action,new_value,source)
   values(history.user_id,'task',created_task.id,'topic.review.schedule',to_jsonb(created_task),'system');
 end loop;
end $$;

create function private.schedule_topic_reviews_on_history()
 returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.old_mastery<2 and new.new_mastery>=2 then
  perform private.schedule_topic_reviews(new.id);
 end if;
 return new;
end $$;

create trigger schedule_topic_reviews_after_completion
 after insert on public.topic_history for each row
 execute function private.schedule_topic_reviews_on_history();

-- Backfill only confirmed transitions from the current local week. Current
-- mastery alone is never evidence of when instruction was completed.
do $$
declare completed record;
begin
 for completed in
  select h.id from public.topic_history h
   join public.topics t on t.id=h.topic_id and t.user_id=h.user_id
   join public.profiles p on p.user_id=h.user_id
   where h.old_mastery<2 and h.new_mastery>=2 and t.mastery>=2
    and (h.changed_at at time zone p.timezone)::date >=
     date_trunc('week',clock_timestamp() at time zone p.timezone)::date
    and (h.changed_at at time zone p.timezone)::date <=
     (clock_timestamp() at time zone p.timezone)::date
   order by h.changed_at,h.id
 loop
  perform private.schedule_topic_reviews(completed.id);
 end loop;
end $$;

revoke all on private.topic_review_schedule from public,anon,authenticated,service_role;
revoke all on function private.next_review_sunday(date) from public,anon,authenticated,service_role;
revoke all on function private.topic_review_dates(date) from public,anon,authenticated,service_role;
revoke all on function private.schedule_topic_reviews(uuid) from public,anon,authenticated,service_role;
revoke all on function private.schedule_topic_reviews_on_history() from public,anon,authenticated,service_role;
