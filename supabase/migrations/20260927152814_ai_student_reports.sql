-- Local rollout draft. No provider is enabled by this migration. Deployment must
-- explicitly set this private policy and matching server environment settings.
create table private.ai_budget_policy (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 monthly_budget_usd numeric check(monthly_budget_usd>0 and monthly_budget_usd<=10000 and monthly_budget_usd::text<>'NaN')
);
insert into private.ai_budget_policy(singleton) values(true);
revoke all on private.ai_budget_policy from public,anon,authenticated,service_role;

-- Application cost survives account deletion; a cascade must not erase spend.
create table private.ai_application_usage (
 month date primary key check(extract(day from month)=1),
 estimated_cost_usd numeric not null default 0 check(estimated_cost_usd>=0 and estimated_cost_usd::text<>'NaN')
);
insert into private.ai_application_usage(month,estimated_cost_usd)
 select month,sum(estimated_cost_usd) from public.analysis_usage group by month;
revoke all on private.ai_application_usage from public,anon,authenticated,service_role;

-- Every paid report and diary path already increments this common ledger.
-- Enforce the account cap independently of all RPC parameters/profile changes.
-- The global lock serializes application-budget reservations across accounts.
create function private.ai_enforce_budget() returns trigger
language plpgsql security definer set search_path='' as $$
declare policy private.ai_budget_policy; app_total numeric; old_cost numeric:=0; old_requests integer:=0;
begin
 if tg_op='UPDATE' then
  old_cost:=old.estimated_cost_usd;old_requests:=old.requests;
  if new.month<>old.month or new.user_id<>old.user_id then raise exception 'INVALID_BILLING_MONTH';end if;
 end if;
 if new.requests>old_requests or new.estimated_cost_usd<>old_cost then
  perform pg_advisory_xact_lock(hashtextextended('ai-budget:'||new.month::text,0));
  insert into private.ai_application_usage(month) values(new.month) on conflict do nothing;
  select estimated_cost_usd into app_total from private.ai_application_usage where month=new.month for update;
  if new.requests>old_requests then
   select * into policy from private.ai_budget_policy where singleton;
   if not found or not policy.enabled or policy.monthly_budget_usd is null then raise exception 'AI_DISABLED'; end if;
   if new.month<>date_trunc('month',clock_timestamp() at time zone 'Europe/Istanbul')::date then raise exception 'INVALID_BILLING_MONTH'; end if;
   if new.requests>4 then raise exception 'AI_LIMIT_REACHED'; end if;
   if app_total-old_cost+new.estimated_cost_usd>policy.monthly_budget_usd then raise exception 'AI_APP_BUDGET_REACHED'; end if;
  end if;
  -- Confirmed token usage remains auditable even if it exceeds its estimate.
  update private.ai_application_usage set estimated_cost_usd=greatest(0,app_total-old_cost+new.estimated_cost_usd) where month=new.month;
 end if;
 return new;
end $$;
create trigger ai_shared_budget before insert or update on public.analysis_usage
for each row execute function private.ai_enforce_budget();
revoke all on function private.ai_enforce_budget() from public,anon,authenticated,service_role;

alter table public.analysis_reports add column provider_sent_at timestamptz;
alter table public.journal_ai_suggestions add column provider_sent_at timestamptz;
-- Earlier attempts may already have reached the provider. Never refund them.
update public.analysis_reports set provider_sent_at=created_at where reserved_month is not null;
update public.journal_ai_suggestions set provider_sent_at=created_at;

