-- The planner accepts a 10–15% reserve. Reject any other buffer at the
-- database boundary as well, so an accepted plan cannot later fail planning.
alter table private.coaching_plans add constraint coaching_plans_buffer_ratio_check
 check (
  jsonb_typeof(plan->'buffer_ratio')='number'
  and (plan->>'buffer_ratio')::numeric between .1 and .15
 );

create or replace function public.coaching_plan_set(p_user_id uuid,p_plan jsonb) returns void
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
  and (p_plan->>'buffer_ratio')::numeric between .1 and .15)
 then raise exception 'INVALID_COACHING_PLAN'; end if;
 insert into private.coaching_plans(user_id,plan) values(p_user_id,p_plan)
 on conflict(user_id) do update set plan=excluded.plan,updated_at=now();
end $$;

revoke all on function public.coaching_plan_set(uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.coaching_plan_set(uuid,jsonb) to service_role;
