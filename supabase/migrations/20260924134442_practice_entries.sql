-- Daily solved questions and tests, grouped by the user's local calendar date.
create table public.practice_entries (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 practice_date date not null,
 exam text not null check (exam in ('TYT','AYT')),
 subject text not null check (length(subject) between 1 and 120 and subject = btrim(subject)),
 question_count integer not null check (question_count between 0 and 100000),
 test_count integer not null check (test_count between 0 and 10000),
 revision integer not null default 1 check (revision > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (question_count > 0 or test_count > 0)
);
create index practice_entries_user_date on public.practice_entries(user_id,practice_date desc,exam,subject);
alter table public.practice_entries enable row level security;
create policy practice_entries_owner_read on public.practice_entries
 for select to authenticated
 using (user_id = (select auth.uid()) and exists (
  select 1 from public.owner_allowlist where user_id = (select auth.uid())
 ));
-- Writes are only allowed through private.practice_command after require_owner().
revoke all on public.practice_entries from public,anon,authenticated;
grant select on public.practice_entries to authenticated;

create function private.practice_command(request_id uuid, command_type text, payload jsonb)
 returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 owner_id uuid := private.require_owner();
 at_time timestamptz := date_trunc('second',clock_timestamp());
 receipt public.command_receipts;
 entry public.practice_entries;
 next_entry public.practice_entries;
 before_value jsonb;
 after_value jsonb;
 record_id uuid;
 result jsonb;
begin
 if request_id is null or command_type not in ('practice.create','practice.update','practice.delete')
    or payload is null or pg_column_size(payload)>64000 then
  raise exception 'INVALID_INPUT';
 end if;
 select * into receipt from public.command_receipts r
  where r.user_id=owner_id and r.request_id=practice_command.request_id;
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

 if command_type='practice.create' then
  perform private.check_keys(payload,array['practice_date','exam','subject','question_count','test_count']);
  if not payload ?& array['practice_date','exam','subject','question_count','test_count'] then
   raise exception 'INVALID_INPUT';
  end if;
 else
  perform private.check_keys(payload,array['id','expected_revision','practice_date','exam','subject','question_count','test_count']);
  if not payload ?& array['id','expected_revision'] then raise exception 'INVALID_INPUT'; end if;
 end if;
 if payload ? 'practice_date' and jsonb_typeof(payload->'practice_date') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
 if payload ? 'exam' and (jsonb_typeof(payload->'exam') is distinct from 'string' or payload->>'exam' not in ('TYT','AYT')) then raise exception 'INVALID_INPUT'; end if;
 if payload ? 'subject' and (jsonb_typeof(payload->'subject') is distinct from 'string' or length(btrim(payload->>'subject')) not between 1 and 120) then raise exception 'INVALID_INPUT'; end if;
 if payload ? 'question_count' and
    (jsonb_typeof(payload->'question_count') is distinct from 'number'
     or (payload->>'question_count')::numeric not between 0 and 100000
     or (payload->>'question_count')::numeric <> trunc((payload->>'question_count')::numeric)) then
  raise exception 'INVALID_INPUT';
 end if;
 if payload ? 'test_count' and
    (jsonb_typeof(payload->'test_count') is distinct from 'number'
     or (payload->>'test_count')::numeric not between 0 and 10000
     or (payload->>'test_count')::numeric <> trunc((payload->>'test_count')::numeric)) then
  raise exception 'INVALID_INPUT';
 end if;

 if command_type='practice.create' then
  insert into public.practice_entries(user_id,practice_date,exam,subject,question_count,test_count)
  values(owner_id,(payload->>'practice_date')::date,payload->>'exam',payload->>'subject',
         (payload->>'question_count')::integer,(payload->>'test_count')::integer)
  returning * into entry;
  record_id:=entry.id;
  after_value:=to_jsonb(entry);
 else
  select * into entry from public.practice_entries p
   where p.user_id=owner_id and p.id=(payload->>'id')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if entry.revision is distinct from (payload->>'expected_revision')::integer then raise exception 'CONFLICT'; end if;
  record_id:=entry.id;
  before_value:=to_jsonb(entry);
  if command_type='practice.delete' then
   -- Delete only accepts identity and revision; reject hidden update fields.
   perform private.check_keys(payload,array['id','expected_revision']);
   delete from public.practice_entries p where p.id=entry.id and p.user_id=owner_id;
  else
   select * into next_entry from jsonb_populate_record(entry,payload-'id'-'expected_revision');
   update public.practice_entries p set
    practice_date=next_entry.practice_date,exam=next_entry.exam,subject=next_entry.subject,
    question_count=next_entry.question_count,test_count=next_entry.test_count,
    revision=p.revision+1,updated_at=at_time
    where p.id=entry.id and p.user_id=owner_id
    returning to_jsonb(p) into after_value;
  end if;
 end if;

 insert into public.audit_log(user_id,entity,entity_id,action,old_value,new_value)
 values(owner_id,'practice',record_id,command_type,before_value,after_value);
 result:=jsonb_build_object('id',record_id,'request_id',request_id,'replayed',false);
 insert into public.command_receipts(user_id,request_id,command_type,payload,result)
 values(owner_id,request_id,command_type,payload,result);
 return result;
end $$;
revoke all on function private.practice_command(uuid,text,jsonb) from public,anon;
grant execute on function private.practice_command(uuid,text,jsonb) to authenticated;

-- Keep the existing RPC contract; append the new list without changing prior fields.
create or replace function public.yks_state() returns jsonb
 language sql security invoker set search_path = '' as $$
 with base as materialized (select private.state() as value)
 select base.value || jsonb_build_object(
  'practice_entries',
  coalesce(
   (select jsonb_agg(to_jsonb(p)-'user_id' order by p.practice_date desc,p.created_at desc,p.id)
    from public.practice_entries p where p.user_id=(select auth.uid())),
   '[]'::jsonb
  )
 )
 from base
$$;

create or replace function public.yks_command(request_id uuid,command_type text,payload jsonb)
 returns jsonb language sql security invoker set search_path = '' as $$
 select case when command_type in ('practice.create','practice.update','practice.delete')
  then private.practice_command(request_id,command_type,payload)
  else private.command(request_id,command_type,payload)
 end
$$;
revoke all on function public.yks_state(),public.yks_command(uuid,text,jsonb) from public,anon;
grant execute on function public.yks_state(),public.yks_command(uuid,text,jsonb) to authenticated;