create function public.ai_mark_sent(p_user_id uuid,p_kind text,p_id uuid,p_request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare table_name text; changed integer;
begin
 perform private.analysis_require_target_study_user(p_user_id);
 if p_kind='report' then table_name:='analysis_reports';
 elsif p_kind='journal' then table_name:='journal_ai_suggestions';
 else raise exception 'INVALID_INPUT'; end if;
 -- Recheck kill switch immediately before dispatch, while still refundable.
 if not exists(select 1 from private.ai_budget_policy where singleton and enabled and monthly_budget_usd is not null)
 then raise exception 'AI_DISABLED'; end if;
 execute format('update public.%I set provider_sent_at=clock_timestamp() where user_id=$1 and id=$2 and request_id=$3 and status=''running'' and provider_sent_at is null',table_name)
 using p_user_id,p_id,p_request_id;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'STALE_ATTEMPT'; end if;
end $$;
revoke all on function public.ai_mark_sent(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.ai_mark_sent(uuid,text,uuid,uuid) to service_role;

-- A pre-dispatch failure returns the reservation. After dispatch, uncertainty
-- retains quota/cost and cannot be retried through either claim RPC.
create function private.ai_failure_lifecycle() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='failed' and old.status='running' then
  if old.provider_sent_at is not null then new.status:='uncertain';
  else
   update public.analysis_usage set requests=greatest(0,requests-1),
    estimated_cost_usd=greatest(0,estimated_cost_usd-old.reserved_cost_usd)
   where user_id=old.user_id and month=old.reserved_month;
   new.reserved_cost_usd:=0;
  end if;
 end if;
 return new;
end $$;
create trigger ai_report_failure before update on public.analysis_reports for each row execute function private.ai_failure_lifecycle();
create trigger ai_journal_failure before update on public.journal_ai_suggestions for each row execute function private.ai_failure_lifecycle();
revoke all on function private.ai_failure_lifecycle() from public,anon,authenticated,service_role;

-- Controlled operator reconciliation; never exposed to service_role or users.
-- Call only with provider proof of zero charge; no automatic retry is created.
create function private.ai_reconcile_unbilled(p_kind text,p_id uuid,p_provider_reference text) returns void
language plpgsql security definer set search_path='' as $$
declare row_data record; table_name text;
begin
 if length(btrim(coalesce(p_provider_reference,'')))<5 then raise exception 'PROVIDER_PROOF_REQUIRED'; end if;
 if p_kind='report' then table_name:='analysis_reports'; elsif p_kind='journal' then table_name:='journal_ai_suggestions'; else raise exception 'INVALID_INPUT'; end if;
 execute format('select * from public.%I where id=$1 for update',table_name) into row_data using p_id;
 if row_data.id is null or row_data.status<>'uncertain' then raise exception 'STALE_ATTEMPT'; end if;
 update public.analysis_usage set requests=greatest(0,requests-1),estimated_cost_usd=greatest(0,estimated_cost_usd-row_data.reserved_cost_usd)
 where user_id=row_data.user_id and month=row_data.reserved_month;
 execute format('update public.%I set status=''failed'',reserved_cost_usd=0,error_message=''PROVIDER_CONFIRMED_UNBILLED'',updated_at=clock_timestamp() where id=$1',table_name) using p_id;
 insert into public.audit_log(user_id,entity,entity_id,action,new_value,source)
 values(row_data.user_id,'ai_reservation',p_id,'ai.reconcile.unbilled',jsonb_build_object('provider_reference',p_provider_reference),'app');
end $$;
revoke all on function private.ai_reconcile_unbilled(text,uuid,text) from public,anon,authenticated,service_role;

create function public.ai_usage_status() returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); billing_month date:=date_trunc('month',clock_timestamp() at time zone 'Europe/Istanbul')::date; used public.analysis_usage;
begin
 perform private.analysis_require_target_study_user(owner_id);
 select * into used from public.analysis_usage where user_id=owner_id and month=billing_month;
 return jsonb_build_object('requests',coalesce(used.requests,0),'estimated_cost_usd',coalesce(used.estimated_cost_usd,0),
  'monthly_requests',4,'month',billing_month,'resets_at',(billing_month+interval '1 month') at time zone 'Europe/Istanbul',
  'enabled',exists(select 1 from private.ai_budget_policy where singleton and enabled and monthly_budget_usd is not null));
end $$;
revoke all on function public.ai_usage_status() from public,anon,authenticated,service_role;
grant execute on function public.ai_usage_status() to authenticated;

update public.analysis_settings set enabled=false;
create or replace function private.analysis_schedule_set_for(p_user_id uuid,p_enabled boolean,p_start_date date)
returns public.analysis_settings language plpgsql security definer set search_path='' as $$
declare result public.analysis_settings;
begin
 if p_enabled then raise exception 'AUTOMATIC_AI_DISABLED'; end if;
 insert into public.analysis_settings(user_id,enabled,start_date) values(p_user_id,false,p_start_date)
 on conflict(user_id) do update set enabled=false,updated_at=clock_timestamp() returning * into result;
 return result;
end $$;
