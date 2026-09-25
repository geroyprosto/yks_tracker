-- One explicitly requested diary suggestion shares the same monthly request and
-- estimated USD budget as period reports. Raw diary text is never persisted here.
create table public.journal_ai_suggestions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
 status text not null check (status in ('running','completed','failed','uncertain')),
 fields jsonb check (fields is null or jsonb_typeof(fields)='object'),
 usage jsonb check (usage is null or jsonb_typeof(usage)='object'),
 error_message text check (error_message is null or length(error_message) between 1 and 1000),
 lease_expires_at timestamptz,
 reserved_month date not null,
 reserved_cost_usd numeric not null check (reserved_cost_usd>=0),
 actual_cost_usd numeric check (actual_cost_usd is null or actual_cost_usd>=0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,request_id),
 unique(user_id,source_hash),
 check (status<>'completed' or fields is not null)
);
create index journal_ai_suggestions_user_created
 on public.journal_ai_suggestions(user_id,created_at desc);
alter table public.journal_ai_suggestions enable row level security;
create policy journal_ai_suggestions_owner_read on public.journal_ai_suggestions
 for select to authenticated
 using (user_id=(select auth.uid()) and exists
  (select 1 from public.owner_allowlist where user_id=(select auth.uid())));
revoke all on public.journal_ai_suggestions from public,anon,authenticated,service_role;
grant select on public.journal_ai_suggestions to authenticated,service_role;

