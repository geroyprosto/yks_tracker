-- A daily diary keeps the exact user-authored text separate from interpreted fields.
create function private.valid_journal_fields(input_fields jsonb) returns boolean
 language plpgsql immutable set search_path='' as $$
declare
 field record;
 element jsonb;
begin
 if jsonb_typeof(input_fields) is distinct from 'object' then return false; end if;
 for field in select key, value as item from jsonb_each(input_fields) loop
  if field.key in ('sleep_at','wake_at') then
   if jsonb_typeof(field.item) is distinct from 'string'
      or field.item #>> '{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
  elsif field.key in ('sleep_quality','energy','stress') then
   if jsonb_typeof(field.item) is distinct from 'number'
      or (field.item #>> '{}')::numeric not between 1 and 5
      or (field.item #>> '{}')::numeric<>trunc((field.item #>> '{}')::numeric) then return false; end if;
  elsif field.key='interruptions' then
   if jsonb_typeof(field.item) is distinct from 'number'
      or (field.item #>> '{}')::numeric not between 0 and 100
      or (field.item #>> '{}')::numeric<>trunc((field.item #>> '{}')::numeric) then return false; end if;
  elsif field.key in ('mood','environment','food_drink','thoughts') then
   if jsonb_typeof(field.item) is distinct from 'string'
      or (field.key='mood' and length(field.item #>> '{}')>120)
      or (field.key='environment' and length(field.item #>> '{}')>500)
      or (field.key='food_drink' and length(field.item #>> '{}')>2000)
      or (field.key='thoughts' and length(field.item #>> '{}')>5000) then
    return false;
   end if;
  elsif field.key in ('activities','people_tags') then
   if jsonb_typeof(field.item) is distinct from 'array'
      or jsonb_array_length(field.item)>30 then return false; end if;
   for element in select * from jsonb_array_elements(field.item) loop
    if jsonb_typeof(element) is distinct from 'string'
       or length(element #>> '{}') not between 1 and 120 then return false; end if;
   end loop;
  else
   return false;
  end if;
 end loop;
 return true;
end $$;
revoke all on function private.valid_journal_fields(jsonb) from public,anon,authenticated;

create function private.valid_journal_share(shared text[],fields jsonb) returns boolean
 language plpgsql immutable set search_path='' as $$
declare field text; seen text[] := array[]::text[];
begin
 if shared is null or cardinality(shared)>13 then return false; end if;
 for field in select unnest(shared) loop
  if field is null or field=any(seen) or field not in (
   'original_text','sleep_at','wake_at','sleep_quality','mood','energy','stress',
   'environment','interruptions','activities','people_tags','food_drink','thoughts'
  ) or (field<>'original_text' and not fields ? field) then return false; end if;
  seen:=array_append(seen,field);
 end loop;
 return true;
end $$;
revoke all on function private.valid_journal_share(text[],jsonb) from public,anon,authenticated;

create table public.journal_entries (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 journal_date date not null,
 original_text text not null check (length(original_text)<=20000),
 structured_fields jsonb not null default '{}'::jsonb check (private.valid_journal_fields(structured_fields)),
 exclude_from_analysis boolean not null default false,
 ai_shared_fields text[] not null default array[]::text[],
 revision integer not null default 1 check (revision>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,journal_date),
 check (length(btrim(original_text))>0 or structured_fields<>'{}'::jsonb),
 check (private.valid_journal_share(ai_shared_fields,structured_fields))
);
create index journal_entries_user_date on public.journal_entries(user_id,journal_date desc);
alter table public.journal_entries enable row level security;
create policy journal_entries_owner_read on public.journal_entries for select to authenticated
 using (user_id=(select auth.uid()) and exists (
  select 1 from public.owner_allowlist where user_id=(select auth.uid())
 ));
revoke all on public.journal_entries from public,anon,authenticated;
grant select on public.journal_entries to authenticated;

create table public.day_marks (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 mark_date date not null,
 kind text not null check (kind in ('rest','zero')),
 revision integer not null default 1 check (revision>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,mark_date)
);
create index day_marks_user_date on public.day_marks(user_id,mark_date desc);
alter table public.day_marks enable row level security;
create policy day_marks_owner_read on public.day_marks for select to authenticated
 using (user_id=(select auth.uid()) and exists (
  select 1 from public.owner_allowlist where user_id=(select auth.uid())
 ));
revoke all on public.day_marks from public,anon,authenticated;
grant select on public.day_marks to authenticated;

create function private.journal_command(request_id uuid,command_type text,payload jsonb)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare
 owner_id uuid := private.require_owner();
 at_time timestamptz := date_trunc('second',clock_timestamp());
 receipt public.command_receipts;
 entry public.journal_entries;
 effective jsonb;
 share_values text[];
 before_value jsonb;
 after_value jsonb;
 record_id uuid;
 result jsonb;
begin
 if request_id is null or command_type not in ('journal.create','journal.update','journal.delete')
    or payload is null or jsonb_typeof(payload) is distinct from 'object'
    or pg_column_size(payload)>64000 then raise exception 'INVALID_INPUT'; end if;
 select * into receipt from public.command_receipts r
  where r.user_id=owner_id and r.request_id=journal_command.request_id;
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
 if command_type='journal.create' then
  perform private.check_keys(payload,array[
   'journal_date','original_text','structured_fields','exclude_from_analysis','ai_shared_fields'
  ]);
  if not payload ?& array['journal_date','original_text'] then raise exception 'INVALID_INPUT'; end if;
  effective:=jsonb_build_object(
   'structured_fields','{}'::jsonb,'exclude_from_analysis',false,
   'ai_shared_fields','[]'::jsonb) || payload;
 else
  perform private.check_keys(payload,array[
   'id','expected_revision','journal_date','original_text','structured_fields',
   'exclude_from_analysis','ai_shared_fields'
  ]);
  if not payload ?& array['id','expected_revision'] then raise exception 'INVALID_INPUT'; end if;
  if jsonb_typeof(payload->'id') is distinct from 'string'
     or jsonb_typeof(payload->'expected_revision') is distinct from 'number'
     or (payload->>'expected_revision')::numeric<1
     or (payload->>'expected_revision')::numeric<>trunc((payload->>'expected_revision')::numeric) then
   raise exception 'INVALID_INPUT';
  end if;
  select * into entry from public.journal_entries j
   where j.user_id=owner_id and j.id=(payload->>'id')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if entry.revision is distinct from (payload->>'expected_revision')::integer then
   raise exception 'CONFLICT';
  end if;
  record_id:=entry.id;
  before_value:=to_jsonb(entry);
  if command_type='journal.delete' then
   perform private.check_keys(payload,array['id','expected_revision']);
   delete from public.journal_entries j where j.id=entry.id and j.user_id=owner_id;
   insert into public.audit_log(user_id,entity,entity_id,action,old_value,new_value)
   values(owner_id,'journal',record_id,command_type,before_value,null);
   result:=jsonb_build_object('id',record_id,'request_id',request_id,'replayed',false);
   insert into public.command_receipts(user_id,request_id,command_type,payload,result)
   values(owner_id,request_id,command_type,payload,result);
   return result;
  end if;
  effective:=jsonb_build_object(
   'journal_date',entry.journal_date,'original_text',entry.original_text,
   'structured_fields',entry.structured_fields,
   'exclude_from_analysis',entry.exclude_from_analysis,
   'ai_shared_fields',entry.ai_shared_fields
  ) || (payload-'id'-'expected_revision');
 end if;
 if jsonb_typeof(effective->'journal_date') is distinct from 'string'
    or effective->>'journal_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(effective->'original_text') is distinct from 'string'
    or length(effective->>'original_text')>20000
    or not private.valid_journal_fields(effective->'structured_fields')
    or (length(btrim(effective->>'original_text'))=0
        and effective->'structured_fields'='{}'::jsonb)
    or jsonb_typeof(effective->'exclude_from_analysis') is distinct from 'boolean'
    or jsonb_typeof(effective->'ai_shared_fields') is distinct from 'array' then
  raise exception 'INVALID_INPUT';
 end if;
 if exists (select 1 from jsonb_array_elements(effective->'ai_shared_fields') as fields(value)
            where jsonb_typeof(value) is distinct from 'string') then raise exception 'INVALID_INPUT'; end if;
 select coalesce(array_agg(value),array[]::text[]) into share_values
  from jsonb_array_elements_text(effective->'ai_shared_fields') as fields(value);
 if not private.valid_journal_share(share_values,effective->'structured_fields') then
  raise exception 'INVALID_INPUT';
 end if;
 if command_type='journal.create' then
  if exists (select 1 from public.journal_entries j
             where j.user_id=owner_id and j.journal_date=(effective->>'journal_date')::date) then
   raise exception 'JOURNAL_EXISTS';
  end if;
  insert into public.journal_entries(
   user_id,journal_date,original_text,structured_fields,exclude_from_analysis,ai_shared_fields
  ) values (
   owner_id,(effective->>'journal_date')::date,effective->>'original_text',
   effective->'structured_fields',(effective->>'exclude_from_analysis')::boolean,share_values
  ) returning * into entry;
  record_id:=entry.id;
 else
  update public.journal_entries j set
   journal_date=(effective->>'journal_date')::date,
   original_text=effective->>'original_text',
   structured_fields=effective->'structured_fields',
   exclude_from_analysis=(effective->>'exclude_from_analysis')::boolean,
   ai_shared_fields=share_values,revision=j.revision+1,updated_at=at_time
   where j.id=entry.id and j.user_id=owner_id returning * into entry;
 end if;
 after_value:=to_jsonb(entry);
 insert into public.audit_log(user_id,entity,entity_id,action,old_value,new_value)
 values(owner_id,'journal',record_id,command_type,before_value,after_value);
 result:=jsonb_build_object('id',record_id,'request_id',request_id,'replayed',false);
 insert into public.command_receipts(user_id,request_id,command_type,payload,result)
 values(owner_id,request_id,command_type,payload,result);
 return result;
end $$;
revoke all on function private.journal_command(uuid,text,jsonb) from public,anon;
grant execute on function private.journal_command(uuid,text,jsonb) to authenticated;

create function private.day_mark_command(request_id uuid,command_type text,payload jsonb)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare
 owner_id uuid := private.require_owner();
 at_time timestamptz := date_trunc('second',clock_timestamp());
 receipt public.command_receipts;
 mark public.day_marks;
 before_value jsonb;
 after_value jsonb;
 record_id uuid;
 result jsonb;
begin
 if request_id is null or command_type not in ('day.mark','day.unmark')
    or payload is null or jsonb_typeof(payload) is distinct from 'object'
    or pg_column_size(payload)>64000 then raise exception 'INVALID_INPUT'; end if;
 select * into receipt from public.command_receipts r
  where r.user_id=owner_id and r.request_id=day_mark_command.request_id;
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
 if command_type='day.mark' then
  perform private.check_keys(payload,array['mark_date','kind']);
  if not payload ?& array['mark_date','kind']
     or jsonb_typeof(payload->'mark_date') is distinct from 'string'
     or payload->>'mark_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or jsonb_typeof(payload->'kind') is distinct from 'string'
     or payload->>'kind' not in ('rest','zero') then raise exception 'INVALID_INPUT'; end if;
  select * into mark from public.day_marks d
   where d.user_id=owner_id and d.mark_date=(payload->>'mark_date')::date for update;
  if found then
   record_id:=mark.id;before_value:=to_jsonb(mark);
   if mark.kind<>payload->>'kind' then
    update public.day_marks d set kind=payload->>'kind',revision=d.revision+1,updated_at=at_time
     where d.id=mark.id and d.user_id=owner_id returning * into mark;
   end if;
  else
   insert into public.day_marks(user_id,mark_date,kind)
    values(owner_id,(payload->>'mark_date')::date,payload->>'kind') returning * into mark;
   record_id:=mark.id;
  end if;
  after_value:=to_jsonb(mark);
 else
  perform private.check_keys(payload,array['id','expected_revision']);
  if not payload ?& array['id','expected_revision']
     or jsonb_typeof(payload->'id') is distinct from 'string'
     or jsonb_typeof(payload->'expected_revision') is distinct from 'number'
     or (payload->>'expected_revision')::numeric<1
     or (payload->>'expected_revision')::numeric<>trunc((payload->>'expected_revision')::numeric) then
   raise exception 'INVALID_INPUT'; end if;
  select * into mark from public.day_marks d
   where d.user_id=owner_id and d.id=(payload->>'id')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if mark.revision is distinct from (payload->>'expected_revision')::integer then
   raise exception 'CONFLICT'; end if;
  record_id:=mark.id;before_value:=to_jsonb(mark);
  delete from public.day_marks d where d.id=mark.id and d.user_id=owner_id;
 end if;
 insert into public.audit_log(user_id,entity,entity_id,action,old_value,new_value)
 values(owner_id,'day_mark',record_id,command_type,before_value,after_value);
 result:=jsonb_build_object('id',record_id,'request_id',request_id,'replayed',false);
 insert into public.command_receipts(user_id,request_id,command_type,payload,result)
 values(owner_id,request_id,command_type,payload,result);
 return result;
end $$;
revoke all on function private.day_mark_command(uuid,text,jsonb) from public,anon;
grant execute on function private.day_mark_command(uuid,text,jsonb) to authenticated;

create or replace function public.yks_state() returns jsonb
 language sql security invoker set search_path='' as $$
 with base as materialized (select private.state() as value)
 select base.value || jsonb_build_object(
  'practice_entries',coalesce(
   (select jsonb_agg(to_jsonb(p)-'user_id' order by p.practice_date desc,p.created_at desc,p.id)
    from public.practice_entries p where p.user_id=(select auth.uid())),'[]'::jsonb),
  'exam_formats',coalesce(
   (select jsonb_agg(to_jsonb(f) order by f.code,f.version desc)
    from public.exam_format_versions f),'[]'::jsonb),
  'exams',coalesce(
   (select jsonb_agg(
      (to_jsonb(e)-'user_id') || jsonb_build_object('results',coalesce(
       (select jsonb_agg(to_jsonb(r)-'exam_id'-'user_id' order by r.section_key)
        from public.exam_results r where r.exam_id=e.id),'[]'::jsonb))
       order by e.exam_date desc,e.created_at desc,e.id)
    from public.exams e where e.user_id=(select auth.uid())),'[]'::jsonb),
  'journal_entries',coalesce(
   (select jsonb_agg(to_jsonb(j)-'user_id' order by j.journal_date desc,j.created_at desc)
    from public.journal_entries j where j.user_id=(select auth.uid())),'[]'::jsonb),
  'day_marks',coalesce(
   (select jsonb_agg(to_jsonb(d)-'user_id' order by d.mark_date desc)
    from public.day_marks d where d.user_id=(select auth.uid())),'[]'::jsonb)
 ) from base
$$;

create or replace function public.yks_command(request_id uuid,command_type text,payload jsonb)
 returns jsonb language sql security invoker set search_path='' as $$
 select case
  when command_type in ('exam.create','exam.update','exam.delete')
   then private.exam_command(request_id,command_type,payload)
  when command_type in ('journal.create','journal.update','journal.delete')
   then private.journal_command(request_id,command_type,payload)
  when command_type in ('day.mark','day.unmark')
   then private.day_mark_command(request_id,command_type,payload)
  when command_type in ('practice.create','practice.update','practice.delete')
   then private.practice_command(request_id,command_type,payload)
  else private.command(request_id,command_type,payload)
 end
$$;
revoke all on function public.yks_state(),public.yks_command(uuid,text,jsonb) from public,anon;
grant execute on function public.yks_state(),public.yks_command(uuid,text,jsonb) to authenticated;
