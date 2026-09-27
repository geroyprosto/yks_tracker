-- Classroom access is independent of the owner's private MCP/analysis gateways.
-- User-editable Auth metadata is never an authorization source.
create table public.classroom_accounts (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 100),
 email text not null check(length(email) between 3 and 320),
 role text not null check(role in ('admin','teacher','student')),
 status text not null default 'pending' check(status in ('pending','approved','rejected','suspended')),
 teacher_id uuid references public.classroom_accounts(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(role='student' or teacher_id is null), check(teacher_id is distinct from id)
);
create index classroom_accounts_teacher on public.classroom_accounts(teacher_id,status) where role='student';
create table public.classroom_applications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 name text not null, email text not null, requested_role text not null check(requested_role in ('teacher','student')),
 teacher_id uuid references public.classroom_accounts(id),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 created_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by uuid references auth.users(id)
);
create unique index classroom_one_pending_application on public.classroom_applications(user_id) where status='pending';
create index classroom_applications_queue on public.classroom_applications(status,created_at);
create table public.classroom_invites (
 id uuid primary key default gen_random_uuid(), teacher_id uuid not null references public.classroom_accounts(id),
 token text not null unique default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','') check(token ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now()
);
create index classroom_invites_teacher on public.classroom_invites(teacher_id,created_at desc);
create table public.classroom_messages (
 id uuid primary key default gen_random_uuid(), teacher_id uuid not null references public.classroom_accounts(id),
 student_id uuid not null references public.classroom_accounts(id), sender_id uuid not null references public.classroom_accounts(id),
 parent_id uuid references public.classroom_messages(id),
 category text not null check(category in ('warning','praise','continue','excellent')),
 body text not null check(length(btrim(body)) between 1 and 2000),
 created_at timestamptz not null default now(), read_at timestamptz,
 check(sender_id=teacher_id or sender_id=student_id)
);
create index classroom_messages_teacher on public.classroom_messages(teacher_id,student_id,created_at desc);
create index classroom_messages_student on public.classroom_messages(student_id,created_at desc);
create table public.classroom_alerts (
 id uuid primary key default gen_random_uuid(), teacher_id uuid not null references public.classroom_accounts(id),
 student_id uuid not null references public.classroom_accounts(id), body text not null check(length(btrim(body)) between 1 and 240),
 kind text not null default 'initial' check(kind in ('initial','followup')),
 parent_id uuid unique references public.classroom_alerts(id),
 status text not null default 'pending' check(status in ('pending','accepted','declined','dismissed','cancelled')),
 refusal_count integer not null default 0 check(refusal_count between 0 and 10),
 created_at timestamptz not null default now(), accepted_at timestamptz, followup_due_at timestamptz,
 started_at timestamptz, closed_at timestamptz,
 check((kind='initial' and parent_id is null) or (kind='followup' and parent_id is not null))
);
create index classroom_alerts_student on public.classroom_alerts(student_id,created_at desc);
create index classroom_alerts_teacher on public.classroom_alerts(teacher_id,created_at desc);
create index classroom_alerts_due on public.classroom_alerts(followup_due_at) where status='accepted' and started_at is null and kind='initial';
create table public.classroom_feedback (
 id uuid primary key default gen_random_uuid(), alert_id uuid not null references public.classroom_alerts(id),
 teacher_id uuid not null references public.classroom_accounts(id), student_id uuid not null references public.classroom_accounts(id),
 event text not null check(event in ('accepted','started','refused_ten','followup_acknowledged')),
 body text not null, created_at timestamptz not null default now(), unique(alert_id,event)
);
create index classroom_feedback_teacher on public.classroom_feedback(teacher_id,created_at desc);
create index classroom_feedback_student on public.classroom_feedback(student_id,created_at desc);
create table public.classroom_presence (
 user_id uuid not null references public.classroom_accounts(id), device_id uuid not null,
 visible boolean not null default true, last_seen timestamptz not null default now(), expires_at timestamptz not null,
 primary key(user_id,device_id)
);
create table public.classroom_receipts (
 user_id uuid not null references auth.users(id), request_id uuid not null, command_type text not null,
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(), primary key(user_id,request_id)
);
create index classroom_receipts_rate on public.classroom_receipts(user_id,created_at);
-- The realtime stream contains invalidation IDs only, never student data.
create table public.classroom_events (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index classroom_events_user on public.classroom_events(user_id,created_at desc);
-- Existing timer timestamps intentionally have second precision. Record the
-- actual insert time as well so an immediate post-accept start is distinguishable
-- from an interval that was already running earlier in the same second.
alter table public.study_intervals add column classroom_recorded_at timestamptz not null default clock_timestamp();
do $$ declare t text; begin
 foreach t in array array['classroom_accounts','classroom_applications','classroom_invites','classroom_messages','classroom_alerts','classroom_feedback','classroom_presence','classroom_receipts','classroom_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

create function private.classroom_can_study(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_browser_session() and target is not null and (
   exists(select 1 from public.owner_allowlist o where o.user_id=target
     and not exists(select 1 from public.classroom_accounts a where a.id=target and a.status in ('suspended','rejected')))
   or exists(select 1 from public.classroom_accounts a where a.id=target and a.role='student' and a.status='approved')
 )
$$;
create function private.classroom_approved() returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_browser_session() and exists(select 1 from public.classroom_accounts where id=auth.uid() and status='approved')
$$;
revoke all on function private.classroom_can_study(uuid),private.classroom_approved() from public,anon,authenticated,service_role;
grant execute on function private.classroom_can_study(uuid),private.classroom_approved() to authenticated;
create policy classroom_events_self on public.classroom_events for select to authenticated
 using(user_id=(select auth.uid()) and (select private.classroom_approved()));
grant select on public.classroom_events to authenticated;

-- Compatibility gate for existing student commands. Teachers cannot call them.
create or replace function private.require_owner() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); begin
 if not private.classroom_can_study(actor) then raise exception 'OWNER_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,0)); return actor;
end $$;
-- Existing restrictive OAuth policies remain intact. No cross-student SELECT
-- policy is added: teacher statistics are projected by a narrowly scoped RPC.
do $$ declare t record; begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 join pg_attribute a on a.attrelid=c.oid and a.attname='user_id' and not a.attisdropped
 where n.nspname='public' and c.relkind='r' and c.relrowsecurity
 and c.relname not like 'classroom_%' and c.relname<>'owner_allowlist' loop
  execute format('create policy classroom_student_self on public.%I for select to authenticated using(user_id=(select auth.uid()) and (select private.classroom_can_study(auth.uid())))',t.relname);
  execute format('create policy classroom_active_only on public.%I as restrictive for all to authenticated using((select private.classroom_can_study(auth.uid()))) with check((select private.classroom_can_study(auth.uid())))',t.relname);
 end loop;
end $$;
create policy classroom_exam_formats on public.exam_format_versions for select to authenticated
 using((select private.classroom_can_study(auth.uid())));

create function private.classroom_identity() returns public.classroom_accounts
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); account public.classroom_accounts; begin
 if actor is null or not private.is_browser_session() then raise exception 'AUTH_REQUIRED'; end if;
 select * into account from public.classroom_accounts where id=actor;
 if account.id is null and exists(select 1 from public.owner_allowlist where user_id=actor) then
  insert into public.classroom_accounts(id,name,email,role,status)
  values(actor,coalesce((select display_name from public.profiles where user_id=actor),'Yönetici'),
    coalesce((select to_jsonb(u)->>'email' from auth.users u where u.id=actor),'admin@example.invalid'),'admin','approved')
  on conflict do nothing;
  select * into account from public.classroom_accounts where id=actor;
 end if;
 return account;
end $$;
create function public.classroom_identity() returns jsonb
language sql security invoker set search_path='' as $$
 with actor as materialized (select private.classroom_identity() as account)
 select case when (account).id is null then null else to_jsonb(account) end from actor
$$;

create function private.classroom_invite(p_token text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('teacher_id',a.id,'teacher_name',a.name,'expires_at',i.expires_at)
 from public.classroom_invites i join public.classroom_accounts a on a.id=i.teacher_id
 where i.token=p_token and i.revoked_at is null and i.expires_at>clock_timestamp()
 and a.role='teacher' and a.status='approved'
$$;
create function public.classroom_invite(token text) returns jsonb
language sql security invoker set search_path='' as $$ select private.classroom_invite(token) $$;

create function private.classroom_apply(display_name text,requested_role text,invite_token text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); account public.classroom_accounts; application public.classroom_applications;
 auth_user jsonb; invitation jsonb; teacher uuid; result uuid; begin
 if actor is null or not private.is_browser_session() then raise exception 'AUTH_REQUIRED'; end if;
 if requested_role is null or requested_role not in ('teacher','student') or length(btrim(display_name)) not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
 select to_jsonb(u) into auth_user from auth.users u where u.id=actor;
 if nullif(auth_user->>'email_confirmed_at','') is null or nullif(auth_user->>'email','') is null then raise exception 'EMAIL_VERIFICATION_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
 if nullif(invite_token,'') is not null then
  if requested_role<>'student' then raise exception 'INVALID_INPUT'; end if;
  invitation:=private.classroom_invite(invite_token);
  if invitation is null then raise exception 'INVITE_INVALID'; end if;
  teacher:=(invitation->>'teacher_id')::uuid;
 end if;
 select * into account from public.classroom_accounts where id=actor;
 if account.status='suspended' or account.role='admin' then raise exception 'ACCESS_DENIED'; end if;
 if account.status='approved' and account.role<>requested_role then raise exception 'ROLE_CHANGE_FORBIDDEN'; end if;
 select * into application from public.classroom_applications where user_id=actor and status='pending';
 if found then
  if application.requested_role=requested_role and application.teacher_id is not distinct from teacher then return application.id; end if;
  raise exception 'PENDING_APPLICATION_EXISTS';
 end if;
 if account.status='approved' and (requested_role='teacher' or teacher is null or teacher=account.teacher_id) then
  select id into result from public.classroom_applications where user_id=actor and status='approved' order by reviewed_at desc limit 1;
  return coalesce(result,actor);
 end if;
 insert into public.classroom_accounts(id,name,email,role,status)
 values(actor,btrim(display_name),auth_user->>'email',requested_role,'pending')
 on conflict(id) do update set name=excluded.name,email=excluded.email,
  status=case when classroom_accounts.status='approved' then 'approved' else 'pending' end,updated_at=clock_timestamp();
 insert into public.classroom_applications(user_id,name,email,requested_role,teacher_id)
 values(actor,btrim(display_name),auth_user->>'email',requested_role,teacher) returning id into result;
 return result;
end $$;
create function public.classroom_apply(display_name text,requested_role text,invite_token text default null) returns uuid
language sql security invoker set search_path='' as $$ select private.classroom_apply(display_name,requested_role,invite_token) $$;

create function private.classroom_student_scope(actor uuid,student uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.classroom_accounts s join public.classroom_accounts t on t.id=s.teacher_id
 where s.id=student and s.role='student' and s.status='approved' and t.id=actor and t.role='teacher' and t.status='approved')
$$;

create function private.classroom_feedback_for(a public.classroom_alerts,p_event text,p_body text) returns void
language sql set search_path='' as $$
 insert into public.classroom_feedback(alert_id,teacher_id,student_id,event,body)
 values(a.id,a.teacher_id,a.student_id,p_event,p_body) on conflict(alert_id,event) do nothing
$$;

-- Durable catch-up uses database time and actual intervals on every device.
create function private.classroom_tick(target uuid default null) returns integer
language plpgsql security definer set search_path='' as $$
declare a public.classroom_alerts; started timestamptz; count_created integer:=0; begin
 for a in select x.* from public.classroom_alerts x where x.kind='initial' and x.status='accepted'
  and x.started_at is null and (target is null or x.student_id=target)
  order by x.id for update skip locked loop
  if not private.classroom_student_scope(a.teacher_id,a.student_id) then
   update public.classroom_alerts set status='cancelled',closed_at=clock_timestamp() where id=a.id;
   update public.classroom_alerts set status='cancelled',closed_at=clock_timestamp() where parent_id=a.id and status='pending';
   continue;
  end if;
  select min(i.started_at) into started from public.study_intervals i
  where i.user_id=a.student_id and i.classroom_recorded_at>=a.accepted_at
   and i.started_at>=date_trunc('second',a.accepted_at) and i.started_at<=clock_timestamp();
  if started is not null then
   update public.classroom_alerts set started_at=started where id=a.id;
   perform private.classroom_feedback_for(a,'started','Öğrenci çalışmaya başladı');
   update public.classroom_alerts set status='cancelled',closed_at=clock_timestamp() where parent_id=a.id and status='pending';
  elsif a.followup_due_at<=clock_timestamp() then
   insert into public.classroom_alerts(teacher_id,student_id,kind,parent_id,body)
   values(a.teacher_id,a.student_id,'followup',a.id,'E hani çalışacaktın, bahanen ne???') on conflict(parent_id) do nothing;
   if found then count_created:=count_created+1; end if;
  end if;
 end loop;
 return count_created;
end $$;
create function private.classroom_interval_started() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 perform private.classroom_tick(new.user_id); return new;
end $$;
create trigger classroom_interval_started after insert on public.study_intervals
for each row execute function private.classroom_interval_started();
create function public.classroom_tick() returns integer
language sql security invoker set search_path='' as $$ select private.classroom_tick(null) $$;

create function private.classroom_notify() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_value jsonb:=to_jsonb(new); student uuid; teacher uuid; actor uuid; begin
 if tg_table_name in ('classroom_accounts','classroom_applications') then
  actor:=coalesce((row_value->>'user_id')::uuid,(row_value->>'id')::uuid);
  insert into public.classroom_events(user_id) select actor union select id from public.classroom_accounts where role='admin' and status='approved';
 elsif tg_table_name in ('classroom_presence','study_sessions','practice_entries','manual_study_entries','exams','topics','study_intervals') then
  student:=(row_value->>'user_id')::uuid;
  select teacher_id into teacher from public.classroom_accounts where id=student and status='approved';
  if teacher is not null then insert into public.classroom_events(user_id) values(teacher); end if;
 else
  student:=(row_value->>'student_id')::uuid; teacher:=(row_value->>'teacher_id')::uuid;
  insert into public.classroom_events(user_id) values(student);
  if private.classroom_student_scope(teacher,student) then insert into public.classroom_events(user_id) values(teacher); end if;
 end if;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['classroom_accounts','classroom_applications','classroom_messages','classroom_alerts','classroom_feedback','classroom_presence','study_sessions','study_intervals','practice_entries','manual_study_entries','exams','topics'] loop
  execute format('create trigger classroom_changed after insert or update on public.%I for each row execute function private.classroom_notify()',t);
 end loop;
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.classroom_events;
 end if;
end $$;

create function private.classroom_command(request_id uuid,command_type text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.classroom_accounts:=private.classroom_identity(); receipt public.classroom_receipts;
 application public.classroom_applications; target public.classroom_accounts; message public.classroom_messages;
 alert public.classroom_alerts; teacher uuid; result jsonb; record_id uuid; at_time timestamptz:=clock_timestamp(); days integer;
begin
 if actor.id is null or actor.status<>'approved' then raise exception 'APPROVAL_REQUIRED'; end if;
 if request_id is null or command_type is null or payload is null or jsonb_typeof(payload)<>'object' or pg_column_size(payload)>10000 then raise exception 'INVALID_INPUT'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor.id::text,0));
 select * into receipt from public.classroom_receipts r where r.user_id=actor.id and r.request_id=classroom_command.request_id;
 if found then
  if receipt.command_type<>command_type or receipt.payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return receipt.result||'{"replayed":true}'::jsonb;
 end if;
 if (select count(*) from public.classroom_receipts where user_id=actor.id and created_at>at_time-interval '1 minute')>=120 then raise exception 'RATE_LIMITED'; end if;
 if command_type='application.review' then
  if actor.role<>'admin' then raise exception 'ACCESS_DENIED'; end if;
  perform private.check_keys(payload,array['id','decision','teacher_id']);
  if payload->>'decision' is null or payload->>'decision' not in ('approved','rejected') then raise exception 'INVALID_INPUT'; end if;
  select * into application from public.classroom_applications where id=(payload->>'id')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into target from public.classroom_accounts where id=application.user_id for update;
  if application.status<>'pending' then
   if application.status<>payload->>'decision' then raise exception 'INVALID_TRANSITION'; end if;
  else
   if target.status='suspended' then raise exception 'ACCESS_DENIED'; end if;
   teacher:=coalesce((payload->>'teacher_id')::uuid,application.teacher_id);
   if payload->>'decision'='approved' then
    if application.requested_role='student' and (teacher is null or not exists(select 1 from public.classroom_accounts where id=teacher and role='teacher' and status='approved')) then raise exception 'TEACHER_REQUIRED'; end if;
    update public.classroom_accounts set role=application.requested_role,status='approved',
     teacher_id=case when application.requested_role='student' then teacher else null end,updated_at=at_time where id=target.id;
    if application.requested_role='student' then
     perform private.initialize_owner(target.id);
     update public.profiles set display_name=target.name where user_id=target.id;
    end if;
    -- A transfer explicitly approved by admin ends pending interactions with the old class.
    update public.classroom_alerts set status='cancelled',closed_at=at_time
    where student_id=target.id and teacher_id is distinct from teacher and (status in ('pending','declined') or (status='accepted' and started_at is null));
   elsif target.status<>'approved' then
    update public.classroom_accounts set status='rejected',updated_at=at_time where id=target.id;
   end if;
   update public.classroom_applications set status=payload->>'decision',teacher_id=teacher,reviewed_at=at_time,reviewed_by=actor.id where id=application.id;
  end if;
  record_id:=application.id;
 elsif command_type='account.suspend' then
  if actor.role<>'admin' then raise exception 'ACCESS_DENIED'; end if;
  perform private.check_keys(payload,array['id','suspended']);
  if jsonb_typeof(payload->'suspended') is distinct from 'boolean' then raise exception 'INVALID_INPUT'; end if;
  select * into target from public.classroom_accounts where id=(payload->>'id')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if target.id=actor.id or target.role='admin' or target.status not in ('approved','suspended') then raise exception 'INVALID_TRANSITION'; end if;
  update public.classroom_accounts set status=case when (payload->>'suspended')::boolean then 'suspended' else 'approved' end,updated_at=at_time where id=target.id;
  if (payload->>'suspended')::boolean then
   update public.classroom_alerts set status='cancelled',closed_at=at_time
   where (student_id=target.id or teacher_id=target.id) and (status in ('pending','declined') or (status='accepted' and started_at is null));
   if target.role='teacher' then
    insert into public.classroom_events(user_id) select id from public.classroom_accounts where teacher_id=target.id;
   end if;
  end if;
  record_id:=target.id;
 elsif command_type='invite.create' then
  if actor.role<>'teacher' then raise exception 'ACCESS_DENIED'; end if;
  perform private.check_keys(payload,array['expires_in_days']);
  days:=coalesce((payload->>'expires_in_days')::integer,7);
  if days not between 1 and 30 then raise exception 'INVALID_INPUT'; end if;
  insert into public.classroom_invites(teacher_id,expires_at) values(actor.id,at_time+make_interval(days=>days)) returning to_jsonb(classroom_invites) into result;
  record_id:=(result->>'id')::uuid;
 elsif command_type='invite.revoke' then
  if actor.role<>'teacher' then raise exception 'ACCESS_DENIED'; end if;
  perform private.check_keys(payload,array['id']);
  update public.classroom_invites set revoked_at=coalesce(revoked_at,at_time) where id=(payload->>'id')::uuid and teacher_id=actor.id returning id into record_id;
  if record_id is null then raise exception 'NOT_FOUND'; end if;
 elsif command_type in ('message.send','alert.send') then
  if actor.role<>'teacher' then raise exception 'ACCESS_DENIED'; end if;
  perform private.check_keys(payload,case when command_type='message.send' then array['student_id','category','body'] else array['student_id','body'] end);
  if not private.classroom_student_scope(actor.id,(payload->>'student_id')::uuid) then raise exception 'ACCESS_DENIED'; end if;
  if command_type='message.send' then
   insert into public.classroom_messages(teacher_id,student_id,sender_id,category,body)
   values(actor.id,(payload->>'student_id')::uuid,actor.id,payload->>'category',btrim(payload->>'body')) returning id into record_id;
  else
   insert into public.classroom_alerts(teacher_id,student_id,body) values(actor.id,(payload->>'student_id')::uuid,btrim(payload->>'body')) returning id into record_id;
  end if;
 elsif command_type in ('message.reply','message.read') then
  perform private.check_keys(payload,case when command_type='message.reply' then array['id','body'] else array['id'] end);
  select * into message from public.classroom_messages where id=(payload->>'id')::uuid for update;
  if not found or actor.id not in (message.teacher_id,message.student_id) or not private.classroom_student_scope(message.teacher_id,message.student_id) then raise exception 'ACCESS_DENIED'; end if;
  record_id:=message.id;
  if command_type='message.reply' then
   insert into public.classroom_messages(teacher_id,student_id,sender_id,parent_id,category,body)
   values(message.teacher_id,message.student_id,actor.id,coalesce(message.parent_id,message.id),message.category,btrim(payload->>'body')) returning id into record_id;
  elsif message.sender_id<>actor.id then
   update public.classroom_messages set read_at=coalesce(read_at,at_time) where id=message.id;
  end if;
 elsif command_type='alert.respond' then
  perform private.check_keys(payload,array['id','response']);
  if actor.role<>'student' then raise exception 'ACCESS_DENIED'; end if;
  select * into alert from public.classroom_alerts where id=(payload->>'id')::uuid for update;
  if not found or alert.student_id<>actor.id or not private.classroom_student_scope(alert.teacher_id,actor.id) then raise exception 'ACCESS_DENIED'; end if;
  record_id:=alert.id;
  if payload->>'response'='accept' then
   if alert.status not in ('pending','accepted') then raise exception 'INVALID_TRANSITION'; end if;
   if alert.status='pending' then
    update public.classroom_alerts set status='accepted',accepted_at=at_time,closed_at=at_time,
     followup_due_at=case when kind='initial' then at_time+interval '15 minutes' else null end where id=alert.id;
    perform private.classroom_feedback_for(alert,case when alert.kind='initial' then 'accepted' else 'followup_acknowledged' end,
     case when alert.kind='initial' then 'Öğrenci çalışacağını onayladı' else 'Öğrenci takip uyarısını kabul etti' end);
   end if;
  elsif payload->>'response'='refuse' then
   if alert.kind<>'initial' or alert.status not in ('pending','declined') then raise exception 'INVALID_TRANSITION'; end if;
   if alert.status='pending' then
    update public.classroom_alerts set refusal_count=least(10,refusal_count+1),
     status=case when refusal_count>=9 then 'declined' else status end,
     closed_at=case when refusal_count>=9 then at_time else null end where id=alert.id returning * into alert;
    if alert.refusal_count=10 then perform private.classroom_feedback_for(alert,'refused_ten','Öğrenci uyarıya 10 kez Hayır dedi'); end if;
   end if;
  elsif payload->>'response'='dismiss' then
   if alert.status not in ('declined','dismissed') then raise exception 'INVALID_TRANSITION'; end if;
   update public.classroom_alerts set status='dismissed',closed_at=coalesce(closed_at,at_time) where id=alert.id;
  else raise exception 'INVALID_INPUT'; end if;
 elsif command_type in ('presence.heartbeat','presence.leave') then
  perform private.check_keys(payload,array['device_id','visible']);
  if (payload->>'device_id')::uuid is null then raise exception 'INVALID_INPUT'; end if;
  if payload ? 'visible' and jsonb_typeof(payload->'visible') is distinct from 'boolean' then raise exception 'INVALID_INPUT'; end if;
  insert into public.classroom_presence(user_id,device_id,visible,last_seen,expires_at)
  values(actor.id,(payload->>'device_id')::uuid,coalesce((payload->>'visible')::boolean,true),at_time,
   case when command_type='presence.leave' then at_time else at_time+interval '75 seconds' end)
  on conflict(user_id,device_id) do update set visible=excluded.visible,last_seen=excluded.last_seen,expires_at=excluded.expires_at;
  record_id:=actor.id;
 else raise exception 'INVALID_INPUT'; end if;
 result:=coalesce(result,'{}'::jsonb)||jsonb_build_object('id',record_id,'request_id',request_id,'replayed',false);
 insert into public.classroom_receipts(user_id,request_id,command_type,payload,result) values(actor.id,request_id,command_type,payload,result);
 return result;
end $$;
create function public.classroom_command(request_id uuid,command_type text,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.classroom_command(request_id,command_type,payload) $$;

-- This projection deliberately excludes personal journals, tasks, imported PDFs,
-- AI reports, free-text notes, audit logs and OAuth connections.
create function private.classroom_statistics(student uuid) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('configured',true,'authenticated',true,'server_now',clock_timestamp(),
 'settings',jsonb_build_object('display_name',(select name from public.classroom_accounts where id=student),'timezone','Europe/Istanbul'),
 'tasks','[]'::jsonb,'day_plans','[]'::jsonb,'topic_history','[]'::jsonb,'journal_entries','[]'::jsonb,'day_marks','[]'::jsonb,
 'topics',coalesce((select jsonb_agg(to_jsonb(t)-'user_id'-'notes'-'source'-'next_step') from public.topics t where t.user_id=student),'[]'),
 'sessions',coalesce((select jsonb_agg(to_jsonb(s)-'user_id'-'title') from public.study_sessions s where s.user_id=student),'[]'),
 'intervals',coalesce((select jsonb_agg(to_jsonb(i)-'user_id'-'classroom_recorded_at') from public.study_intervals i where i.user_id=student),'[]'),
 'manual_study_entries',coalesce((select jsonb_agg(to_jsonb(m)-'user_id') from public.manual_study_entries m where m.user_id=student),'[]'),
 'practice_entries',coalesce((select jsonb_agg(to_jsonb(p)-'user_id') from public.practice_entries p where p.user_id=student),'[]'),
 'exam_formats',coalesce((select jsonb_agg(to_jsonb(f)) from public.exam_format_versions f),'[]'),
 'exams',coalesce((select jsonb_agg((to_jsonb(e)-'user_id'-'notes'-'import_metadata'-'source_document_id')||jsonb_build_object('results',
  coalesce((select jsonb_agg(to_jsonb(r)-'user_id'-'exam_id') from public.exam_results r where r.exam_id=e.id),'[]')) order by e.exam_date desc,e.created_at desc)
  from public.exams e where e.user_id=student),'[]'))
$$;
create function private.classroom_state() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.classroom_accounts:=private.classroom_identity(); result jsonb; student record; begin
 result:=jsonb_build_object('account',case when actor.id is null then null else to_jsonb(actor) end,'server_now',clock_timestamp(),
 'accounts','[]'::jsonb,'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.classroom_applications a
  where a.user_id=auth.uid() or (actor.role='admin' and actor.status='approved')),'[]'),
 'invites','[]'::jsonb,'messages','[]'::jsonb,'alerts','[]'::jsonb,'feedback','[]'::jsonb,'students','[]'::jsonb);
 if actor.id is null or actor.status<>'approved' then return result; end if;
 if actor.role='student' then perform private.classroom_tick(actor.id);
 elsif actor.role='teacher' then
  for student in select id from public.classroom_accounts where teacher_id=actor.id and role='student' and status='approved' loop
   perform private.settle_countdown(student.id,clock_timestamp()); perform private.classroom_tick(student.id);
  end loop;
 end if;
 return result||jsonb_build_object(
 'accounts',case when actor.role='admin' then coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.classroom_accounts a),'[]') else '[]'::jsonb end,
 'invites',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from public.classroom_invites i where actor.role='teacher' and i.teacher_id=actor.id),'[]'),
 'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from public.classroom_messages m where
  (actor.role='student' and m.student_id=actor.id and private.classroom_student_scope(m.teacher_id,actor.id)) or (actor.role='teacher' and m.teacher_id=actor.id and private.classroom_student_scope(actor.id,m.student_id))),'[]'),
 'alerts',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from public.classroom_alerts a where
  (actor.role='student' and a.student_id=actor.id and (a.status not in ('pending','declined') or private.classroom_student_scope(a.teacher_id,actor.id))) or (actor.role='teacher' and a.teacher_id=actor.id and private.classroom_student_scope(actor.id,a.student_id))),'[]'),
 'feedback',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at desc) from public.classroom_feedback f where
  (actor.role='student' and f.student_id=actor.id) or (actor.role='teacher' and f.teacher_id=actor.id and private.classroom_student_scope(actor.id,f.student_id))),'[]'),
 'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'teacher_id',s.teacher_id,'state',private.classroom_statistics(s.id),
 'presence',jsonb_build_object('online',coalesce(p.online,false),'last_seen',p.last_seen,'session_id',active.id,
 'status',case when not coalesce(p.online,false) then 'offline' when active.status='running' then 'working' when active.status='paused' then 'break' else 'online' end)) order by s.name)
 from public.classroom_accounts s
 left join lateral(select bool_or(expires_at>clock_timestamp() and visible) as online,max(last_seen) as last_seen from public.classroom_presence where user_id=s.id) p on true
 left join lateral(select id,status from public.study_sessions where user_id=s.id and status in ('running','paused') limit 1) active on true
 where actor.role='teacher' and s.teacher_id=actor.id and s.status='approved' and s.role='student'),'[]'));
