-- Removed backfill tasks left gaps in the private five-step identity map.
-- Recreate only those identities from the first recorded completion crossing.
-- NULL task_id intentionally blocks later 1-to-2 transitions from duplicating
-- the historical schedule; this migration creates no tasks or plan snapshots.
do $$
declare restored_count int;
begin
 insert into private.topic_review_schedule(user_id,topic_id,step,plan_date,origin_history_id)
 select first_completion.user_id,first_completion.topic_id,review.step,
  review.plan_date,first_completion.id
 from (
  select distinct on (h.user_id,h.topic_id)
   h.id,h.user_id,h.topic_id,h.changed_at
  from public.topic_history h
  where h.old_mastery<2 and h.new_mastery>=2
  order by h.user_id,h.topic_id,h.changed_at,h.id
 ) first_completion
 join public.profiles profile on profile.user_id=first_completion.user_id
 cross join lateral private.topic_review_dates(
  (first_completion.changed_at at time zone profile.timezone)::date
 ) review
 where true
 on conflict(user_id,topic_id,step) do nothing;
 get diagnostics restored_count=row_count;
 raise notice 'Restored % missing topic-review schedule identities',restored_count;
end $$;
