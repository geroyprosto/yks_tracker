-- One account-wide switch controls whether future analyses receive saved journals.
alter table public.profiles
 add column journal_analysis_enabled boolean not null default true;

-- The app owner requested access to their earlier journals. Preserve other
-- existing accounts' explicit per-entry restrictions until they opt in.
update public.profiles p set journal_analysis_enabled=false,
 revision=p.revision+1,updated_at=now()
where not exists(select 1 from public.owner_allowlist o where o.user_id=p.user_id)
 and exists(select 1 from public.journal_entries j where j.user_id=p.user_id
  and (j.exclude_from_analysis
   or (length(btrim(j.original_text))>0 and not ('original_text'=any(j.ai_shared_fields)))
   or exists(select 1 from jsonb_object_keys(j.structured_fields) as field(key)
    where not (field.key=any(j.ai_shared_fields)))));

create function private.journal_analysis_setting_command(request_id uuid,command_type text,payload jsonb)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare
 owner_id uuid:=private.require_owner();
 at_time timestamptz:=date_trunc('second',clock_timestamp());
 receipt public.command_receipts;
 profile public.profiles;
 before_value jsonb;
 result jsonb;
begin
 if request_id is null or command_type<>'settings.journal_analysis.set'
    or payload is null or jsonb_typeof(payload) is distinct from 'object'
    or pg_column_size(payload)>64000 then raise exception 'INVALID_INPUT'; end if;
 select * into receipt from public.command_receipts r
  where r.user_id=owner_id and r.request_id=journal_analysis_setting_command.request_id;
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
 perform private.check_keys(payload,array['expected_revision','enabled']);
 if not payload ?& array['expected_revision','enabled']
    or jsonb_typeof(payload->'expected_revision') is distinct from 'number'
    or (payload->>'expected_revision')::numeric<1
    or (payload->>'expected_revision')::numeric<>trunc((payload->>'expected_revision')::numeric)
    or jsonb_typeof(payload->'enabled') is distinct from 'boolean' then
  raise exception 'INVALID_INPUT';
 end if;
 perform private.initialize_owner(owner_id);
 select * into profile from public.profiles p where p.user_id=owner_id for update;
 if profile.revision is distinct from (payload->>'expected_revision')::integer then
  raise exception 'CONFLICT';
 end if;
 before_value:=to_jsonb(profile);
 update public.profiles p set journal_analysis_enabled=(payload->>'enabled')::boolean,
  revision=p.revision+1,updated_at=at_time where p.user_id=owner_id returning * into profile;
 insert into public.audit_log(user_id,entity,entity_id,action,old_value,new_value)
 values(owner_id,'settings',owner_id,command_type,before_value,to_jsonb(profile));
 result:=jsonb_build_object('id',owner_id,'request_id',request_id,'replayed',false);
 insert into public.command_receipts(user_id,request_id,command_type,payload,result)
 values(owner_id,request_id,command_type,payload,result);
 return result;
end $$;
revoke all on function private.journal_analysis_setting_command(uuid,text,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function private.journal_analysis_setting_command(uuid,text,jsonb) to authenticated;

create or replace function public.yks_command(request_id uuid,command_type text,payload jsonb)
 returns jsonb language sql security invoker set search_path='' as $$
 select case
  when command_type='settings.journal_analysis.set'
   then private.journal_analysis_setting_command(request_id,command_type,payload)
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