end $$;
create function public.classroom_state() returns jsonb
language sql security invoker set search_path='' as $$ select private.classroom_state() $$;

-- Revocation is explicit even on projects whose Data API still grants defaults.
revoke all on function private.classroom_identity(),private.classroom_invite(text),private.classroom_apply(text,text,text),
 private.classroom_student_scope(uuid,uuid),private.classroom_feedback_for(public.classroom_alerts,text,text),private.classroom_tick(uuid),
 private.classroom_interval_started(),private.classroom_notify(),private.classroom_command(uuid,text,jsonb),private.classroom_statistics(uuid),private.classroom_state()
 from public,anon,authenticated,service_role;
grant execute on function private.classroom_identity(),private.classroom_apply(text,text,text),private.classroom_command(uuid,text,jsonb),private.classroom_state() to authenticated;
grant usage on schema private to anon,service_role;
grant execute on function private.classroom_invite(text) to anon,authenticated;
grant execute on function private.classroom_tick(uuid) to service_role;
revoke all on function public.classroom_identity(),public.classroom_invite(text),public.classroom_apply(text,text,text),
 public.classroom_command(uuid,text,jsonb),public.classroom_state(),public.classroom_tick() from public,anon,authenticated,service_role;
grant execute on function public.classroom_identity(),public.classroom_apply(text,text,text),public.classroom_command(uuid,text,jsonb),public.classroom_state() to authenticated;
grant execute on function public.classroom_invite(text) to anon,authenticated;
grant execute on function public.classroom_tick() to service_role;

-- Install a durable minute scheduler when pg_cron is already available. Hosted
-- projects without pg_cron use the authenticated service cron HTTP endpoint.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') and not exists(select 1 from pg_extension where extname='pg_cron') then
  create extension pg_cron;
 end if;
 if exists(select 1 from pg_extension where extname='pg_cron') then
  execute $cron$select cron.schedule('classroom-alert-followup','* * * * *','select private.classroom_tick(null); delete from public.classroom_events where created_at < now()-interval ''1 day'';')$cron$;
 end if;
end $$;
