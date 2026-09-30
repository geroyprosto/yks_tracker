-- Preserve legacy YKS labels while allowing an explicit course identity or no course.
alter table public.practice_entries
 add column course_id uuid,
 alter column exam drop not null,
 alter column subject drop not null,
 add constraint practice_entries_course_owner_fkey foreign key(course_id,user_id)
  references public.education_courses(id,user_id),
 add constraint practice_entries_course_identity_check check (
  (course_id is null and ((exam is null and subject is null) or (exam is not null and subject is not null)))
  or (course_id is not null and subject is not null)
 );
create index practice_entries_course_date on public.practice_entries(user_id,course_id,practice_date desc)
 where course_id is not null;

create or replace function private.practice_command(request_id uuid, command_type text, payload jsonb)
 returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 owner_id uuid := private.require_owner();
 at_time timestamptz := date_trunc('second',clock_timestamp());
 receipt public.command_receipts;
 entry public.practice_entries;
 next_entry public.practice_entries;
 linked_course public.education_courses;
 next_course_id uuid;
 next_exam text;
 next_subject text;
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
  perform private.check_keys(payload,array['practice_date','course_id','exam','subject','question_count','test_count']);
  if not payload ?& array['practice_date','question_count','test_count'] then
   raise exception 'INVALID_INPUT';
  end if;
 else
  perform private.check_keys(payload,array['id','expected_revision','practice_date','course_id','exam','subject','question_count','test_count']);
  if not payload ?& array['id','expected_revision'] then raise exception 'INVALID_INPUT'; end if;
 end if;
 if payload ? 'practice_date' and jsonb_typeof(payload->'practice_date') is distinct from 'string' then raise exception 'INVALID_INPUT'; end if;
 if payload ? 'course_id' and jsonb_typeof(payload->'course_id') not in ('string','null') then raise exception 'INVALID_INPUT'; end if;
 if payload ? 'exam' and jsonb_typeof(payload->'exam') <> 'null'
    and (jsonb_typeof(payload->'exam') is distinct from 'string' or payload->>'exam' not in ('TYT','AYT')) then
  raise exception 'INVALID_INPUT';
 end if;
 if payload ? 'subject' and jsonb_typeof(payload->'subject') <> 'null'
    and (jsonb_typeof(payload->'subject') is distinct from 'string' or length(btrim(payload->>'subject')) not between 1 and 120) then
  raise exception 'INVALID_INPUT';
 end if;
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
  if payload->>'course_id' is not null then
   select * into linked_course from public.education_courses c
    where c.id=(payload->>'course_id')::uuid and c.user_id=owner_id;
   if not found or linked_course.archived or (linked_course.term_id is not null and not exists (
      select 1 from public.education_terms t where t.id=linked_course.term_id and t.user_id=owner_id and not t.archived
   )) then raise exception 'INVALID_INPUT'; end if;
   next_course_id:=linked_course.id;
   next_exam:=linked_course.exam;
   next_subject:=btrim(linked_course.name);
  elsif payload ? 'course_id' then
   if payload->>'exam' is not null or payload->>'subject' is not null then raise exception 'INVALID_INPUT'; end if;
  else
   if (payload->>'exam' is null) <> (payload->>'subject' is null) then raise exception 'INVALID_INPUT'; end if;
   next_exam:=payload->>'exam';
   next_subject:=btrim(payload->>'subject');
  end if;
  insert into public.practice_entries(user_id,practice_date,course_id,exam,subject,question_count,test_count)
  values(owner_id,(payload->>'practice_date')::date,next_course_id,next_exam,next_subject,
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
   perform private.check_keys(payload,array['id','expected_revision']);
   delete from public.practice_entries p where p.id=entry.id and p.user_id=owner_id;
  else
   select * into next_entry from jsonb_populate_record(entry,payload-'id'-'expected_revision');
   if payload ? 'course_id' then
    if payload->>'course_id' is null then
     if payload->>'exam' is not null or payload->>'subject' is not null then raise exception 'INVALID_INPUT'; end if;
     next_entry.course_id:=null;
     next_entry.exam:=null;
     next_entry.subject:=null;
    else
     select * into linked_course from public.education_courses c
      where c.id=(payload->>'course_id')::uuid and c.user_id=owner_id;
     if not found then raise exception 'INVALID_INPUT'; end if;
     if linked_course.id is distinct from entry.course_id and
        (linked_course.archived or (linked_course.term_id is not null and not exists (
          select 1 from public.education_terms t where t.id=linked_course.term_id and t.user_id=owner_id and not t.archived
        ))) then raise exception 'INVALID_INPUT'; end if;
     next_entry.course_id:=linked_course.id;
     next_entry.exam:=linked_course.exam;
     next_entry.subject:=btrim(linked_course.name);
    end if;
   elsif entry.course_id is not null then
    -- Count/date-only edits to linked records preserve their trusted labels.
    next_entry.exam:=entry.exam;
    next_entry.subject:=entry.subject;
   else
    if (next_entry.exam is null) <> (next_entry.subject is null) then raise exception 'INVALID_INPUT'; end if;
    next_entry.subject:=btrim(next_entry.subject);
   end if;
   if next_entry.question_count=0 and next_entry.test_count=0 then raise exception 'INVALID_INPUT'; end if;
   update public.practice_entries p set
    practice_date=next_entry.practice_date,course_id=next_entry.course_id,
    exam=next_entry.exam,subject=next_entry.subject,
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
