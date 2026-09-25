-- PDF source documents are private. The browser can read only its own metadata;
-- storage object reads/writes are restricted to the authenticated owner's path.
create table public.exam_documents (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 original_filename text not null check (length(original_filename) between 1 and 255),
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 storage_path text not null,
 byte_size integer not null check (byte_size between 16 and 10485760),
 page_count integer not null check (page_count between 1 and 10),
 extraction_status text not null check (extraction_status in ('ready','needs_visual_review')),
 visual_extraction_status text not null default 'not_needed' check (visual_extraction_status in ('not_needed','skipped_by_user','provider_not_configured','succeeded','failed')),
 candidates jsonb not null check (jsonb_typeof(candidates)='array' and jsonb_array_length(candidates) between 1 and 50),
 created_at timestamptz not null default now(),
 unique(id,user_id),unique(user_id,sha256),unique(user_id,storage_path),
 check (storage_path=user_id::text||'/'||sha256||'.pdf')
);
create index exam_documents_user_recent on public.exam_documents(user_id,created_at desc);
alter table public.exam_documents enable row level security;
create policy exam_documents_owner_read on public.exam_documents for select to authenticated
 using (user_id=(select auth.uid()) and exists (
  select 1 from public.owner_allowlist where user_id=(select auth.uid())
 ));
revoke all on public.exam_documents from public,anon,authenticated;
grant select on public.exam_documents to authenticated;

alter table public.exams add constraint exams_source_document_owner_fk
 foreign key(source_document_id,user_id) references public.exam_documents(id,user_id);

create table public.exam_imports (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 document_id uuid not null,
 candidate_index integer not null check (candidate_index between 0 and 49),
 exam_id uuid not null,
 result_fingerprint text not null check (result_fingerprint ~ '^[0-9a-f]{32}$'),
 corrections jsonb not null check (jsonb_typeof(corrections)='object'),
 committed_at timestamptz not null default now(),
 unique(user_id,document_id,candidate_index),
 unique(user_id,exam_id),
 foreign key(document_id,user_id) references public.exam_documents(id,user_id),
 foreign key(exam_id,user_id) references public.exams(id,user_id) on delete cascade
);
create index exam_imports_user_fingerprint on public.exam_imports(user_id,result_fingerprint);
alter table public.exam_imports enable row level security;
create policy exam_imports_owner_read on public.exam_imports for select to authenticated
 using (user_id=(select auth.uid()) and exists (
  select 1 from public.owner_allowlist where user_id=(select auth.uid())
 ));
revoke all on public.exam_imports from public,anon,authenticated;
grant select on public.exam_imports to authenticated;

-- Supabase Storage exists on hosted projects. Embedded Postgres tests without
-- Storage can still validate the metadata and commit transaction independently.
do $$
begin
 if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('exam-documents','exam-documents',false,10485760,array['application/pdf']::text[])
   on conflict(id) do update set public=false,file_size_limit=10485760,
      allowed_mime_types=array['application/pdf']::text[];
  execute 'create policy exam_documents_storage_insert on storage.objects for insert to authenticated
    with check (bucket_id=''exam-documents'' and
      split_part(name,''/'',1)=(select auth.uid())::text and
      name ~ ''^[0-9a-f-]{36}/[0-9a-f]{64}\.pdf$'' and
      exists(select 1 from public.owner_allowlist where user_id=(select auth.uid())))';
  execute 'create policy exam_documents_storage_read on storage.objects for select to authenticated
    using (bucket_id=''exam-documents'' and
      split_part(name,''/'',1)=(select auth.uid())::text and
      name ~ ''^[0-9a-f-]{36}/[0-9a-f]{64}\.pdf$'' and
      exists(select 1 from public.owner_allowlist where user_id=(select auth.uid())))';
  execute 'create policy exam_documents_storage_delete on storage.objects for delete to authenticated
    using (bucket_id=''exam-documents'' and
      split_part(name,''/'',1)=(select auth.uid())::text and
      name ~ ''^[0-9a-f-]{36}/[0-9a-f]{64}\.pdf$'' and
      exists(select 1 from public.owner_allowlist where user_id=(select auth.uid())))';
 end if;
