-- Temporary classroom pause. Re-enable this flag and the application flag in
-- the same release; retain memberships/history so no user data needs restoring.
create function private.classroom_teacher_features_enabled() returns boolean
language sql stable set search_path='' as $$ select false $$;
revoke all on function private.classroom_teacher_features_enabled() from public,anon,authenticated,service_role;
grant execute on function private.classroom_teacher_features_enabled() to authenticated;

-- Preserve the implementations for a deliberate future re-enable, but revoke
-- direct access so the guarded entrypoints cannot be bypassed.
alter function private.classroom_state() rename to classroom_state_unpaused;
alter function private.classroom_command(uuid,text,jsonb) rename to classroom_command_unpaused;
alter function private.classroom_remove_student(uuid,jsonb) rename to classroom_remove_student_unpaused;
alter function private.classroom_tick(uuid) rename to classroom_tick_unpaused;
-- PL/pgSQL parameter qualifiers use the function's name; a rename alone does
-- not update them. Keep durable receipt lookups valid in the retained bodies.
do $$ begin
 execute replace(pg_get_functiondef('private.classroom_command_unpaused(uuid,text,jsonb)'::regprocedure),
  'classroom_command.request_id','classroom_command_unpaused.request_id');
 execute replace(pg_get_functiondef('private.classroom_remove_student_unpaused(uuid,jsonb)'::regprocedure),
  'classroom_remove_student.request_id','classroom_remove_student_unpaused.request_id');
end $$;
revoke all on function private.classroom_state_unpaused(),private.classroom_command_unpaused(uuid,text,jsonb),
 private.classroom_remove_student_unpaused(uuid,jsonb),private.classroom_tick_unpaused(uuid)
 from public,anon,authenticated,service_role;

create function private.classroom_state() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.classroom_accounts:=private.classroom_identity();
begin
 if not private.classroom_teacher_features_enabled() and actor.role='teacher' then
  return jsonb_build_object('account',to_jsonb(actor),'server_now',clock_timestamp(),'teacher_features_paused',true,
   'accounts','[]'::jsonb,'applications','[]'::jsonb,'invites','[]'::jsonb,'messages','[]'::jsonb,
   'alerts','[]'::jsonb,'feedback','[]'::jsonb,'students','[]'::jsonb);
 end if;
 return private.classroom_state_unpaused();
end $$;

create function private.classroom_command(request_id uuid,command_type text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.classroom_accounts;
begin
 if not private.classroom_teacher_features_enabled() then
  -- Legacy devices can acknowledge presence without writing leases/receipts.
  if command_type in ('presence.heartbeat','presence.leave') then return '{"paused":true}'::jsonb; end if;
  actor:=private.classroom_identity();
  if actor.role='teacher' or command_type not in ('application.review','account.suspend') then
   raise exception 'TEACHER_FEATURES_PAUSED';
  end if;
 end if;
 return private.classroom_command_unpaused(request_id,command_type,payload);
end $$;

create function private.classroom_remove_student(request_id uuid,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.classroom_accounts:=private.classroom_identity();
begin
 if not private.classroom_teacher_features_enabled() and actor.role='teacher' then
  raise exception 'TEACHER_FEATURES_PAUSED';
 end if;
 return private.classroom_remove_student_unpaused(request_id,payload);
end $$;

create function private.classroom_tick(target uuid default null) returns integer
language plpgsql security definer set search_path='' as $$
begin
 if not private.classroom_teacher_features_enabled() then return 0; end if;
 return private.classroom_tick_unpaused(target);
end $$;

revoke all on function private.classroom_state(),private.classroom_command(uuid,text,jsonb),
 private.classroom_remove_student(uuid,jsonb),private.classroom_tick(uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.classroom_state(),private.classroom_command(uuid,text,jsonb),
 private.classroom_remove_student(uuid,jsonb) to authenticated;
grant execute on function private.classroom_tick(uuid) to service_role;

-- Explicitly rebind public RPCs after renaming their former dependencies.
create or replace function public.classroom_state() returns jsonb
language sql security invoker set search_path='' as $$ select private.classroom_state() $$;
create or replace function public.classroom_command(request_id uuid,command_type text,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if command_type='student.remove' then return private.classroom_remove_student(request_id,payload); end if;
 return private.classroom_command(request_id,command_type,payload);
end $$;
create or replace function public.classroom_tick() returns integer
language sql security invoker set search_path='' as $$ select private.classroom_tick(null) $$;

-- The WHEN predicate skips teacher notification work before invoking any
-- per-row trigger. Study timers, revisions and their own triggers are unchanged.
do $$ declare t text; begin
 foreach t in array array['classroom_accounts','classroom_applications','classroom_messages','classroom_alerts',
  'classroom_feedback','classroom_presence','study_sessions','study_intervals','practice_entries',
  'manual_study_entries','exams','topics'] loop
  execute format('drop trigger classroom_changed on public.%I',t);
  execute format('create trigger classroom_changed after insert or update on public.%I for each row when (private.classroom_teacher_features_enabled()) execute function private.classroom_notify()',t);
 end loop;
end $$;
drop trigger classroom_interval_started on public.study_intervals;
create trigger classroom_interval_started after insert on public.study_intervals
for each row when (private.classroom_teacher_features_enabled()) execute function private.classroom_interval_started();

-- Membership removal and account deletion also insert explicit invalidations.
-- Catch those writes centrally, without deleting existing events or history.
create function private.classroom_filter_paused_teacher_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not private.classroom_teacher_features_enabled()
  and exists(select 1 from public.classroom_accounts where id=new.user_id and role='teacher') then return null; end if;
 return new;
end $$;
revoke all on function private.classroom_filter_paused_teacher_event() from public,anon,authenticated,service_role;
create trigger classroom_filter_paused_teacher_event before insert on public.classroom_events
for each row execute function private.classroom_filter_paused_teacher_event();

-- Existing direct Realtime subscriptions cannot read old or new invalidations.
alter policy classroom_events_self on public.classroom_events
 using(user_id=(select auth.uid()) and (select private.classroom_approved())
  and (select private.classroom_teacher_features_enabled()));

-- The existing cron job retains its expired-event cleanup; its tick is now a
-- constant-time no-op and neither emits reminders nor inspects student timers.
