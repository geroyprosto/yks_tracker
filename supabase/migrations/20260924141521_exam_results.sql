-- Versioned starting formats. These are 2026-based editable templates, not a claim
-- that the 2027 YKS scope has been confirmed.
-- https://www.osym.gov.tr/2026-yks-sonuclari-aciklandi
-- TYT aggregate: Turkish 40, Social 20, Basic Mathematics 40, Science 20.
-- AYT numerical: Mathematics 40, Physics 14, Chemistry 13, Biology 13.
create table public.exam_format_versions (
 code text not null check (code in ('TYT','AYT_SAYISAL','BRANCH')),
 version integer not null check (version between 1 and 1000),
 label text not null check (length(label) between 1 and 120),
 total_questions integer not null check (total_questions between 0 and 1000),
 wrong_divisor numeric not null check (wrong_divisor > 0),
 sections jsonb not null check (jsonb_typeof(sections)='array'),
 primary key(code,version)
);
insert into public.exam_format_versions(code,version,label,total_questions,wrong_divisor,sections) values
('TYT',1,'TYT · başlangıç şablonu',120,4,
 '[
 {"key":"turkce","label":"Türkçe","question_count":40},
 {"key":"tarih","label":"Tarih","question_count":5},
 {"key":"cografya","label":"Coğrafya","question_count":5},
 {"key":"felsefe","label":"Felsefe","question_count":5},
 {"key":"din","label":"Din Kültürü","question_count":5},
 {"key":"matematik","label":"Temel Matematik","question_count":40},
 {"key":"fizik","label":"Fizik","question_count":7},
 {"key":"kimya","label":"Kimya","question_count":7},
 {"key":"biyoloji","label":"Biyoloji","question_count":6}
 ]'::jsonb),
('AYT_SAYISAL',1,'AYT Sayısal · başlangıç şablonu',80,4,
 '[
 {"key":"matematik","label":"Matematik","question_count":40},
 {"key":"fizik","label":"Fizik","question_count":14},
 {"key":"kimya","label":"Kimya","question_count":13},
 {"key":"biyoloji","label":"Biyoloji","question_count":13}
 ]'::jsonb),
('BRANCH',1,'Branş denemesi',0,4,'[]'::jsonb);
alter table public.exam_format_versions enable row level security;
create policy exam_formats_owner_read on public.exam_format_versions for select to authenticated
 using (exists (select 1 from public.owner_allowlist where user_id=(select auth.uid())));
revoke all on public.exam_format_versions from public,anon,authenticated;
grant select on public.exam_format_versions to authenticated;

create table public.exams (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (length(name) between 1 and 240 and name=btrim(name)),
 publisher text not null default '' check (length(publisher)<=240 and publisher=btrim(publisher)),
 exam_date date not null,
 format_code text not null check (format_code in ('TYT','AYT_SAYISAL','BRANCH')),
 format_version integer not null check (format_version between 1 and 1000),
 format_snapshot jsonb not null check (jsonb_typeof(format_snapshot)='object'),
 duration_minutes integer check (duration_minutes between 1 and 1440),
 notes text not null default '' check (length(notes)<=10000),
 score numeric check (score between 0 and 1000),
 rank integer check (rank between 1 and 100000000),
 reported_total_net numeric,
 total_net numeric,
 total_net_source text check (total_net_source in ('sections','reported')),
 -- Reserved for the private document import command. Ordinary exam commands cannot set these.
 source_document_id uuid,
 import_metadata jsonb check (import_metadata is null or jsonb_typeof(import_metadata)='object'),
 revision integer not null default 1 check (revision>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,user_id),
 foreign key(format_code,format_version) references public.exam_format_versions(code,version)
);
create index exams_user_date on public.exams(user_id,exam_date desc,created_at desc);
alter table public.exams enable row level security;
create policy exams_owner_read on public.exams for select to authenticated
 using (user_id=(select auth.uid()) and exists (
  select 1 from public.owner_allowlist where user_id=(select auth.uid())
 ));
revoke all on public.exams from public,anon,authenticated;
grant select on public.exams to authenticated;

