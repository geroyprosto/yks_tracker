-- PDF import/upload was removed from the product. Close its leftover browser
-- Storage write access instead of reintroducing an upload/quota subsystem.
-- Keep existing private reads and deletes, other buckets, and trusted service
-- maintenance unchanged. Restrictive policies also survive future permissive
-- policies; UPDATE must guard both the source and destination of a move.
do $$
begin
 if to_regclass('storage.objects') is not null then
  execute $policy$
   create policy exam_documents_retired_insert on storage.objects
   as restrictive for insert to authenticated
   with check (bucket_id <> 'exam-documents')
  $policy$;
  execute $policy$
   create policy exam_documents_retired_update on storage.objects
   as restrictive for update to authenticated
   using (bucket_id <> 'exam-documents')
   with check (bucket_id <> 'exam-documents')
  $policy$;
 end if;
end $$;
