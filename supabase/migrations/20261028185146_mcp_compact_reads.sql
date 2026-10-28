-- MCP summaries need the current daily plan, not every historical task snapshot.
-- Keep the legacy browser/history RPC and immutable plan versions unchanged.
create or replace function public.mcp_owner_state(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 prior_sub text := current_setting('request.jwt.claim.sub', true);
 prior_claims text := current_setting('request.jwt.claims', true);
 claims jsonb := coalesce(nullif(prior_claims, '')::jsonb, '{}'::jsonb);
 value jsonb;
begin
 perform private.analysis_require_target_owner(p_user_id);
 perform set_config('request.jwt.claim.sub', p_user_id::text, true);
 perform set_config('request.jwt.claims',
  (claims || jsonb_build_object('sub', p_user_id::text))::text, true);
 value := public.yks_dashboard_state();
 perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
 perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
 return value;
exception when others then
 perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
 perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
 raise;
end;
$$;
revoke all on function public.mcp_owner_state(uuid) from public,anon,authenticated,service_role;
grant execute on function public.mcp_owner_state(uuid) to service_role;

-- The bounded topic selection must sort before LIMIT. Use a portable Turkish
-- alphabet key rather than depending on a provider-specific ICU collation.
create function private.mcp_turkish_sort_key(value text) returns text
language sql immutable strict set search_path='' as $$
 select translate(lower(translate(value,'Iİ','ıi')),
  'abcçdefgğhıijklmnoöprsştuüvyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]')
$$;
revoke all on function private.mcp_turkish_sort_key(text) from public,anon,authenticated,service_role;

-- Bounded list tools read only their own public projection. This stable function
-- cannot initialize profiles, settle countdowns or change request claims. The
-- same server-only allowlist gate applies without serializing reads with writes.
create function public.mcp_owner_read(p_user_id uuid,p_resource text,p_filters jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
 allowed_keys text[];
 field text;
 from_day date;
 to_day date;
 page_size integer;
 requested_size numeric;
 task_status text := 'all';
 topic_exam text;
 topic_subject text;
 owner_timezone text;
 rows_value jsonb;
begin
 if p_user_id is null or not exists (
  select 1 from public.owner_allowlist where user_id=p_user_id
 ) or not private.classroom_can_study(p_user_id) then raise exception 'OWNER_REQUIRED'; end if;
 if p_resource is null or p_resource not in ('tasks','topics','sessions','exams')
  or p_filters is null or jsonb_typeof(p_filters) is distinct from 'object'
  or pg_column_size(p_filters)>4096 then raise exception 'INVALID_INPUT'; end if;
 allowed_keys := case p_resource
  when 'tasks' then array['from_date','to_date','status','limit']
  when 'topics' then array['exam','subject','limit']
  when 'sessions' then array['from_date','to_date','limit']
  else array['limit'] end;
 if exists(select 1 from jsonb_object_keys(p_filters) k where not(k=any(allowed_keys))) then
  raise exception 'INVALID_INPUT';
 end if;
 page_size := case when p_resource='exams' then 20 else 25 end;
 if p_filters ? 'limit' then
  if jsonb_typeof(p_filters->'limit') is distinct from 'number' then raise exception 'INVALID_INPUT'; end if;
  requested_size := (p_filters->>'limit')::numeric;
  if requested_size<>trunc(requested_size) or requested_size<1
   or requested_size>(case when p_resource='exams' then 50 else 100 end) then raise exception 'INVALID_INPUT'; end if;
  page_size := requested_size::integer;
 end if;
 foreach field in array array['from_date','to_date'] loop
  if p_filters ? field then
   if jsonb_typeof(p_filters->field) is distinct from 'string'
    or (p_filters->>field) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_INPUT'; end if;
   begin
    if field='from_date' then from_day := (p_filters->>field)::date;
    else to_day := (p_filters->>field)::date; end if;
   exception when datetime_field_overflow or invalid_datetime_format then raise exception 'INVALID_INPUT';
   end;
  end if;
 end loop;
 if from_day>to_day then raise exception 'INVALID_INPUT'; end if;
 if p_resource='tasks' then
  if p_filters ? 'status' then
   if jsonb_typeof(p_filters->'status') is distinct from 'string'
    or (p_filters->>'status') not in ('all','open','done') then raise exception 'INVALID_INPUT'; end if;
   task_status := p_filters->>'status';
  end if;
  with selected as materialized (
   select t.id,t.title,t.plan_date,t.exam,t.subject,t.progress,t.planned_minutes,t.priority,t.updated_at
   from public.tasks t where t.user_id=p_user_id
    and (from_day is null or t.plan_date>=from_day) and (to_day is null or t.plan_date<=to_day)
    and (task_status='all' or (task_status='done' and t.progress>=1) or (task_status='open' and t.progress<1))
   order by t.updated_at desc,t.id limit page_size
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'plan_date',t.plan_date,
   'exam',t.exam,'subject',t.subject,'progress',t.progress,'planned_minutes',t.planned_minutes,'priority',t.priority)
   order by t.updated_at desc,t.id),'[]'::jsonb) into rows_value from selected t;
 elsif p_resource='topics' then
  if p_filters ? 'exam' then
   if jsonb_typeof(p_filters->'exam') is distinct from 'string'
    or (p_filters->>'exam') not in ('TYT','AYT') then raise exception 'INVALID_INPUT'; end if;
   topic_exam := p_filters->>'exam';
  end if;
  if p_filters ? 'subject' then
   if jsonb_typeof(p_filters->'subject') is distinct from 'string'
    or length(btrim(p_filters->>'subject')) not between 1 and 120 then raise exception 'INVALID_INPUT'; end if;
   topic_subject := btrim(p_filters->>'subject');
  end if;
  with selected as materialized (
   select t.id,t.exam,t.subject,t.name,t.parent_id,t.mastery,t.revision,t.review_requested,
    private.mcp_turkish_sort_key(t.subject) collate "C" as subject_order,private.mcp_turkish_sort_key(t.name) collate "C" as name_order
   from public.topics t where t.user_id=p_user_id and (topic_exam is null or t.exam=topic_exam)
    and (topic_subject is null or lower(translate(t.subject,'Iİ','ıi'))=lower(translate(topic_subject,'Iİ','ıi')))
   order by t.exam,subject_order,name_order,t.subject,t.name,t.id limit page_size
  )
  select coalesce(jsonb_agg(to_jsonb(t)-'subject_order'-'name_order'
   order by t.exam,t.subject_order collate "C",t.name_order collate "C",t.subject,t.name,t.id),'[]'::jsonb)
   into rows_value from selected t;
 elsif p_resource='sessions' then
  select coalesce((select p.timezone from public.profiles p where p.user_id=p_user_id),'Europe/Istanbul') into owner_timezone;
  with records as (
   select 'timer'::text as kind,s.id,(s.started_at at time zone owner_timezone)::date as study_date,
    s.subject,s.accumulated_seconds as duration_seconds
   from public.study_sessions s where s.user_id=p_user_id and s.status='finished'
    and (from_day is null or (s.started_at at time zone owner_timezone)::date>=from_day)
    and (to_day is null or (s.started_at at time zone owner_timezone)::date<=to_day)
   union all
   select 'manual'::text,m.id,m.study_date,m.subject,m.duration_seconds
   from public.manual_study_entries m where m.user_id=p_user_id
    and (from_day is null or m.study_date>=from_day) and (to_day is null or m.study_date<=to_day)
  ), selected as materialized (
   select * from records order by study_date desc,id limit page_size
  )
  select coalesce(jsonb_agg(to_jsonb(s) order by s.study_date desc,s.id),'[]'::jsonb)
   into rows_value from selected s;
 else
  with selected as materialized (
   select e.id,e.name,e.exam_date,e.format_code,e.total_net,e.score,e.rank,e.updated_at
   from public.exams e where e.user_id=p_user_id order by e.exam_date desc,e.updated_at desc,e.id limit page_size
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'exam_date',e.exam_date,
   'format_code',e.format_code,'total_net',e.total_net,'score',e.score,'rank',e.rank,
   'results',coalesce((select jsonb_agg(jsonb_build_object('section_key',r.section_key,
    'correct',r.correct,'wrong',r.wrong,'blank',r.blank,'net',r.net) order by r.section_key)
    from public.exam_results r where r.exam_id=e.id and r.user_id=p_user_id),'[]'::jsonb))
   order by e.exam_date desc,e.updated_at desc,e.id),'[]'::jsonb) into rows_value from selected e;
 end if;
 return jsonb_build_object(p_resource,rows_value,'count',jsonb_array_length(rows_value));
end;
$$;
revoke all on function public.mcp_owner_read(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.mcp_owner_read(uuid,text,jsonb) to service_role;
