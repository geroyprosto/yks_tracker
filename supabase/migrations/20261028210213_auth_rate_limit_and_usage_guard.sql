-- Retain existing registration windows while sharing bounded storage with login.
-- Keys remain HMAC digests, never email addresses or client IP addresses.
alter table private.classroom_registration_attempts
 add column scope text not null default 'registration' check(scope in ('registration','login'));
alter table private.classroom_registration_attempts drop constraint classroom_registration_attempts_pkey;
alter table private.classroom_registration_attempts add primary key(scope,key);
create index classroom_auth_counter_expiry on private.classroom_registration_attempts(scope,reset_at,key);

create function private.auth_attempt_allowed(p_scope text,p_ip_digest text,p_email_digest text)
returns boolean language plpgsql security definer set search_path='' as $$
declare
 at_time timestamptz;
 ip_key text;
 email_key text;
 ip_limit integer;
 email_limit integer;
 period interval;
 ip_row private.classroom_registration_attempts;
 email_row private.classroom_registration_attempts;
 ip_exists boolean;
 email_exists boolean;
 needed_slots integer;
 stored_slots integer;
begin
 if p_scope is null or p_scope not in ('registration','login')
  or p_email_digest is null or p_email_digest !~ '^[0-9a-f]{64}$'
  or (p_ip_digest is not null and p_ip_digest !~ '^[0-9a-f]{64}$') then raise exception 'INVALID_INPUT'; end if;
 -- Two-int advisory keys use a different namespace from per-student bigint
 -- locks. A busy throttle fails closed instead of queuing auth requests.
 if not pg_try_advisory_xact_lock(2147483000,116) then return false; end if;
 at_time:=clock_timestamp();
 ip_limit:=case when p_scope='registration' then 5 else 50 end;
 email_limit:=case when p_scope='registration' then 3 else 10 end;
 period:=case when p_scope='registration' then interval '15 minutes' else interval '1 minute' end;
 -- Missing trusted proxy identity shares one fixed bucket; it cannot bypass
 -- the IP throttle or allocate an unbounded family of fallback counters.
 ip_key:='ip:'||coalesce(p_ip_digest,repeat('0',64));
 email_key:='email:'||p_email_digest;

 delete from private.classroom_registration_attempts counter
 where counter.scope=p_scope and counter.key in (
  select expired.key from private.classroom_registration_attempts expired
  where expired.scope=p_scope and expired.reset_at<=at_time
  order by expired.reset_at,expired.key limit 128
 );
 select * into ip_row from private.classroom_registration_attempts c where c.scope=p_scope and c.key=ip_key;
 ip_exists:=found;
 -- Reject a saturated IP before reading or allocating any new email counter.
 if ip_exists and ip_row.reset_at>at_time and ip_row.attempts>=ip_limit then return false; end if;
 select * into email_row from private.classroom_registration_attempts c where c.scope=p_scope and c.key=email_key;
 email_exists:=found;
 needed_slots:=(case when ip_exists then 0 else 1 end)+(case when email_exists then 0 else 1 end);
 if needed_slots>0 then
  select count(*) into stored_slots from (
   select 1 from private.classroom_registration_attempts c where c.scope=p_scope limit 5001
  ) bounded;
  -- Separate reservations keep registration churn from consuming login space.
  -- The shared lock makes each 5,000-row scope (10,000 total) cap atomic.
  if stored_slots+needed_slots>5000 then return false; end if;
 end if;

 insert into private.classroom_registration_attempts as counter(scope,key,attempts,reset_at)
 values(p_scope,ip_key,1,at_time+period)
 on conflict(scope,key) do update set
  attempts=case when counter.reset_at<=at_time then 1 else least(ip_limit,counter.attempts+1) end,
  reset_at=case when counter.reset_at<=at_time then at_time+period else counter.reset_at end;
 if email_exists and email_row.reset_at>at_time and email_row.attempts>=email_limit then return false; end if;
 insert into private.classroom_registration_attempts as counter(scope,key,attempts,reset_at)
 values(p_scope,email_key,1,at_time+period)
 on conflict(scope,key) do update set
  attempts=case when counter.reset_at<=at_time then 1 else least(email_limit,counter.attempts+1) end,
  reset_at=case when counter.reset_at<=at_time then at_time+period else counter.reset_at end;
 return true;
end $$;
revoke all on function private.auth_attempt_allowed(text,text,text) from public,anon,authenticated,service_role;

create or replace function public.classroom_registration_allowed(ip_digest text,email_digest text)
returns boolean language sql security definer set search_path='' as $$
 select private.auth_attempt_allowed('registration',ip_digest,email_digest)
$$;
create function public.classroom_login_allowed(ip_digest text,email_digest text)
returns boolean language sql security definer set search_path='' as $$
 select private.auth_attempt_allowed('login',ip_digest,email_digest)
$$;
revoke all on function public.classroom_registration_allowed(text,text),public.classroom_login_allowed(text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.classroom_registration_allowed(text,text),public.classroom_login_allowed(text,text) to service_role;

-- A valid OAuth client bearer is not a browser session. Apply the existing
-- browser boundary before reading usage while preserving student/admin rules.
create or replace function public.ai_usage_status() returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); billing_month date:=date_trunc('month',clock_timestamp() at time zone 'Europe/Istanbul')::date; used public.analysis_usage;
begin
 if not private.is_browser_session() then raise exception 'STUDENT_REQUIRED'; end if;
 perform private.analysis_require_target_study_user(owner_id);
 select * into used from public.analysis_usage where user_id=owner_id and month=billing_month;
 return jsonb_build_object('requests',coalesce(used.requests,0),'estimated_cost_usd',coalesce(used.estimated_cost_usd,0),
  'monthly_requests',4,'month',billing_month,'resets_at',(billing_month+interval '1 month') at time zone 'Europe/Istanbul',
  'enabled',exists(select 1 from private.ai_budget_policy where singleton and enabled and monthly_budget_usd is not null));
end $$;
revoke all on function public.ai_usage_status() from public,anon,authenticated,service_role;
grant execute on function public.ai_usage_status() to authenticated;
