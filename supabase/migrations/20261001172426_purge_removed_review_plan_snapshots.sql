-- The backfill and its 455 snapshot writes shared one transaction timestamp.
-- A user can also delete a newly generated review. Only purge snapshots from
-- delayed historical backfill, where task creation lagged the latest recorded
-- completion transition by more than a minute.
-- Keep the latest corrected version of every day and all other history.
do $$
declare removed_count int;
begin
 delete from public.daily_plan_versions v
  where exists(
   select 1 from public.daily_plan_versions newer
    where newer.user_id=v.user_id and newer.plan_date=v.plan_date
     and newer.version>v.version
  )
   and exists(
    select 1 from jsonb_array_elements(v.snapshot) entry
     where entry->>'id' is not null
      and entry->>'topic_id' is not null
      and entry->>'priority'='low'
      and entry->>'study_type'='Tekrar'
      and entry->>'planned_minutes'='20'
      and entry->>'revision'='1'
      and entry->>'progress'='0'
      and entry->>'updated_at'=entry->>'created_at'
      and right(entry->>'title',char_length(' Pekiştirme (Düşük Öncelik)'))=' Pekiştirme (Düşük Öncelik)'
      and (entry->>'created_at')::timestamptz=v.changed_at
      and (entry->>'created_at')::timestamptz > (
       select max(history.changed_at)+interval '1 minute'
        from public.topic_history history
        where history.user_id=v.user_id
         and history.topic_id=(entry->>'topic_id')::uuid
         and history.old_mastery<2 and history.new_mastery>=2
         and history.changed_at<=(entry->>'created_at')::timestamptz
      )
      and not exists(
       select 1 from public.tasks task
        where task.user_id=v.user_id and task.id=(entry->>'id')::uuid
      )
   );
 get diagnostics removed_count=row_count;
 raise notice 'Removed % obsolete topic-review plan versions',removed_count;
end $$;
