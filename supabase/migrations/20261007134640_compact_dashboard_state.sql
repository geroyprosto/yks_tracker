-- The dashboard and reports use the latest plan for each date. Legacy yks_state
-- continues to expose every immutable version for audit/history consumers.
-- Project current rows directly: trimming a fully-built legacy state still pays
-- the cost of aggregating and repeatedly copying all historical task snapshots.
create function private.dashboard_state() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_owner();at_time timestamptz:=date_trunc('second',clock_timestamp());value jsonb;
begin
 perform private.initialize_owner(actor);
 perform private.settle_countdown(actor,at_time);
 select jsonb_build_object(
  'server_now',at_time,
  'settings',(select to_jsonb(p)-'user_id'-'updated_at' from public.profiles p where p.user_id=actor),
  'tasks',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by t.plan_date,t.position,t.created_at,t.id) from public.tasks t where t.user_id=actor),'[]'::jsonb),
  'topics',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by t.exam,t.subject,t.name) from public.topics t where t.user_id=actor),'[]'::jsonb),
  'sessions',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by t.started_at desc) from public.study_sessions t where t.user_id=actor),'[]'::jsonb),
  'intervals',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by t.started_at) from public.study_intervals t where t.user_id=actor),'[]'::jsonb),
  'manual_study_entries',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by t.study_date desc,t.created_at desc,t.id) from public.manual_study_entries t where t.user_id=actor),'[]'::jsonb),
  'day_plans',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by t.plan_date) from (
   select distinct on (v.plan_date) v.* from public.daily_plan_versions v where v.user_id=actor order by v.plan_date,v.version desc
  ) t),'[]'::jsonb),
  'topic_history',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by t.changed_at desc) from public.topic_history t where t.user_id=actor),'[]'::jsonb),
  'practice_entries',coalesce((select jsonb_agg(to_jsonb(p)-'user_id' order by p.practice_date desc,p.created_at desc,p.id) from public.practice_entries p where p.user_id=actor),'[]'::jsonb),
  'exam_formats',coalesce((select jsonb_agg(to_jsonb(f) order by f.code,f.version desc) from public.exam_format_versions f),'[]'::jsonb),
  'exams',coalesce((select jsonb_agg(
   (to_jsonb(e)-'user_id')||jsonb_build_object('results',coalesce((select jsonb_agg(to_jsonb(r)-'exam_id'-'user_id' order by r.section_key) from public.exam_results r where r.exam_id=e.id),'[]'::jsonb))
   order by e.exam_date desc,e.created_at desc,e.id) from public.exams e where e.user_id=actor),'[]'::jsonb),
  'journal_entries',coalesce((select jsonb_agg(to_jsonb(j)-'user_id' order by j.journal_date desc,j.created_at desc) from public.journal_entries j where j.user_id=actor),'[]'::jsonb),
  'day_marks',coalesce((select jsonb_agg(to_jsonb(d)-'user_id' order by d.mark_date desc) from public.day_marks d where d.user_id=actor),'[]'::jsonb),
  'education',private.education_state_for(actor)
 ) into value;
 return value;
end $$;
create function public.yks_dashboard_state() returns jsonb
language sql security invoker set search_path='' as $$select private.dashboard_state()$$;
revoke all on function private.dashboard_state(),public.yks_dashboard_state()
 from public,anon,authenticated,service_role;
grant execute on function private.dashboard_state(),public.yks_dashboard_state() to authenticated;

-- A Redis miss must use the same compact projection as a direct dashboard read.
-- Generation checks, approval gates, countdown settlement and cache-hit behavior
-- retain their existing transaction and authorization semantics.
create or replace function private.state_cache_snapshot(p_known_version text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;value jsonb;version_after text;attempt integer;
begin
 for attempt in 1..2 loop
  context:=private.state_cache_context();
  if p_known_version is not null and p_known_version=context->>'version' then
   return context||jsonb_build_object('state',null);
  end if;
  value:=public.yks_dashboard_state();
  version_after:=private.state_cache_version((context->>'user_id')::uuid,(value->>'server_now')::timestamptz);
  if version_after=context->>'version' then
   return jsonb_build_object('user_id',context->'user_id','version',version_after,
    'server_now',value->'server_now','state',value);
  end if;
 end loop;
 raise exception 'CACHE_SNAPSHOT_CHANGED';
end $$;
