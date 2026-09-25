-- Run in the Supabase SQL Editor after creating and confirming the one Auth user.
-- Replace the email below. Enter the password only in Supabase Auth, never here.
-- The singleton owner row is never reassigned by this script.
do $owner_setup$
declare
  expected_email constant text := lower(btrim('REPLACE_WITH_OWNER_EMAIL'));
  matching_users uuid[];
  existing_owner uuid;
begin
  if expected_email = 'replace_with_owner_email' then
    raise exception 'Replace REPLACE_WITH_OWNER_EMAIL with your confirmed Auth email before running this script.';
  end if;

  select array_agg(id order by created_at)
    into matching_users
    from auth.users
   where lower(btrim(email)) = expected_email
     and email_confirmed_at is not null;

  if coalesce(cardinality(matching_users), 0) <> 1 then
    raise exception 'Expected exactly one confirmed Auth user for %, found %.',
      expected_email, coalesce(cardinality(matching_users), 0);
  end if;

  select user_id into existing_owner
    from public.owner_allowlist
   where singleton is true
   for update;

  if existing_owner is not null and existing_owner <> matching_users[1] then
    raise exception 'A different owner is already configured. No owner was changed.';
  end if;

  insert into public.owner_allowlist (singleton, user_id)
  values (true, matching_users[1])
  on conflict (singleton) do nothing;

  if not exists (
    select 1 from public.owner_allowlist
     where singleton is true and user_id = matching_users[1]
  ) then
    raise exception 'Owner setup did not authorize the expected user.';
  end if;
end
$owner_setup$;

select count(*) = 1 as owner_ready from public.owner_allowlist;
-- Open the app and log in. The first successful state load creates your settings
-- and editable topic catalogue with mastery=0. No tasks, sessions or results are seeded.
