-- Photos remain private. Read access follows current group membership and is
-- checked afresh on each request; the storage API still handles self-only writes.
create function private.profile_photo_can_read(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null
  and p_user_id is not null
  and private.classroom_can_study(auth.uid())
  and (
   p_user_id = auth.uid()
   or (
    exists (select 1 from public.classroom_accounts a
     where a.id = auth.uid() and a.role = 'student' and a.status = 'approved')
    and exists (select 1 from public.classroom_accounts a
     where a.id = p_user_id and a.role = 'student' and a.status = 'approved')
    and exists (
     select 1 from private.friend_group_members mine
     join private.friend_group_members peer on peer.group_id = mine.group_id
     where mine.user_id = auth.uid() and peer.user_id = p_user_id
    )
   )
  )
$$;

-- A boolean-only RPC allows the app to fail closed before accessing storage.
create function public.profile_photo_can_read(p_user_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
 select private.profile_photo_can_read(p_user_id)
$$;
revoke all on function private.profile_photo_can_read(uuid), public.profile_photo_can_read(uuid)
 from public, anon, authenticated, service_role;
grant execute on function private.profile_photo_can_read(uuid), public.profile_photo_can_read(uuid)
 to authenticated;

do $$
begin
 if to_regclass('storage.objects') is not null then
  -- The old restrictive ALL policy also blocked shared SELECT. Replace it with
  -- per-command guards so an unrelated permissive policy cannot widen writes.
  execute 'drop policy profile_photos_private on storage.objects';
  execute $policy$
   create policy profile_photos_friend_read on storage.objects for select to authenticated
   using (
    bucket_id = 'profile-photos'
    and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar\.webp$'
     then private.profile_photo_can_read(split_part(name, '/', 1)::uuid)
     else false end
   )
  $policy$;
  execute $policy$
   create policy profile_photos_private_read on storage.objects as restrictive for select to authenticated
   using (
    bucket_id <> 'profile-photos'
    or case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/avatar\.webp$'
     then private.profile_photo_can_read(split_part(name, '/', 1)::uuid)
     else false end
   )
  $policy$;
  execute $policy$
   create policy profile_photos_private_insert on storage.objects as restrictive for insert to authenticated
   with check (
    bucket_id <> 'profile-photos'
    or (name = (select auth.uid())::text || '/avatar.webp'
     and (select private.classroom_can_study(auth.uid())))
   )
  $policy$;
  execute $policy$
   create policy profile_photos_private_update on storage.objects as restrictive for update to authenticated
   using (
    bucket_id <> 'profile-photos'
    or (name = (select auth.uid())::text || '/avatar.webp'
     and (select private.classroom_can_study(auth.uid())))
   )
   with check (
    bucket_id <> 'profile-photos'
    or (name = (select auth.uid())::text || '/avatar.webp'
     and (select private.classroom_can_study(auth.uid())))
   )
  $policy$;
  execute $policy$
   create policy profile_photos_private_delete on storage.objects as restrictive for delete to authenticated
   using (
    bucket_id <> 'profile-photos'
    or (name = (select auth.uid())::text || '/avatar.webp'
     and (select private.classroom_can_study(auth.uid())))
   )
  $policy$;
 end if;
end $$;
