-- Email-free registrations use privileged Auth creation. Bound the public
-- endpoint with a shared database counter instead of process memory.
create table private.classroom_registration_attempts (
  key text primary key check (key ~ '^(ip|email):[0-9a-f]{64}$'),
  attempts integer not null check (attempts > 0),
  reset_at timestamptz not null
);
alter table private.classroom_registration_attempts enable row level security;
revoke all on private.classroom_registration_attempts from public, anon, authenticated, service_role;

create function public.classroom_registration_allowed(ip_digest text, email_digest text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare at_time timestamptz := clock_timestamp(); ip_attempts integer := 0; email_attempts integer;
begin
  if email_digest is null or email_digest !~ '^[0-9a-f]{64}$'
     or (ip_digest is not null and ip_digest !~ '^[0-9a-f]{64}$') then
    raise exception 'INVALID_INPUT';
  end if;

  if ip_digest is not null then
    insert into private.classroom_registration_attempts as counter (key, attempts, reset_at)
    values ('ip:' || ip_digest, 1, at_time + interval '15 minutes')
    on conflict (key) do update
      set attempts = case when counter.reset_at <= at_time then 1 else counter.attempts + 1 end,
          reset_at = case when counter.reset_at <= at_time then at_time + interval '15 minutes' else counter.reset_at end
    returning attempts into ip_attempts;
  end if;

  insert into private.classroom_registration_attempts as counter (key, attempts, reset_at)
  values ('email:' || email_digest, 1, at_time + interval '15 minutes')
  on conflict (key) do update
    set attempts = case when counter.reset_at <= at_time then 1 else counter.attempts + 1 end,
        reset_at = case when counter.reset_at <= at_time then at_time + interval '15 minutes' else counter.reset_at end
  returning attempts into email_attempts;

  return (ip_digest is null or ip_attempts <= 5) and email_attempts <= 3;
end $$;
revoke all on function public.classroom_registration_allowed(text, text) from public, anon, authenticated;
grant execute on function public.classroom_registration_allowed(text, text) to service_role;