create table public.exam_results (
 exam_id uuid not null,
 user_id uuid not null,
 section_key text not null check (length(section_key) between 1 and 80),
 correct integer check (correct>=0),
 wrong integer check (wrong>=0),
 blank integer check (blank>=0),
 net numeric not null,
 primary key(exam_id,section_key),
 foreign key(exam_id,user_id) references public.exams(id,user_id) on delete cascade,
 check ((correct is null and wrong is null and blank is null)
    or (correct is not null and wrong is not null and blank is not null))
);
create index exam_results_user on public.exam_results(user_id,exam_id);
alter table public.exam_results enable row level security;
create policy exam_results_owner_read on public.exam_results for select to authenticated
 using (user_id=(select auth.uid()) and exists (
  select 1 from public.owner_allowlist where user_id=(select auth.uid())
 ));
revoke all on public.exam_results from public,anon,authenticated;
grant select on public.exam_results to authenticated;

-- Count mode and net-only mode remain distinct. No guessed counts are persisted.
create function private.exam_normalize_results(input_results jsonb,format_snapshot jsonb)
 returns jsonb language plpgsql set search_path='' as $$
declare
 item jsonb;
 section_spec jsonb;
 section_key text;
 capacity integer;
 divisor numeric;
 right_count numeric;
 wrong_count numeric;
 empty_count numeric;
 net_value numeric;
 output_results jsonb := '[]'::jsonb;
 seen_keys text[] := array[]::text[];
begin
 if jsonb_typeof(input_results) is distinct from 'array'
    or jsonb_array_length(input_results) not between 0 and 50 then
  raise exception 'INVALID_INPUT';
 end if;
 divisor := (format_snapshot->>'wrong_divisor')::numeric;
 for item in select value from jsonb_array_elements(input_results) as data(value) loop
  if jsonb_typeof(item) is distinct from 'object'
     or jsonb_typeof(item->'section_key') is distinct from 'string'
     or length(item->>'section_key') not between 1 and 80 then
   raise exception 'INVALID_INPUT';
  end if;
  section_key := item->>'section_key';
  if section_key=any(seen_keys) then raise exception 'INVALID_INPUT'; end if;
  seen_keys := array_append(seen_keys,section_key);
  select value into section_spec from jsonb_array_elements(format_snapshot->'sections') as s(value)
   where value->>'key'=section_key;
  if section_spec is null then raise exception 'INVALID_INPUT'; end if;
  capacity := (section_spec->>'question_count')::integer;
  if item ?& array['correct','wrong','blank'] and not item ? 'net' then
   perform private.check_keys(item,array['section_key','correct','wrong','blank']);
   if jsonb_typeof(item->'correct') is distinct from 'number'
      or jsonb_typeof(item->'wrong') is distinct from 'number'
      or jsonb_typeof(item->'blank') is distinct from 'number' then
    raise exception 'INVALID_INPUT';
   end if;
   right_count := (item->>'correct')::numeric;
   wrong_count := (item->>'wrong')::numeric;
   empty_count := (item->>'blank')::numeric;
   if right_count<0 or wrong_count<0 or empty_count<0
      or right_count<>trunc(right_count) or wrong_count<>trunc(wrong_count)
      or empty_count<>trunc(empty_count)
      or right_count+wrong_count+empty_count>capacity then
    raise exception 'INVALID_INPUT';
   end if;
   net_value := right_count-wrong_count/divisor;
   output_results := output_results || jsonb_build_array(jsonb_build_object(
    'section_key',section_key,'correct',right_count::integer,
    'wrong',wrong_count::integer,'blank',empty_count::integer,'net',net_value));
  elsif item ? 'net' and not (item ?| array['correct','wrong','blank']) then
   perform private.check_keys(item,array['section_key','net']);
   if jsonb_typeof(item->'net') is distinct from 'number' then raise exception 'INVALID_INPUT'; end if;
   net_value := (item->>'net')::numeric;
   if net_value < -capacity/divisor or net_value>capacity then raise exception 'INVALID_INPUT'; end if;
   output_results := output_results || jsonb_build_array(jsonb_build_object(
    'section_key',section_key,'correct',null,'wrong',null,'blank',null,'net',net_value));
  else
   raise exception 'INVALID_INPUT';
  end if;
 end loop;
 return output_results;
