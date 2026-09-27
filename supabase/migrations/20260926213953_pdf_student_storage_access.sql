-- Approved students can upload and read their own exam PDFs. The existing
-- owner policies stay in place, and the restrictive MCP browser-session
-- policy still applies to every operation on this bucket.
do $$
begin
  -- Embedded database tests do not install Supabase Storage.
  if to_regclass('storage.objects') is not null then
    execute $policy$
      create policy exam_documents_study_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'exam-documents'
        and split_part(name, '/', 1) = (select auth.uid())::text
        and name ~ '^[0-9a-f-]{36}/[0-9a-f]{64}\.pdf$'
        and (select private.classroom_can_study(auth.uid()))
      )
    $policy$;
    execute $policy$
      create policy exam_documents_study_read on storage.objects
      for select to authenticated
      using (
        bucket_id = 'exam-documents'
        and split_part(name, '/', 1) = (select auth.uid())::text
        and name ~ '^[0-9a-f-]{36}/[0-9a-f]{64}\.pdf$'
        and (select private.classroom_can_study(auth.uid()))
      )
    $policy$;
    execute $policy$
      create policy exam_documents_study_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'exam-documents'
        and split_part(name, '/', 1) = (select auth.uid())::text
        and name ~ '^[0-9a-f-]{36}/[0-9a-f]{64}\.pdf$'
        and (select private.classroom_can_study(auth.uid()))
      )
    $policy$;
  end if;
end $$;
