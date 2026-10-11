-- Profile images stay private and are fetched through the authenticated app route.
-- Local database tests may not include Supabase Storage.
do $$
begin
 if to_regclass('storage.buckets') is not null then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('profile-photos','profile-photos',false,1048576,array['image/webp']::text[])
  on conflict(id) do update set public=false,file_size_limit=1048576,
   allowed_mime_types=array['image/webp']::text[];
 end if;
 if to_regclass('storage.objects') is not null then
  -- ALL includes INSERT + SELECT + UPDATE for replacement, plus DELETE.
  execute $policy$
   create policy profile_photos_self on storage.objects for all to authenticated
   using (
    bucket_id='profile-photos'
    and name=(select auth.uid())::text||'/avatar.webp'
    and (select private.classroom_can_study(auth.uid()))
   )
   with check (
    bucket_id='profile-photos'
    and name=(select auth.uid())::text||'/avatar.webp'
    and (select private.classroom_can_study(auth.uid()))
   )
  $policy$;
  -- Another bucket's permissive policy must never broaden private photo access.
  execute $policy$
   create policy profile_photos_private on storage.objects as restrictive for all to authenticated
   using (
    bucket_id<>'profile-photos'
    or (name=(select auth.uid())::text||'/avatar.webp'
     and (select private.classroom_can_study(auth.uid())))
   )
   with check (
    bucket_id<>'profile-photos'
    or (name=(select auth.uid())::text||'/avatar.webp'
     and (select private.classroom_can_study(auth.uid())))
   )
  $policy$;
 end if;
end $$;
