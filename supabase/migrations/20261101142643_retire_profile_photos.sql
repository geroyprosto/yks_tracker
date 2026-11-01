-- Retire browser access without deleting Storage metadata or stored objects.
-- Any remaining bytes must be removed through the Storage API by an administrator.
do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists profile_photos_self on storage.objects;
    drop policy if exists profile_photos_friend_read on storage.objects;
    drop policy if exists profile_photos_private on storage.objects;
    drop policy if exists profile_photos_private_read on storage.objects;
    drop policy if exists profile_photos_private_insert on storage.objects;
    drop policy if exists profile_photos_private_update on storage.objects;
    drop policy if exists profile_photos_private_delete on storage.objects;

    -- A broad policy for another bucket must not reopen this retired feature.
    create policy profile_photos_retired on storage.objects
      as restrictive for all to anon, authenticated
      using (bucket_id <> 'profile-photos')
      with check (bucket_id <> 'profile-photos');
  end if;
end;
$$;

drop function if exists public.profile_photo_can_read(uuid);
drop function if exists private.profile_photo_can_read(uuid);
