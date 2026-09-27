-- New teachers and independent students wait for administrator approval.
-- Invited students wait for their teacher; an administrator can intervene.
-- Existing approved accounts, including independent students, are untouched.
create or replace function private.classroom_apply(display_name text,requested_role text,invite_token text default null) returns uuid
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
 -- A rejected invitation must not become an approved independent account by
 -- dropping the invitation token. A later invitation may be reviewed anew.
 if account.status='rejected' and requested_role='student' and teacher is null then raise exception 'ACCESS_DENIED'; end if;
 insert into public.classroom_accounts(id,name,email,role,status)
 values(actor,btrim(display_name),auth_user->>'email',requested_role,'pending')
 on conflict(id) do update set name=excluded.name,email=excluded.email,
  status=case when classroom_accounts.status='approved' then 'approved' else 'pending' end,updated_at=clock_timestamp();
 insert into public.classroom_applications(user_id,name,email,requested_role,teacher_id)
 values(actor,btrim(display_name),auth_user->>'email',requested_role,teacher) returning id into result;
 return result;
end $$;


create or replace function private.classroom_notify() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_value jsonb:=to_jsonb(new); student uuid; teacher uuid; actor uuid; begin
 if tg_table_name in ('classroom_accounts','classroom_applications') then
  actor:=coalesce((row_value->>'user_id')::uuid,(row_value->>'id')::uuid);
  insert into public.classroom_events(user_id) select actor union select id from public.classroom_accounts where role='admin' and status='approved';
  if tg_table_name='classroom_applications' then
   teacher:=(row_value->>'teacher_id')::uuid;
   if teacher is not null then
    insert into public.classroom_events(user_id) select id from public.classroom_accounts where id=teacher and role='teacher' and status='approved';
   end if;
   if tg_op='UPDATE' then
    if (to_jsonb(old)->>'teacher_id')::uuid is distinct from teacher then
     insert into public.classroom_events(user_id)
      select id from public.classroom_accounts
      where id=(to_jsonb(old)->>'teacher_id')::uuid and role='teacher' and status='approved';
    end if;
   end if;
  end if;
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

create or replace function private.classroom_command(request_id uuid,command_type text,payload jsonb) returns jsonb
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
  if actor.role not in ('admin','teacher') then raise exception 'ACCESS_DENIED'; end if;
  perform private.check_keys(payload,array['id','decision','teacher_id']);
  if payload->>'decision' is null or payload->>'decision' not in ('approved','rejected') then raise exception 'INVALID_INPUT'; end if;
  select * into application from public.classroom_applications where id=(payload->>'id')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if actor.role='teacher' and (application.requested_role<>'student' or application.teacher_id is distinct from actor.id or payload ? 'teacher_id') then raise exception 'ACCESS_DENIED'; end if;
  select * into target from public.classroom_accounts where id=application.user_id for update;
  if application.status<>'pending' then
   if application.status<>payload->>'decision' then raise exception 'INVALID_TRANSITION'; end if;
  else
   if target.status='suspended' then raise exception 'ACCESS_DENIED'; end if;
   teacher:=coalesce((payload->>'teacher_id')::uuid,application.teacher_id);
   if payload->>'decision'='approved' then
    if application.requested_role='student' and teacher is not null and not exists(select 1 from public.classroom_accounts where id=teacher and role='teacher' and status='approved') then raise exception 'TEACHER_REQUIRED'; end if;
    update public.classroom_accounts set role=application.requested_role,status='approved',
     teacher_id=case when application.requested_role='student' then teacher else null end,updated_at=at_time where id=target.id;
    if application.requested_role='student' then
     perform private.initialize_owner(target.id);
     update public.profiles set display_name=target.name where user_id=target.id;
    end if;
    -- A transfer explicitly approved by the reviewer ends pending interactions with the old class.
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

create or replace function private.classroom_state() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.classroom_accounts:=private.classroom_identity(); result jsonb; student record; begin
 result:=jsonb_build_object('account',case when actor.id is null then null else to_jsonb(actor) end,'server_now',clock_timestamp(),
 'accounts','[]'::jsonb,'applications',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.classroom_applications a
  where a.user_id=auth.uid() or (actor.role='admin' and actor.status='approved')
   or (actor.role='teacher' and actor.status='approved' and a.requested_role='student' and a.teacher_id=actor.id)),'[]'),
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

-- Registration decisions are delivered in-app. Leave the historical outbox for
-- audit, but prevent both new queue entries and stale deliveries by the old cron.
drop trigger if exists classroom_application_email on public.classroom_applications;
create or replace function public.classroom_email_claim() returns jsonb
language sql security definer set search_path='' as $$ select '[]'::jsonb $$;
