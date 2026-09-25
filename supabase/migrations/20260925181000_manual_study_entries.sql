-- A date-only duration is distinct from a timed session: no clock interval is invented.
create table public.manual_study_entries (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 study_date date not null,
 subject text not null check (length(subject) between 1 and 120 and subject = btrim(subject)),
 duration_seconds integer not null check (duration_seconds between 60 and 86400 and duration_seconds % 60 = 0),
 created_at timestamptz not null default now(),
 unique (id,user_id)
);
create index manual_study_entries_user_date on public.manual_study_entries(user_id,study_date desc,created_at desc);
alter table public.manual_study_entries enable row level security;
create policy owner_read on public.manual_study_entries for select to authenticated
 using (user_id=(select auth.uid()) and exists (
  select 1 from public.owner_allowlist where user_id=(select auth.uid())
 ));
revoke all on public.manual_study_entries from public,anon,authenticated;
grant select on public.manual_study_entries to authenticated;

create function private.manual_study_command(request_id uuid,command_type text,payload jsonb)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare
 owner_id uuid:=private.require_owner();
 receipt public.command_receipts;
 at_time timestamptz:=date_trunc('second',clock_timestamp());
 owner_timezone text;
 local_today date;
 entry public.manual_study_entries;
 study_day date;
 minutes integer;
 subject_name text;
 result jsonb;
begin
 if request_id is null or command_type<>'manual_study.create' or payload is null or pg_column_size(payload)>2048 then raise exception 'INVALID_INPUT'; end if;
 select * into receipt from public.command_receipts r where r.user_id=owner_id and r.request_id=manual_study_command.request_id;
 if found then
  if receipt.command_type<>command_type or receipt.payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return receipt.result||'{"replayed":true}'::jsonb;
 end if;
 if (select count(*) from public.command_receipts r where r.user_id=owner_id and r.created_at>at_time-interval '1 minute')>=120 then raise exception 'RATE_LIMITED'; end if;
 perform private.check_keys(payload,array['confirmed_by_user','study_date','subject','minutes']);
 if payload->'confirmed_by_user' is distinct from 'true'::jsonb then raise exception 'INVALID_INPUT'; end if;
 if jsonb_typeof(payload->'study_date')<>'string' or jsonb_typeof(payload->'subject')<>'string' or jsonb_typeof(payload->'minutes')<>'number' then raise exception 'INVALID_INPUT'; end if;
 if coalesce(payload->>'study_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_INPUT'; end if;
 if coalesce(payload->>'minutes','') !~ '^[0-9]{1,4}$' then raise exception 'INVALID_INPUT'; end if;
 minutes:=(payload->>'minutes')::integer;
 subject_name:=btrim(payload->>'subject');
 if minutes not between 1 and 1440 or subject_name is null or length(subject_name) not between 1 and 120 then raise exception 'INVALID_INPUT'; end if;
 study_day:=(payload->>'study_date')::date;
 perform private.initialize_owner(owner_id);
 select timezone into owner_timezone from public.profiles where user_id=owner_id;
 local_today:=(at_time at time zone owner_timezone)::date;
 if study_day>local_today or study_day<local_today-3659 then raise exception 'INVALID_INPUT'; end if;
 insert into public.manual_study_entries(user_id,study_date,subject,duration_seconds)
 values(owner_id,study_day,subject_name,minutes*60) returning * into entry;
 insert into public.audit_log(user_id,entity,entity_id,action,new_value,source)
 values(owner_id,'manual_study_entry',entry.id,'manual_study.create',to_jsonb(entry),'manual');
 result:=jsonb_build_object('id',entry.id,'request_id',request_id,'replayed',false);
 insert into public.command_receipts(user_id,request_id,command_type,payload,result)
 values(owner_id,request_id,command_type,payload,result);
 return result;
end $$;
revoke all on function private.manual_study_command(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.manual_study_command(uuid,text,jsonb) to authenticated;

-- The authenticated owner receives the date-only records alongside existing timer sessions.
create or replace function private.state() returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=private.require_owner(); at_time timestamptz:=date_trunc('second',clock_timestamp()); result jsonb;
begin
 perform private.initialize_owner(owner_id);perform private.settle_countdown(owner_id,at_time);
 select jsonb_build_object('server_now',at_time,
 'settings',(select to_jsonb(p)-'user_id'-'updated_at' from public.profiles p where p.user_id=owner_id),
 'tasks',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by plan_date,position,created_at,id) from public.tasks t where t.user_id=owner_id),'[]'),
 'topics',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by exam,subject,name) from public.topics t where t.user_id=owner_id),'[]'),
 'sessions',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by started_at desc) from public.study_sessions t where t.user_id=owner_id),'[]'),
 'intervals',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by started_at) from public.study_intervals t where t.user_id=owner_id),'[]'),
 'manual_study_entries',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by study_date desc,created_at desc,id) from public.manual_study_entries t where t.user_id=owner_id),'[]'),
 'day_plans',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by plan_date,version desc) from public.daily_plan_versions t where t.user_id=owner_id),'[]'),
 'topic_history',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by changed_at desc) from public.topic_history t where t.user_id=owner_id),'[]')) into result;
 return result;
end $$;

-- Scheduled reports use the same source rows, with their existing owner gate.
create or replace function public.analysis_source_state(p_user_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
begin
 perform private.analysis_require_target_owner(p_user_id);
 return private.analysis_source_state_for(p_user_id) || jsonb_build_object(
  'manual_study_entries',coalesce((select jsonb_agg(to_jsonb(t)-'user_id' order by t.study_date desc,t.created_at desc,t.id)
   from public.manual_study_entries t where t.user_id=p_user_id),'[]'::jsonb));
end $$;

create or replace function public.yks_command(request_id uuid,command_type text,payload jsonb)
 returns jsonb language sql security invoker set search_path='' as $$
 select case
  when command_type='manual_study.create' then private.manual_study_command(request_id,command_type,payload)
  when command_type in ('exam.create','exam.update','exam.delete') then private.exam_command(request_id,command_type,payload)
  when command_type in ('journal.create','journal.update','journal.delete') then private.journal_command(request_id,command_type,payload)
  when command_type in ('day.mark','day.unmark') then private.day_mark_command(request_id,command_type,payload)
  when command_type in ('practice.create','practice.update','practice.delete') then private.practice_command(request_id,command_type,payload)
  else private.command(request_id,command_type,payload)
 end
$$;
revoke all on function public.yks_command(uuid,text,jsonb),public.analysis_source_state(uuid) from public,anon,authenticated,service_role;
grant execute on function public.yks_command(uuid,text,jsonb) to authenticated;
grant execute on function public.analysis_source_state(uuid) to service_role;
