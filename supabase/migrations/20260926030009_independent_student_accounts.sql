-- A verified student who arrives without a class link owns a personal study
-- space immediately. A valid class link still creates an application for the
-- administrator to review; accepting that application changes teacher_id.
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
 if requested_role='student' and teacher is null then
  -- Rejected students cannot bypass an administrator's decision by applying
  -- again as independent students.
  if account.status='rejected' then raise exception 'ACCESS_DENIED'; end if;
  insert into public.classroom_accounts(id,name,email,role,status,teacher_id)
  values(actor,btrim(display_name),auth_user->>'email','student','approved',null)
  on conflict(id) do update set name=excluded.name,email=excluded.email,role='student',
   status='approved',teacher_id=null,updated_at=clock_timestamp();
  perform private.initialize_owner(actor);
  update public.profiles set display_name=(select name from public.classroom_accounts where id=actor) where user_id=actor;
  return actor;
 end if;
 insert into public.classroom_accounts(id,name,email,role,status)
 values(actor,btrim(display_name),auth_user->>'email',requested_role,'pending')
 on conflict(id) do update set name=excluded.name,email=excluded.email,
  status=case when classroom_accounts.status='approved' then 'approved' else 'pending' end,updated_at=clock_timestamp();
 insert into public.classroom_applications(user_id,name,email,requested_role,teacher_id)
 values(actor,btrim(display_name),auth_user->>'email',requested_role,teacher) returning id into result;
 return result;
end $$;

-- Applications created before this change should not strand students who
-- signed up without a teacher. They were already email-verified by apply().
do $$
declare student record;
begin
 for student in
  select a.id,a.name,ap.id as application_id
  from public.classroom_accounts a
  join public.classroom_applications ap on ap.user_id=a.id and ap.status='pending'
  join auth.users u on u.id=a.id
  where a.role='student' and a.status='pending' and ap.requested_role='student'
   and ap.teacher_id is null and nullif(to_jsonb(u)->>'email_confirmed_at','') is not null
 loop
  update public.classroom_accounts set status='approved',updated_at=clock_timestamp() where id=student.id;
  perform private.initialize_owner(student.id);
  update public.profiles set display_name=student.name where user_id=student.id;
  update public.classroom_applications set status='approved',reviewed_at=clock_timestamp() where id=student.application_id;
  update private.classroom_email_outbox set sent_at=coalesce(sent_at,clock_timestamp()) where application_id=student.application_id;
 end loop;
end $$;
