-- Removing a class membership keeps the approved student account and study history.
-- Both the assigned teacher and the student may end the membership.
create function private.classroom_remove_student(request_id uuid,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.classroom_accounts:=private.classroom_identity();
 receipt public.classroom_receipts; target public.classroom_accounts;
 former_teacher uuid; result jsonb; at_time timestamptz:=clock_timestamp();
begin
 if actor.id is null or actor.status<>'approved' then raise exception 'APPROVAL_REQUIRED'; end if;
 if request_id is null or payload is null or jsonb_typeof(payload)<>'object' or pg_column_size(payload)>10000 then raise exception 'INVALID_INPUT'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor.id::text,0));
 select * into receipt from public.classroom_receipts r where r.user_id=actor.id and r.request_id=classroom_remove_student.request_id;
 if found then
  if receipt.command_type<>'student.remove' or receipt.payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return receipt.result||'{"replayed":true}'::jsonb;
 end if;
 if (select count(*) from public.classroom_receipts where user_id=actor.id and created_at>at_time-interval '1 minute')>=120 then raise exception 'RATE_LIMITED'; end if;
 perform private.check_keys(payload,array['id']);
 if jsonb_typeof(payload->'id') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
 select * into target from public.classroom_accounts where id=(payload->>'id')::uuid for update;
 if not found or target.role<>'student' then raise exception 'ACCESS_DENIED'; end if;
 if actor.role='teacher' then
  if target.status<>'approved' or target.teacher_id is distinct from actor.id then raise exception 'ACCESS_DENIED'; end if;
 elsif actor.role='student' then
  if target.id<>actor.id then raise exception 'ACCESS_DENIED'; end if;
  if target.teacher_id is null then raise exception 'INVALID_TRANSITION'; end if;
 else raise exception 'ACCESS_DENIED'; end if;

 former_teacher:=target.teacher_id;
 update public.classroom_alerts set status='cancelled',closed_at=at_time
 where student_id=target.id and teacher_id=former_teacher
  and (status in ('pending','declined') or (status='accepted' and started_at is null));
 update public.classroom_accounts set teacher_id=null,updated_at=at_time where id=target.id;
 -- The account trigger invalidates the student and admin; the former teacher
 -- also needs an event now that this student is outside their state projection.
 insert into public.classroom_events(user_id) values(former_teacher);
 result:=jsonb_build_object('id',target.id,'request_id',request_id,'replayed',false);
 insert into public.classroom_receipts(user_id,request_id,command_type,payload,result)
 values(actor.id,request_id,'student.remove',payload,result);
 return result;
end $$;

revoke all on function private.classroom_remove_student(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.classroom_remove_student(uuid,jsonb) to authenticated;

create or replace function public.classroom_command(request_id uuid,command_type text,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if command_type='student.remove' then
  return private.classroom_remove_student(request_id,payload);
 end if;
 return private.classroom_command(request_id,command_type,payload);
end $$;
