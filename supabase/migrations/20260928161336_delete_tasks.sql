-- Delete tasks through the command RPC while retaining recorded study time.
create function private.task_delete_command(request_id uuid,command_type text,payload jsonb)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare
 owner_id uuid:=private.require_owner();
 at_time timestamptz:=date_trunc('second',clock_timestamp());
 receipt public.command_receipts;
 task public.tasks;
 result jsonb;
begin
 if request_id is null or command_type<>'task.delete' or payload is null or pg_column_size(payload)>64000 then
  raise exception 'INVALID_INPUT';
 end if;
 select * into receipt from public.command_receipts r
  where r.user_id=owner_id and r.request_id=task_delete_command.request_id;
 if found then
  if receipt.command_type<>command_type or receipt.payload<>payload then
   raise exception 'IDEMPOTENCY_CONFLICT';
  end if;
  return receipt.result||'{"replayed":true}'::jsonb;
 end if;
 if (select count(*) from public.command_receipts r
     where r.user_id=owner_id and r.created_at>at_time-interval '1 minute')>=120 then
  raise exception 'RATE_LIMITED';
 end if;
 perform private.initialize_owner(owner_id);
 perform private.settle_countdown(owner_id,at_time);
 perform private.check_keys(payload,array['id','expected_revision']);
 if not payload ?& array['id','expected_revision'] then raise exception 'INVALID_INPUT'; end if;
 select * into task from public.tasks t
  where t.user_id=owner_id and t.id=(payload->>'id')::uuid for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if task.revision is distinct from (payload->>'expected_revision')::int then raise exception 'CONFLICT'; end if;

 -- A session keeps its own title, subject, course, duration and intervals.
 -- Only its link to the removed task is cleared.
 update public.study_sessions s set task_id=null,revision=s.revision+1
  where s.user_id=owner_id and s.task_id=task.id;
 delete from public.tasks t where t.user_id=owner_id and t.id=task.id;
 perform private.snapshot_day(owner_id,task.plan_date);
 insert into public.audit_log(user_id,entity,entity_id,action,old_value,new_value)
 values(owner_id,'task',task.id,command_type,to_jsonb(task),null);
 result:=jsonb_build_object('id',task.id,'request_id',request_id,'replayed',false);
 insert into public.command_receipts(user_id,request_id,command_type,payload,result)
 values(owner_id,request_id,command_type,payload,result);
 return result;
end $$;
revoke all on function private.task_delete_command(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.task_delete_command(uuid,text,jsonb) to authenticated;

create or replace function public.yks_command(request_id uuid,command_type text,payload jsonb)
 returns jsonb language sql security invoker set search_path='' as $$
 select case
  when command_type='task.delete' then private.task_delete_command(request_id,command_type,payload)
  when command_type='manual_study.create' then private.manual_study_command(request_id,command_type,payload)
  when command_type in ('exam.create','exam.update','exam.delete') then private.exam_command(request_id,command_type,payload)
  when command_type in ('journal.create','journal.update','journal.delete') then private.journal_command(request_id,command_type,payload)
  when command_type in ('day.mark','day.unmark') then private.day_mark_command(request_id,command_type,payload)
  when command_type in ('practice.create','practice.update','practice.delete') then private.practice_command(request_id,command_type,payload)
  else private.command(request_id,command_type,payload)
 end
$$;
revoke all on function public.yks_command(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.yks_command(uuid,text,jsonb) to authenticated;