create function public.journal_ai_suggestion_claim(
 p_user_id uuid,p_request_id uuid,p_source_hash text,p_max_requests integer,
 p_monthly_budget_usd numeric,p_reserved_cost_usd numeric
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 suggestion public.journal_ai_suggestions;
 monthly public.analysis_usage;
 at_time timestamptz:=clock_timestamp();
 billing_month date:=date_trunc('month',(clock_timestamp() at time zone 'Europe/Istanbul'))::date;
begin
 perform private.analysis_require_target_owner(p_user_id);
 if p_request_id is null or p_source_hash is null or p_source_hash !~ '^[0-9a-f]{64}$'
    or p_max_requests is null or p_max_requests<1
    or p_monthly_budget_usd is null or p_monthly_budget_usd<=0
    or p_reserved_cost_usd is null or p_reserved_cost_usd<0
    or p_reserved_cost_usd>p_monthly_budget_usd
    or p_monthly_budget_usd::text='NaN' or p_reserved_cost_usd::text='NaN'
 then raise exception 'INVALID_INPUT'; end if;

 select * into suggestion from public.journal_ai_suggestions
 where user_id=p_user_id and request_id=p_request_id for update;
 if found then
  if suggestion.source_hash<>p_source_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('suggestion',to_jsonb(suggestion),'claimed',false,'replayed',true);
 end if;
 select * into suggestion from public.journal_ai_suggestions
 where user_id=p_user_id and source_hash=p_source_hash for update;
 if found then
  if suggestion.status='running' and suggestion.lease_expires_at<=at_time then
   update public.journal_ai_suggestions set status='uncertain',
    error_message='SUGGESTION_LEASE_EXPIRED',updated_at=at_time
   where id=suggestion.id returning * into suggestion;
  end if;
  return jsonb_build_object('suggestion',to_jsonb(suggestion),'claimed',false,'replayed',false);
 end if;

 insert into public.analysis_usage(user_id,month) values(p_user_id,billing_month)
 on conflict (user_id,month) do nothing;
 select * into monthly from public.analysis_usage
 where user_id=p_user_id and month=billing_month for update;
 if monthly.requests>=p_max_requests
    or monthly.estimated_cost_usd+p_reserved_cost_usd>p_monthly_budget_usd
 then raise exception 'AI_LIMIT_REACHED'; end if;
 update public.analysis_usage set requests=requests+1,
  estimated_cost_usd=estimated_cost_usd+p_reserved_cost_usd
 where user_id=p_user_id and month=billing_month;
 insert into public.journal_ai_suggestions(
  user_id,request_id,source_hash,status,lease_expires_at,reserved_month,reserved_cost_usd
 ) values (
  p_user_id,p_request_id,p_source_hash,'running',at_time+interval '10 minutes',
  billing_month,p_reserved_cost_usd
 ) returning * into suggestion;
 insert into public.audit_log(user_id,entity,entity_id,action,new_value,source)
 values(p_user_id,'journal_ai_suggestion',suggestion.id,'journal.ai.claim',
  jsonb_build_object('source_hash',p_source_hash),'app');
 return jsonb_build_object('suggestion',to_jsonb(suggestion),'claimed',true,'replayed',false);
end $$;

create function public.journal_ai_suggestion_finalize(
 p_user_id uuid,p_suggestion_id uuid,p_request_id uuid,p_fields jsonb,
 p_usage jsonb,p_actual_cost_usd numeric
) returns public.journal_ai_suggestions
 language plpgsql security definer set search_path='' as $$
declare suggestion public.journal_ai_suggestions;
begin
 perform private.analysis_require_target_owner(p_user_id);
 if p_suggestion_id is null or p_request_id is null
    or p_fields is null or jsonb_typeof(p_fields)<>'object'
    or p_usage is null or jsonb_typeof(p_usage)<>'object'
    or p_actual_cost_usd is null or p_actual_cost_usd<0
    or p_actual_cost_usd::text='NaN'
 then raise exception 'INVALID_INPUT'; end if;
 select * into suggestion from public.journal_ai_suggestions
 where id=p_suggestion_id and user_id=p_user_id for update;
 if not found then raise exception 'SUGGESTION_NOT_FOUND'; end if;
 if suggestion.request_id<>p_request_id or suggestion.status in ('failed','uncertain')
 then raise exception 'STALE_ATTEMPT'; end if;
 if suggestion.status='completed' then
  if suggestion.fields=p_fields and suggestion.usage=p_usage
     and suggestion.actual_cost_usd=p_actual_cost_usd then return suggestion; end if;
  raise exception 'IDEMPOTENCY_CONFLICT';
 end if;
 update public.analysis_usage set estimated_cost_usd=
  greatest(0,estimated_cost_usd-suggestion.reserved_cost_usd+p_actual_cost_usd)
 where user_id=p_user_id and month=suggestion.reserved_month;
 update public.journal_ai_suggestions set status='completed',fields=p_fields,
  usage=p_usage,actual_cost_usd=p_actual_cost_usd,error_message=null,
  lease_expires_at=null,updated_at=clock_timestamp()
 where id=suggestion.id returning * into suggestion;
 insert into public.audit_log(user_id,entity,entity_id,action,new_value,source)
 values(p_user_id,'journal_ai_suggestion',suggestion.id,'journal.ai.complete',
  jsonb_build_object('request_id',p_request_id,'actual_cost_usd',p_actual_cost_usd),'app');
 return suggestion;
end $$;

create function public.journal_ai_suggestion_fail(
 p_user_id uuid,p_suggestion_id uuid,p_request_id uuid,p_error_message text
) returns public.journal_ai_suggestions
 language plpgsql security definer set search_path='' as $$
declare suggestion public.journal_ai_suggestions;
begin
 perform private.analysis_require_target_owner(p_user_id);
 if p_suggestion_id is null or p_request_id is null or p_error_message is null
    or length(btrim(p_error_message))=0 or length(p_error_message)>1000
 then raise exception 'INVALID_INPUT'; end if;
 select * into suggestion from public.journal_ai_suggestions
 where id=p_suggestion_id and user_id=p_user_id for update;
 if not found then raise exception 'SUGGESTION_NOT_FOUND'; end if;
 if suggestion.request_id<>p_request_id then raise exception 'STALE_ATTEMPT'; end if;
 if suggestion.status='completed' then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 if suggestion.status='failed' then return suggestion; end if;
 update public.journal_ai_suggestions set status='failed',error_message=p_error_message,
  lease_expires_at=null,updated_at=clock_timestamp()
 where id=suggestion.id returning * into suggestion;
 insert into public.audit_log(user_id,entity,entity_id,action,new_value,source)
 values(p_user_id,'journal_ai_suggestion',suggestion.id,'journal.ai.fail',
  jsonb_build_object('request_id',p_request_id,'error_message',p_error_message),'app');
 return suggestion;
end $$;

revoke all on function public.journal_ai_suggestion_claim(uuid,uuid,text,integer,numeric,numeric),
 public.journal_ai_suggestion_finalize(uuid,uuid,uuid,jsonb,jsonb,numeric),
 public.journal_ai_suggestion_fail(uuid,uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.journal_ai_suggestion_claim(uuid,uuid,text,integer,numeric,numeric),
 public.journal_ai_suggestion_finalize(uuid,uuid,uuid,jsonb,jsonb,numeric),
 public.journal_ai_suggestion_fail(uuid,uuid,uuid,text)
 to service_role;