end $$;
revoke all on function private.exam_normalize_results(jsonb,jsonb) from public,anon,authenticated;

create function private.exam_command(request_id uuid,command_type text,payload jsonb)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare
 owner_id uuid := private.require_owner();
 at_time timestamptz := date_trunc('second',clock_timestamp());
 receipt public.command_receipts;
 entry public.exams;
 format_row public.exam_format_versions;
 effective jsonb;
 snapshot jsonb;
 normalized jsonb;
 item jsonb;
 before_value jsonb;
 after_value jsonb;
 record_id uuid;
 result jsonb;
 sum_net numeric;
 computed_net numeric;
 reported_net numeric;
 result_count integer;
 net_source text;
begin
 if request_id is null or command_type not in ('exam.create','exam.update','exam.delete')
    or payload is null or jsonb_typeof(payload) is distinct from 'object'
    or pg_column_size(payload)>64000 then raise exception 'INVALID_INPUT'; end if;
 select * into receipt from public.command_receipts r
  where r.user_id=owner_id and r.request_id=exam_command.request_id;
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
 if command_type='exam.create' then
  perform private.check_keys(payload,array[
   'name','publisher','exam_date','format_code','format_version',
   'branch_subject','branch_question_count','duration_minutes','notes',
   'score','rank','reported_total_net','results'
  ]);
  if not payload ?& array['name','exam_date','format_code','results'] then
   raise exception 'INVALID_INPUT';
  end if;
  if jsonb_typeof(payload->'format_code') is distinct from 'string'
     or payload->>'format_code' not in ('TYT','AYT_SAYISAL','BRANCH') then
   raise exception 'INVALID_INPUT';
  end if;
  if payload ? 'format_version' and
     (jsonb_typeof(payload->'format_version') is distinct from 'number'
      or (payload->>'format_version')::numeric<1
      or (payload->>'format_version')::numeric<>trunc((payload->>'format_version')::numeric)) then
   raise exception 'INVALID_INPUT';
  end if;
  select * into format_row from public.exam_format_versions f
   where f.code=payload->>'format_code'
    and f.version=coalesce((payload->>'format_version')::integer,
      (select max(v.version) from public.exam_format_versions v where v.code=payload->>'format_code'));
  if not found then raise exception 'INVALID_INPUT'; end if;
  snapshot := to_jsonb(format_row);
  if format_row.code='BRANCH' then
   if not payload ?& array['branch_subject','branch_question_count']
      or jsonb_typeof(payload->'branch_subject') is distinct from 'string'
      or length(btrim(payload->>'branch_subject')) not between 1 and 120
      or jsonb_typeof(payload->'branch_question_count') is distinct from 'number'
      or (payload->>'branch_question_count')::numeric not between 1 and 1000
      or (payload->>'branch_question_count')::numeric<>trunc((payload->>'branch_question_count')::numeric) then
    raise exception 'INVALID_INPUT';
   end if;
   snapshot := snapshot || jsonb_build_object(
    'label',btrim(payload->>'branch_subject') || ' · branş denemesi',
    'total_questions',(payload->>'branch_question_count')::integer,
    'sections',jsonb_build_array(jsonb_build_object(
      'key','branch','label',btrim(payload->>'branch_subject'),
      'question_count',(payload->>'branch_question_count')::integer)));
  elsif payload ?| array['branch_subject','branch_question_count'] then
   raise exception 'INVALID_INPUT';
  end if;
  effective := jsonb_build_object(
   'publisher','','duration_minutes',null,'notes','','score',null,'rank',null,'reported_total_net',null
  ) || payload;
 else
  perform private.check_keys(payload,array[
   'id','expected_revision','name','publisher','exam_date','duration_minutes',
   'notes','score','rank','reported_total_net','results'
  ]);
  if not payload ?& array['id','expected_revision'] then raise exception 'INVALID_INPUT'; end if;
  if jsonb_typeof(payload->'id') is distinct from 'string'
     or jsonb_typeof(payload->'expected_revision') is distinct from 'number'
     or (payload->>'expected_revision')::numeric<>trunc((payload->>'expected_revision')::numeric)
     or (payload->>'expected_revision')::numeric<1 then raise exception 'INVALID_INPUT'; end if;
  select * into entry from public.exams e
   where e.user_id=owner_id and e.id=(payload->>'id')::uuid for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if entry.revision is distinct from (payload->>'expected_revision')::integer then
   raise exception 'CONFLICT';
  end if;
  record_id:=entry.id;
  before_value:=to_jsonb(entry)||jsonb_build_object('results',coalesce(
   (select jsonb_agg(to_jsonb(r)-'user_id'-'exam_id' order by r.section_key)
    from public.exam_results r where r.exam_id=entry.id),'[]'::jsonb));
  if command_type='exam.delete' then
   perform private.check_keys(payload,array['id','expected_revision']);
   delete from public.exams e where e.id=entry.id and e.user_id=owner_id;
   insert into public.audit_log(user_id,entity,entity_id,action,old_value,new_value)
   values(owner_id,'exam',record_id,command_type,before_value,null);
   result:=jsonb_build_object('id',record_id,'request_id',request_id,'replayed',false);
   insert into public.command_receipts(user_id,request_id,command_type,payload,result)
   values(owner_id,request_id,command_type,payload,result);
   return result;
  end if;
  snapshot:=entry.format_snapshot;
  effective:=jsonb_build_object(
   'name',entry.name,'publisher',entry.publisher,'exam_date',entry.exam_date,
   'duration_minutes',entry.duration_minutes,'notes',entry.notes,
   'score',entry.score,'rank',entry.rank,'reported_total_net',entry.reported_total_net
  ) || (payload-'id'-'expected_revision');
 end if;
 if jsonb_typeof(effective->'name') is distinct from 'string'
    or length(btrim(effective->>'name')) not between 1 and 240
    or jsonb_typeof(effective->'publisher') is distinct from 'string'
    or length(btrim(effective->>'publisher'))>240
    or jsonb_typeof(effective->'exam_date') is distinct from 'string'
    or effective->>'exam_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or jsonb_typeof(effective->'notes') is distinct from 'string'
    or length(effective->>'notes')>10000 then raise exception 'INVALID_INPUT'; end if;
 if jsonb_typeof(effective->'duration_minutes') not in ('null','number')
    or (jsonb_typeof(effective->'duration_minutes')='number'
      and ((effective->>'duration_minutes')::numeric not between 1 and 1440
       or (effective->>'duration_minutes')::numeric<>trunc((effective->>'duration_minutes')::numeric)))
    or jsonb_typeof(effective->'score') not in ('null','number')
    or (jsonb_typeof(effective->'score')='number'
      and (effective->>'score')::numeric not between 0 and 1000)
    or jsonb_typeof(effective->'reported_total_net') not in ('null','number')
    or jsonb_typeof(effective->'rank') not in ('null','number')
    or (jsonb_typeof(effective->'rank')='number'
      and ((effective->>'rank')::numeric not between 1 and 100000000
       or (effective->>'rank')::numeric<>trunc((effective->>'rank')::numeric))) then
  raise exception 'INVALID_INPUT';
 end if;
 reported_net:=(effective->>'reported_total_net')::numeric;
 if reported_net is not null and
    (reported_net < -(snapshot->>'total_questions')::numeric/(snapshot->>'wrong_divisor')::numeric
     or reported_net > (snapshot->>'total_questions')::numeric) then
  raise exception 'INVALID_INPUT';
 end if;
 if command_type='exam.create' or payload ? 'results' then
  normalized:=private.exam_normalize_results(effective->'results',snapshot);
  result_count:=jsonb_array_length(normalized);
  if result_count=jsonb_array_length(snapshot->'sections') then
   select sum((value->>'net')::numeric) into computed_net
   from jsonb_array_elements(normalized) as normalized_rows(value);
  end if;
 else
  select count(*)::integer,sum(r.net) into result_count,computed_net
   from public.exam_results r where r.exam_id=entry.id and r.user_id=owner_id;
  if result_count<>jsonb_array_length(snapshot->'sections') then computed_net:=null; end if;
 end if;
 if computed_net is not null and reported_net is not null
    and computed_net<>reported_net then raise exception 'INVALID_INPUT'; end if;
 if result_count=0 and reported_net is null then raise exception 'INVALID_INPUT'; end if;
 sum_net:=coalesce(computed_net,reported_net);
 net_source:=case when computed_net is not null then 'sections'
  when reported_net is not null then 'reported' else null end;
 if command_type='exam.create' then
  insert into public.exams(
   user_id,name,publisher,exam_date,format_code,format_version,format_snapshot,
   duration_minutes,notes,score,rank,reported_total_net,total_net,total_net_source
  ) values (
   owner_id,btrim(effective->>'name'),btrim(effective->>'publisher'),
   (effective->>'exam_date')::date,format_row.code,format_row.version,snapshot,
   (effective->>'duration_minutes')::integer,effective->>'notes',
   (effective->>'score')::numeric,(effective->>'rank')::integer,reported_net,sum_net,net_source
  ) returning * into entry;
  record_id:=entry.id;
 else
  update public.exams e set
   name=btrim(effective->>'name'),publisher=btrim(effective->>'publisher'),
   exam_date=(effective->>'exam_date')::date,
   duration_minutes=(effective->>'duration_minutes')::integer,
   notes=effective->>'notes',score=(effective->>'score')::numeric,
   rank=(effective->>'rank')::integer,
   reported_total_net=reported_net,total_net=sum_net,total_net_source=net_source,
   revision=e.revision+1,updated_at=at_time
   where e.id=entry.id and e.user_id=owner_id returning * into entry;
  if payload ? 'results' then
   delete from public.exam_results r where r.exam_id=record_id and r.user_id=owner_id;
  end if;
 end if;
 if normalized is not null then
  for item in select value from jsonb_array_elements(normalized) as results(value) loop
   insert into public.exam_results(exam_id,user_id,section_key,correct,wrong,blank,net)
   values(entry.id,owner_id,item->>'section_key',(item->>'correct')::integer,
    (item->>'wrong')::integer,(item->>'blank')::integer,(item->>'net')::numeric);
  end loop;
 end if;
 after_value:=to_jsonb(entry)||jsonb_build_object('results',coalesce(
  (select jsonb_agg(to_jsonb(r)-'user_id'-'exam_id' order by r.section_key)
   from public.exam_results r where r.exam_id=entry.id),'[]'::jsonb));
 insert into public.audit_log(user_id,entity,entity_id,action,old_value,new_value)
 values(owner_id,'exam',record_id,command_type,before_value,after_value);
 result:=jsonb_build_object('id',record_id,'request_id',request_id,'replayed',false);
 insert into public.command_receipts(user_id,request_id,command_type,payload,result)
 values(owner_id,request_id,command_type,payload,result);
 return result;
end $$;
revoke all on function private.exam_command(uuid,text,jsonb) from public,anon;
grant execute on function private.exam_command(uuid,text,jsonb) to authenticated;

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
    from public.exams e where e.user_id=(select auth.uid())),'[]'::jsonb)
 ) from base
$$;

create or replace function public.yks_command(request_id uuid,command_type text,payload jsonb)
 returns jsonb language sql security invoker set search_path='' as $$
 select case
  when command_type in ('exam.create','exam.update','exam.delete')
   then private.exam_command(request_id,command_type,payload)
  when command_type in ('practice.create','practice.update','practice.delete')
   then private.practice_command(request_id,command_type,payload)
  else private.command(request_id,command_type,payload)
 end
$$;
revoke all on function public.yks_state(),public.yks_command(uuid,text,jsonb) from public,anon;
grant execute on function public.yks_state(),public.yks_command(uuid,text,jsonb) to authenticated;