end $$;

create function private.exam_import_register(
 digest_sha256 text,original_filename text,byte_size integer,page_count integer,
 extraction_status text,candidates jsonb,
 visual_extraction_status text default 'not_needed'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 owner_id uuid := private.require_owner();
 existing public.exam_documents;
 record_id uuid;
begin
 if digest_sha256 is null or digest_sha256 !~ '^[0-9a-f]{64}$'
    or original_filename is null or length(original_filename) not between 1 and 255
    or byte_size not between 16 and 10485760 or page_count not between 1 and 10
    or extraction_status not in ('ready','needs_visual_review')
    or visual_extraction_status not in ('not_needed','skipped_by_user','provider_not_configured','succeeded','failed')
    or jsonb_typeof(candidates) is distinct from 'array'
    or jsonb_array_length(candidates) not between 1 and 50
    or pg_column_size(candidates)>250000 then raise exception 'INVALID_INPUT'; end if;
 perform private.initialize_owner(owner_id);
 select * into existing from public.exam_documents d
  where d.user_id=owner_id and d.sha256=digest_sha256;
 if found then return jsonb_build_object('id',existing.id,'duplicate_upload',true); end if;
 insert into public.exam_documents(user_id,original_filename,sha256,storage_path,
   byte_size,page_count,extraction_status,candidates,visual_extraction_status)
 values(owner_id,original_filename,digest_sha256,owner_id::text||'/'||digest_sha256||'.pdf',
   byte_size,page_count,extraction_status,candidates,visual_extraction_status)
 on conflict(user_id,sha256) do nothing returning id into record_id;
 if record_id is null then
  select id into record_id from public.exam_documents d
   where d.user_id=owner_id and d.sha256=digest_sha256;
  return jsonb_build_object('id',record_id,'duplicate_upload',true);
 end if;
 insert into public.audit_log(user_id,entity,entity_id,action,new_value,source)
 values(owner_id,'exam_document',record_id,'exam_import.upload',
   jsonb_build_object('sha256',digest_sha256,'page_count',page_count),'pdf_import');
 return jsonb_build_object('id',record_id,'duplicate_upload',false);
end $$;
revoke all on function private.exam_import_register(text,text,integer,integer,text,jsonb,text) from public,anon;
grant execute on function private.exam_import_register(text,text,integer,integer,text,jsonb,text) to authenticated;
create function public.exam_import_register(
 digest_sha256 text,original_filename text,byte_size integer,page_count integer,
 extraction_status text,candidates jsonb,
 visual_extraction_status text default 'not_needed'
) returns jsonb language sql security invoker set search_path='' as $$
 select private.exam_import_register(digest_sha256,original_filename,byte_size,page_count,
   extraction_status,candidates,visual_extraction_status)
$$;
revoke all on function public.exam_import_register(text,text,integer,integer,text,jsonb,text) from public,anon;
grant execute on function public.exam_import_register(text,text,integer,integer,text,jsonb,text) to authenticated;

create function private.exam_import_commit(
 request_id uuid,document_id uuid,candidate_index integer,
 exam_payload jsonb,accept_possible_duplicate boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 owner_id uuid := private.require_owner();
 receipt public.command_receipts;
 source_document public.exam_documents;
 source_candidate jsonb;
 receipt_payload jsonb;
 fingerprint text;
 exam_result jsonb;
 result jsonb;
 saved_exam_id uuid;
begin
 if request_id is null or document_id is null or candidate_index not between 0 and 49
    or exam_payload is null or jsonb_typeof(exam_payload) is distinct from 'object'
    or not exam_payload ?& array['name','exam_date','format_code','results']
    or accept_possible_duplicate is null or pg_column_size(exam_payload)>64000 then
  raise exception 'INVALID_INPUT';
 end if;
 receipt_payload:=jsonb_build_object('document_id',document_id,
  'candidate_index',candidate_index,'exam',exam_payload,
  'accept_possible_duplicate',accept_possible_duplicate);
 select * into receipt from public.command_receipts r
  where r.user_id=owner_id and r.request_id=exam_import_commit.request_id;
 if found then
  if receipt.command_type<>'exam_import.commit' or receipt.payload<>receipt_payload then
   raise exception 'IDEMPOTENCY_CONFLICT';
  end if;
  return receipt.result||'{"replayed":true}'::jsonb;
 end if;
 select * into source_document from public.exam_documents d
  where d.id=document_id and d.user_id=owner_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 source_candidate:=source_document.candidates->candidate_index;
 if source_candidate is null or (source_candidate->>'index')::integer<>candidate_index then
  raise exception 'INVALID_INPUT';
 end if;
 if exists(select 1 from public.exam_imports i
           where i.user_id=owner_id and i.document_id=exam_import_commit.document_id
            and i.candidate_index=exam_import_commit.candidate_index) then
  raise exception 'IMPORT_ALREADY_SAVED';
 end if;
 fingerprint:=md5(
  lower(btrim(exam_payload->>'name'))||'|'||(exam_payload->>'exam_date')||'|'||
  (exam_payload->>'format_code')||'|'||lower(btrim(coalesce(exam_payload->>'publisher','')))||'|'||
  coalesce((select string_agg(value::text,',' order by value->>'section_key')
            from jsonb_array_elements(exam_payload->'results') as rows(value)),'')
 );
 if not accept_possible_duplicate and (
  exists(select 1 from public.exam_imports i
         where i.user_id=owner_id and i.result_fingerprint=fingerprint)
  or exists(select 1 from public.exams e where e.user_id=owner_id
   and e.exam_date=(exam_payload->>'exam_date')::date
   and e.format_code=exam_payload->>'format_code'
   and lower(e.name)=lower(btrim(exam_payload->>'name'))
   and lower(e.publisher)=lower(btrim(coalesce(exam_payload->>'publisher',''))))
 ) then raise exception 'POSSIBLE_DUPLICATE'; end if;
 -- Nested exam command validates all corrected counts and inserts the exam,
 -- results and audit receipt inside this same database transaction.
 exam_result:=private.exam_command(gen_random_uuid(),'exam.create',exam_payload);
 saved_exam_id:=(exam_result->>'id')::uuid;
 update public.exams e set
  source_document_id=source_document.id,
  import_metadata=jsonb_build_object(
   'candidate_index',candidate_index,'document_sha256',source_document.sha256,
   'source_pages',source_candidate->'source_pages',
   'reviewed_at',clock_timestamp())
  where e.id=saved_exam_id and e.user_id=owner_id;
 insert into public.exam_imports(
  user_id,document_id,candidate_index,exam_id,result_fingerprint,corrections
 ) values(owner_id,document_id,candidate_index,saved_exam_id,fingerprint,exam_payload);
 update public.audit_log a set source='pdf_import'
  where a.user_id=owner_id and a.entity='exam'
   and a.entity_id=saved_exam_id and a.action='exam.create';
 insert into public.audit_log(user_id,entity,entity_id,action,new_value,source)
 values(owner_id,'exam_import',saved_exam_id,'exam_import.commit',
  jsonb_build_object('document_id',document_id,'candidate_index',candidate_index,
   'result_fingerprint',fingerprint),'pdf_import');
 result:=jsonb_build_object('id',saved_exam_id,'request_id',request_id,'replayed',false);
 insert into public.command_receipts(user_id,request_id,command_type,payload,result)
 values(owner_id,request_id,'exam_import.commit',receipt_payload,result);
 return result;
end $$;
revoke all on function private.exam_import_commit(uuid,uuid,integer,jsonb,boolean) from public,anon;
grant execute on function private.exam_import_commit(uuid,uuid,integer,jsonb,boolean) to authenticated;
create function public.exam_import_commit(
 request_id uuid,document_id uuid,candidate_index integer,
 exam_payload jsonb,accept_possible_duplicate boolean
) returns jsonb language sql security invoker set search_path='' as $$
 select private.exam_import_commit(request_id,document_id,candidate_index,
   exam_payload,accept_possible_duplicate)
$$;
revoke all on function public.exam_import_commit(uuid,uuid,integer,jsonb,boolean) from public,anon;
grant execute on function public.exam_import_commit(uuid,uuid,integer,jsonb,boolean) to authenticated;
