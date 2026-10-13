-- Nova is opt-in. This migration deliberately grants access to nobody.
-- All public entrypoints are invoker wrappers; privileged implementations live
-- in the unexposed private schema, with explicit checks and EXECUTE allowlists.
create table public.nova_access_grants (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 granted_at timestamptz not null default now(), revoked_at timestamptz
);
create table public.nova_profiles (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null unique references auth.users(id) on delete cascade,
 name text not null default 'Nova', personality jsonb not null, baseline jsonb not null,
 engine_version text not null, race_snapshot jsonb, created_at timestamptz not null default now(), unique(id,owner_id)
);
create table public.nova_settings (
 owner_id uuid primary key references public.nova_profiles(owner_id) on delete cascade,
 timezone text not null default 'Europe/Istanbul', quiet_start integer not null default 23 check(quiet_start between 0 and 23),
 quiet_end integer not null default 8 check(quiet_end between 0 and 23),
 proactive_enabled boolean not null default false,
 proactive_daily_limit integer not null default 2 check(proactive_daily_limit between 0 and 4),
 duel_weekly_limit integer not null default 3 check(duel_weekly_limit between 0 and 5),
 memory_enabled boolean not null default true, notifications_enabled boolean not null default false,
 weekly_adaptation_limit numeric not null default .05 check(weekly_adaptation_limit between 0 and .05),
 updated_at timestamptz not null default now()
);
create table public.nova_daily_states (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, nova_id uuid not null,
 local_date date not null, timezone text not null, seed text not null, engine_version text not null,
 day_snapshot jsonb not null, computed_state jsonb, user_score jsonb, nova_score jsonb,
 finalized boolean not null default false, finalized_at timestamptz,
 created_at timestamptz not null default now(), unique(nova_id,local_date), unique(id,owner_id),
 foreign key(nova_id,owner_id) references public.nova_profiles(id,owner_id) on delete cascade
);
create table public.nova_events (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, nova_id uuid not null, day_id uuid not null,
 event_key text not null, kind text not null, starts_at timestamptz not null, ends_at timestamptz not null,
 event_snapshot jsonb not null, created_at timestamptz not null default now(),
 check(ends_at>starts_at), unique(nova_id,event_key),
 foreign key(nova_id,owner_id) references public.nova_profiles(id,owner_id) on delete cascade,
 foreign key(day_id,owner_id) references public.nova_daily_states(id,owner_id) on delete cascade
);
create table public.nova_devices (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.nova_profiles(owner_id) on delete cascade,
 name text not null check(length(name) between 1 and 100), version text, model text,
 model_available boolean not null default false, last_seen_at timestamptz, revoked_at timestamptz,
 created_at timestamptz not null default now(), unique(id,owner_id)
);
create table private.nova_device_credentials (
 device_id uuid primary key references public.nova_devices(id) on delete cascade,
 secret_hash text not null check(secret_hash ~ '^[a-f0-9]{64}$')
);
create table public.nova_pairings (
 id uuid primary key default gen_random_uuid(), owner_id uuid references public.nova_profiles(owner_id) on delete cascade,
 code text not null unique, name text not null, expires_at timestamptz not null,
 approved_at timestamptz, exchanged_at timestamptz, created_at timestamptz not null default now()
);
create table private.nova_pairing_credentials (
 pairing_id uuid primary key references public.nova_pairings(id) on delete cascade,
 challenge_hash text not null unique check(challenge_hash ~ '^[a-f0-9]{64}$')
);
create table public.nova_messages (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, nova_id uuid not null,
 sender text not null check(sender in ('USER','NOVA')), content text not null check(length(content) between 1 and 6000),
 sequence bigint not null check(sequence>0), source_message_id uuid, job_id uuid,
 delivery_status text not null default 'QUEUED' check(delivery_status in ('QUEUED','GENERATING','ANSWERED','FAILED')),
 result jsonb, action_status text check(action_status in ('PENDING','ACCEPTED','REJECTED')),
 created_at timestamptz not null default now(), unique(id,owner_id), unique(nova_id,sequence), unique(source_message_id), unique(job_id),
 foreign key(nova_id,owner_id) references public.nova_profiles(id,owner_id) on delete cascade,
 foreign key(source_message_id,owner_id) references public.nova_messages(id,owner_id)
);
create table public.nova_ai_jobs (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, nova_id uuid not null, source_message_id uuid,
 kind text not null default 'USER_MESSAGE' check(kind in ('USER_MESSAGE','PROACTIVE')),
 status text not null default 'QUEUED' check(status in ('QUEUED','CLAIMED','GENERATING','COMPLETED','FAILED','CANCELLED')),
 request_id uuid, request_payload jsonb, trigger_key text, trigger text, context_hint jsonb,
 device_id uuid, claim_token uuid, lease_expires_at timestamptz,
 attempt_count integer not null default 0, retry_cycle_attempts integer not null default 0, next_attempt_at timestamptz,
 error text, context_version text, context_snapshot jsonb, generation_metrics jsonb,
 expires_at timestamptz, created_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz,
 unique(id,owner_id), unique(owner_id,request_id), unique(nova_id,trigger_key), unique(source_message_id),
 foreign key(nova_id,owner_id) references public.nova_profiles(id,owner_id) on delete cascade,
 foreign key(source_message_id,owner_id) references public.nova_messages(id,owner_id),
 foreign key(device_id,owner_id) references public.nova_devices(id,owner_id),
 check(kind<>'USER_MESSAGE' or (source_message_id is not null and expires_at is null))
);
alter table public.nova_messages add foreign key(job_id,owner_id) references public.nova_ai_jobs(id,owner_id);
create index nova_jobs_queue on public.nova_ai_jobs(nova_id,created_at,id) where status not in ('COMPLETED','CANCELLED');
create table public.nova_memories (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, nova_id uuid not null,
 source_message_id uuid not null, content text not null, source_quote text not null default '',
 type text not null default 'PREFERENCE', tags jsonb not null default '[]', importance integer not null default 50 check(importance between 0 and 100),
 sensitivity text not null default 'normal' check(sensitivity in ('normal','sensitive')),
 status text not null default 'candidate' check(status in ('candidate','active','forgotten','rejected')),
 pinned boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(nova_id,owner_id) references public.nova_profiles(id,owner_id) on delete cascade,
 foreign key(source_message_id,owner_id) references public.nova_messages(id,owner_id),
 check(length(content)<=1000), check(length(source_quote)<=1000)
);
create table private.nova_memory_blocks (
 owner_id uuid not null, source_message_id uuid not null, created_at timestamptz not null default now(),
 primary key(owner_id,source_message_id),
 foreign key(source_message_id,owner_id) references public.nova_messages(id,owner_id) on delete cascade
);
-- A conservative history boundary also suppresses later paraphrases of a
-- forgotten fact in old assistant replies. Visible chat is never deleted.
create table private.nova_context_boundaries (
 owner_id uuid primary key references public.nova_profiles(owner_id) on delete cascade,
 forget_before_at timestamptz not null
);
create table public.nova_relationships (
 owner_id uuid primary key references public.nova_profiles(owner_id) on delete cascade,
 familiarity integer not null default 25 check(familiarity between 0 and 100),
 warmth integer not null default 50 check(warmth between 0 and 100),
 rivalry integer not null default 50 check(rivalry between 0 and 100),
 accepted_duels integer not null default 0, updated_at timestamptz not null default now()
);

create function private.nova_owner_allowed(p_owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_owner is not null
 and exists(select 1 from public.nova_access_grants where owner_id=p_owner and revoked_at is null)
 and exists(select 1 from public.classroom_accounts where id=p_owner and status='approved')
$$;
create function private.nova_require_owner() returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_browser_session() or not private.nova_owner_allowed(auth.uid()) then raise exception 'NOVA_ACCESS_REQUIRED'; end if;
 return auth.uid();
end $$;
create function private.nova_owner_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if old.owner_id is distinct from new.owner_id and not(tg_table_name='nova_pairings' and old.owner_id is null) then raise exception 'NOVA_OWNER_IMMUTABLE'; end if;
 if to_jsonb(old)->'nova_id' is distinct from to_jsonb(new)->'nova_id' then raise exception 'NOVA_OWNER_IMMUTABLE'; end if;
 return new;
end $$;
create function private.nova_messages_page(p_before_seq bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.nova_require_owner();
begin
 return coalesce((select jsonb_agg(to_jsonb(m) order by m.sequence) from
  (select * from public.nova_messages where owner_id=owner and (p_before_seq is null or sequence<p_before_seq)
   order by sequence desc limit 50) m),'[]');
end $$;
create function private.nova_message_source(p_message_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.nova_require_owner();
begin
 return (select to_jsonb(m) from public.nova_messages m where owner_id=owner and id=p_message_id);
end $$;

create function private.nova_proactive_enqueue(p_owner_id uuid,p_key text,p_trigger text,p_expires_at timestamptz,p_context jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.nova_profiles; s public.nova_settings; j public.nova_ai_jobs; local_now timestamp; hour int; day_start timestamptz; week_start timestamptz;
begin
 if not private.nova_owner_allowed(p_owner_id) then raise exception 'NOVA_ACCESS_REQUIRED'; end if;
 if p_key is null or length(p_key) not between 1 and 200 or p_trigger is null or p_trigger not in
 ('morning_checkin','study_start','user_ahead','nova_ahead','poor_exam','focus_duel','day_end')
 or p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '6 hours'
 or octet_length(coalesce(p_context,'{}')::text)>8000 then raise exception 'NOVA_INVALID_INPUT'; end if;
 select * into n from public.nova_profiles where owner_id=p_owner_id for update;
 if n.id is null then raise exception 'NOVA_PROFILE_REQUIRED'; end if;
 select * into j from public.nova_ai_jobs where nova_id=n.id and trigger_key=p_key;
 if j.id is not null then return jsonb_build_object('job_id',j.id,'replayed',true); end if;
 select * into s from public.nova_settings where owner_id=p_owner_id;
 local_now:=clock_timestamp() at time zone s.timezone; hour:=extract(hour from local_now);
 day_start:=date_trunc('day',local_now) at time zone s.timezone;
 week_start:=date_trunc('week',local_now) at time zone s.timezone;
 if not s.proactive_enabled or s.proactive_daily_limit=0 then return jsonb_build_object('skipped','DISABLED'); end if;
 if (s.quiet_start<s.quiet_end and hour>=s.quiet_start and hour<s.quiet_end)
 or (s.quiet_start>s.quiet_end and (hour>=s.quiet_start or hour<s.quiet_end))
 then return jsonb_build_object('skipped','QUIET_HOURS'); end if;
 if exists(select 1 from public.nova_ai_jobs where owner_id=p_owner_id and kind='PROACTIVE' and status in ('QUEUED','CLAIMED','GENERATING'))
 or exists(select 1 from public.nova_ai_jobs previous where previous.owner_id=p_owner_id and previous.kind='PROACTIVE' and previous.status='COMPLETED'
  and not exists(select 1 from public.nova_messages m where m.owner_id=p_owner_id and m.sender='USER' and m.created_at>previous.completed_at))
 then return jsonb_build_object('skipped','AWAITING_REPLY'); end if;
 if (select count(*) from public.nova_ai_jobs where owner_id=p_owner_id and kind='PROACTIVE' and created_at>=day_start)>=s.proactive_daily_limit
 then return jsonb_build_object('skipped','DAILY_LIMIT'); end if;
 if p_trigger='focus_duel' and (select count(*) from public.nova_ai_jobs where owner_id=p_owner_id and trigger='focus_duel' and created_at>=week_start)>=s.duel_weekly_limit
 then return jsonb_build_object('skipped','DUEL_LIMIT'); end if;
 insert into public.nova_ai_jobs(owner_id,nova_id,kind,trigger_key,trigger,expires_at,context_hint)
 values(p_owner_id,n.id,'PROACTIVE',p_key,p_trigger,p_expires_at,p_context) returning * into j;
 return jsonb_build_object('job_id',j.id,'replayed',false);
end $$;

create function private.nova_proactive_allowed(p_owner_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select proactive_enabled and not(
  (quiet_start<quiet_end and extract(hour from clock_timestamp() at time zone timezone)>=quiet_start and extract(hour from clock_timestamp() at time zone timezone)<quiet_end)
  or (quiet_start>quiet_end and (extract(hour from clock_timestamp() at time zone timezone)>=quiet_start or extract(hour from clock_timestamp() at time zone timezone)<quiet_end)))
 from public.nova_settings where owner_id=p_owner_id),false)
$$;
create function private.nova_device_call(p_device_id uuid,p_secret_hash text,p_operation text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.nova_devices; n public.nova_profiles; j public.nova_ai_jobs; source public.nova_messages;
 result jsonb; m uuid; seq bigint; candidate jsonb; content text; quote text; settings public.nova_settings; retry boolean;
begin
 -- Lock participates in revocation: once revocation commits, every operation fails.
 select x.* into d from public.nova_devices x join private.nova_device_credentials c on c.device_id=x.id
 where x.id=p_device_id and c.secret_hash=p_secret_hash and x.revoked_at is null for share of x;
 if d.id is null or not private.nova_owner_allowed(d.owner_id) then raise exception 'NOVA_DEVICE_UNAUTHORIZED'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>64000 then raise exception 'NOVA_INVALID_INPUT'; end if;
 if p_operation='heartbeat' then
  update public.nova_devices set last_seen_at=clock_timestamp(),version=left(p_payload->>'version',80),model=left(p_payload->>'model',120),
   model_available=coalesce((p_payload->>'model_available')::boolean,false) where id=d.id;
  return jsonb_build_object('ok',true);
 end if;
 if p_operation='claim' then
  -- SKIP LOCKED on the conversation owner makes simultaneous workers return no
  -- work instead of claiming a later source before the previous reply commits.
  select * into n from public.nova_profiles where owner_id=d.owner_id for update skip locked;
  if n.id is null then return jsonb_build_object('job',null); end if;
  update public.nova_ai_jobs set status='CANCELLED',claim_token=null,lease_expires_at=null
   where nova_id=n.id and kind='PROACTIVE' and (expires_at<=clock_timestamp() or not private.nova_proactive_allowed(d.owner_id)) and status not in ('COMPLETED','CANCELLED');
  select * into j from public.nova_ai_jobs where nova_id=n.id and status not in ('COMPLETED','CANCELLED')
   order by created_at,id limit 1 for update skip locked;
  if j.id is null or j.status='FAILED' or j.next_attempt_at>clock_timestamp()
  or (j.status in ('CLAIMED','GENERATING') and j.lease_expires_at>clock_timestamp())
  then return jsonb_build_object('job',null); end if;
  update public.nova_ai_jobs set status='CLAIMED',device_id=d.id,claim_token=gen_random_uuid(),
   lease_expires_at=clock_timestamp()+interval '180 seconds',attempt_count=attempt_count+1,retry_cycle_attempts=retry_cycle_attempts+1,next_attempt_at=null,
   started_at=clock_timestamp(),error=null,context_version=null,context_snapshot=null where id=j.id returning * into j;
  update public.nova_messages set delivery_status='GENERATING' where id=j.source_message_id;
  return jsonb_build_object('job',to_jsonb(j));
 end if;
 -- Operations taking both locks always use profile then job, matching enqueue.
 perform 1 from public.nova_profiles where owner_id=d.owner_id for update;
 select * into j from public.nova_ai_jobs where id=(p_payload->>'job_id')::uuid and owner_id=d.owner_id for update;
 if j.id is null or j.device_id is distinct from d.id or j.claim_token is null
 or j.claim_token::text is distinct from p_payload->>'claim_token' then raise exception 'NOVA_LEASE_INVALID'; end if;
 if p_operation='complete' and j.status='COMPLETED' then
  select id into m from public.nova_messages where job_id=j.id;
  if (select x.content from public.nova_messages x where x.id=m) is distinct from p_payload->'result'->>'reply' then raise exception 'NOVA_RESULT_CONFLICT'; end if;
  return jsonb_build_object('message_id',m,'replayed',true);
 end if;
 if not(p_operation='context' and j.status='COMPLETED') and
 (j.status not in ('CLAIMED','GENERATING') or j.lease_expires_at<=clock_timestamp()
 or (j.kind='PROACTIVE' and (j.expires_at<=clock_timestamp() or not private.nova_proactive_allowed(d.owner_id)))) then raise exception 'NOVA_LEASE_INVALID'; end if;
 if p_operation='bind_context' then
  if jsonb_typeof(p_payload->'context') is distinct from 'object' or length(p_payload->>'context_version') not between 1 and 100
  then raise exception 'NOVA_INVALID_CONTEXT'; end if;
  if j.context_snapshot is null then
   update public.nova_ai_jobs set context_snapshot=p_payload->'context',context_version=p_payload->>'context_version' where id=j.id returning * into j;
  elsif j.context_version is distinct from p_payload->>'context_version' or j.context_snapshot is distinct from p_payload->'context' then raise exception 'NOVA_CONTEXT_CONFLICT'; end if;
  return jsonb_build_object('bound_context',j.context_snapshot,'context_version',j.context_version);
 elsif p_operation='renew' then
  update public.nova_ai_jobs set lease_expires_at=clock_timestamp()+interval '180 seconds',status='GENERATING' where id=j.id returning * into j;
  return jsonb_build_object('lease_expires_at',j.lease_expires_at);
 elsif p_operation='context' then
  select * into source from public.nova_messages where id=j.source_message_id;
  return jsonb_build_object('job',to_jsonb(j)-'context_snapshot','bound_context',j.context_snapshot,'context_version',j.context_version,'source_message',to_jsonb(source),'generated_at',clock_timestamp(),
   'profile',(select to_jsonb(x) from public.nova_profiles x where owner_id=d.owner_id),
   'settings',(select to_jsonb(x) from public.nova_settings x where owner_id=d.owner_id),
   'relationship',(select to_jsonb(x) from public.nova_relationships x where owner_id=d.owner_id),
   'days',coalesce((select jsonb_agg(to_jsonb(x) order by x.local_date)
    from (select * from public.nova_daily_states where owner_id=d.owner_id order by local_date desc limit 14) x),'[]'),
   'events',coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at) from
    (select * from public.nova_events where owner_id=d.owner_id and ends_at<=clock_timestamp() order by starts_at desc limit 60) x),'[]'),
   'messages',coalesce((select jsonb_agg(to_jsonb(x)-'result' order by x.sequence) from
    (select m.* from public.nova_messages m where m.owner_id=d.owner_id
     and not exists(select 1 from private.nova_context_boundaries b where b.owner_id=d.owner_id and m.created_at<=b.forget_before_at)
     and (source.id is null or m.sequence<=source.sequence or (m.sender='NOVA' and m.created_at<=j.started_at))
     and not exists(select 1 from private.nova_memory_blocks b where b.owner_id=d.owner_id and (b.source_message_id=m.id or b.source_message_id=m.source_message_id))
     order by m.sequence desc limit 30) x),'[]'),
   'memories',coalesce((select jsonb_agg(to_jsonb(x)) from
    (select * from public.nova_memories where owner_id=d.owner_id and status='active'
     and (select memory_enabled from public.nova_settings where owner_id=d.owner_id)
     order by pinned desc,importance desc,updated_at desc limit 40) x),'[]'),
   'forgotten_source_ids',coalesce((select jsonb_agg(source_message_id) from private.nova_memory_blocks where owner_id=d.owner_id),'[]'));
 elsif p_operation='fail' then
  retry:=coalesce((p_payload->>'retryable')::boolean,false) and j.retry_cycle_attempts<3;
  update public.nova_ai_jobs set status=case when retry then 'QUEUED' else 'FAILED' end,
   error=left(coalesce(p_payload->>'error','GENERATION_FAILED'),200),lease_expires_at=null,claim_token=null,device_id=null,
   context_snapshot=null,context_version=null,
   next_attempt_at=case when retry then clock_timestamp()+make_interval(secs=>30*j.retry_cycle_attempts) else null end
   where id=j.id returning * into j;
  update public.nova_messages set delivery_status=case when retry then 'QUEUED' else 'FAILED' end where id=j.source_message_id;
  return jsonb_build_object('status',j.status,'next_attempt_at',j.next_attempt_at);
 elsif p_operation<>'complete' then raise exception 'NOVA_INVALID_OPERATION'; end if;

 if j.context_snapshot is null then raise exception 'NOVA_CONTEXT_REQUIRED'; end if;
 if j.context_version is distinct from p_payload->>'context_version' then raise exception 'NOVA_CONTEXT_CONFLICT'; end if;
 result:=p_payload->'result'; content:=btrim(result->>'reply');
 if jsonb_typeof(result) is distinct from 'object' or content is null or length(content) not between 1 and 1600
 or content ~ '<[^>]*>' or result->>'intent' is null or result->>'intent' not in ('NONE','OFFER_FOCUS_DUEL','SHARE_PROGRESS','ASK_CHECKIN','ACKNOWLEDGE_RESULT')
 or result->>'expressedEmotion' is null or result->>'expressedEmotion' not in ('CALM','CHEERFUL','TIRED','DETERMINED','STRESSED','DISAPPOINTED')
 or jsonb_typeof(result->'referencedFactIds') is distinct from 'array'
 or jsonb_array_length(result->'referencedFactIds')>16
 or jsonb_typeof(result->'memoryCandidates') is distinct from 'array' or jsonb_array_length(result->'memoryCandidates')>2
 then raise exception 'NOVA_INVALID_RESULT'; end if;
 if exists(select 1 from jsonb_array_elements_text(result->'referencedFactIds') ref where not exists
  (select 1 from jsonb_array_elements(coalesce(j.context_snapshot->'facts','[]')) fact where fact->>'id'=ref))
 then raise exception 'NOVA_INVALID_FACT'; end if;
 if result->'proposedAction' is not null and result->'proposedAction'<>'null'::jsonb then
  if result->'proposedAction'->>'type' is distinct from 'OFFER_FOCUS_DUEL'
  or result->>'intent'<>'OFFER_FOCUS_DUEL'
  or coalesce((result->'proposedAction'->>'durationMinutes')::integer,0) not between 5 and 60 then raise exception 'NOVA_INVALID_ACTION'; end if;
 end if;
 select coalesce(max(sequence),0)+1 into seq from public.nova_messages where nova_id=j.nova_id;
 insert into public.nova_messages(owner_id,nova_id,sender,content,sequence,source_message_id,job_id,delivery_status,result,action_status)
 values(d.owner_id,j.nova_id,'NOVA',content,seq,j.source_message_id,j.id,'ANSWERED',result-'memoryCandidates',
  case when result->'proposedAction' is not null and result->'proposedAction'<>'null'::jsonb then 'PENDING' else null end) returning id into m;
 update public.nova_messages set delivery_status='ANSWERED' where id=j.source_message_id;
 if j.kind='USER_MESSAGE' then
  update public.nova_relationships set familiarity=least(100,familiarity+1),warmth=least(100,warmth+1),updated_at=clock_timestamp() where owner_id=d.owner_id;
 end if;
 update public.nova_ai_jobs set status='COMPLETED',completed_at=clock_timestamp(),context_version=left(p_payload->>'context_version',100),
  generation_metrics=case when jsonb_typeof(p_payload->'metrics')='object' and octet_length((p_payload->'metrics')::text)<=2000 then p_payload->'metrics' else null end
  where id=j.id;
 select * into source from public.nova_messages where id=j.source_message_id;
 select * into settings from public.nova_settings where owner_id=d.owner_id;
 if settings.memory_enabled and source.id is not null and not exists(select 1 from private.nova_memory_blocks where owner_id=d.owner_id and source_message_id=source.id) then
  for candidate in select * from jsonb_array_elements(result->'memoryCandidates') loop
   content:=btrim(candidate->>'content'); quote:=btrim(candidate->>'sourceQuote');
   -- Exact source evidence, pending approval and secret exclusion are all required.
   if candidate->>'sourceMessageId' is distinct from source.id::text
    or content is null or length(content) not between 1 and 1000 or quote is null or length(quote) not between 3 and 1000
    or strpos(lower(source.content),lower(quote))=0 or private.nova_secret_text(content) or private.nova_secret_text(quote)
    or strpos(lower(quote),lower(content))=0 or source.content !~* '(hatırla|hafızana kaydet|aklında tut|bunu kaydet)'
    or candidate->>'sensitivity' is distinct from 'ordinary'
   then continue; end if;
   insert into public.nova_memories(owner_id,nova_id,source_message_id,content,source_quote,type,tags,importance,sensitivity)
   values(d.owner_id,j.nova_id,source.id,content,quote,left(coalesce(candidate->>'type','PREFERENCE'),50),
    case when jsonb_typeof(candidate->'tags')='array' then candidate->'tags' else '[]' end,
    greatest(0,least(100,coalesce((candidate->>'importance')::integer,50))),
    case when candidate->>'sensitivity'='sensitive' then 'sensitive' else 'normal' end);
  end loop;
 end if;
 return jsonb_build_object('message_id',m,'replayed',false);
end $$;

do $$ declare t text; begin
 for t in select tablename from pg_tables where schemaname='public' and tablename like 'nova_%' loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('create policy nova_owner_read on public.%I for select to authenticated using(owner_id=(select auth.uid()) and private.is_browser_session() and private.nova_owner_allowed((select auth.uid())))',t);
  execute format('create trigger nova_immutable_owner before update on public.%I for each row execute function private.nova_owner_immutable()',t);
 end loop;
 for t in select tablename from pg_tables where schemaname='private' and tablename like 'nova_%' loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
grant select on public.nova_access_grants,public.nova_profiles,public.nova_settings,public.nova_devices,
 public.nova_memories,public.nova_relationships to authenticated;
grant select(id,owner_id,nova_id,local_date,timezone,seed,engine_version,created_at,finalized,finalized_at)
 on public.nova_daily_states to authenticated;
grant select(id,owner_id,nova_id,day_id,event_key,kind,starts_at,ends_at,created_at) on public.nova_events to authenticated;
grant select(id,owner_id,nova_id,sender,content,sequence,source_message_id,job_id,delivery_status,action_status,created_at)
 on public.nova_messages to authenticated;
grant select(id,owner_id,nova_id,source_message_id,kind,status,attempt_count,error,created_at,completed_at,expires_at)
 on public.nova_ai_jobs to authenticated;

create function private.nova_access() returns boolean language sql stable security definer set search_path='' as $$
 select private.is_browser_session() and private.nova_owner_allowed(auth.uid())
$$;
create function private.nova_engine_initialize(p_owner_id uuid,p_profile jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result public.nova_profiles;
begin
 if not private.nova_owner_allowed(p_owner_id) then raise exception 'NOVA_ACCESS_REQUIRED'; end if;
 if jsonb_typeof(p_profile) is distinct from 'object' then raise exception 'NOVA_INVALID_INPUT'; end if;
 if not exists(select 1 from pg_timezone_names where name=coalesce(p_profile->>'timezone','Europe/Istanbul')) then raise exception 'NOVA_INVALID_TIMEZONE'; end if;
 insert into public.nova_profiles(owner_id,personality,baseline,engine_version)
 values(p_owner_id,coalesce(p_profile->'personality','{}'),coalesce(p_profile->'baseline','{}'),coalesce(p_profile->>'engine_version','nova-v1'))
 on conflict(owner_id) do nothing;
 select * into result from public.nova_profiles where owner_id=p_owner_id;
 insert into public.nova_settings(owner_id,timezone) values(p_owner_id,coalesce(p_profile->>'timezone','Europe/Istanbul')) on conflict do nothing;
 insert into public.nova_relationships(owner_id) values(p_owner_id) on conflict do nothing;
 return to_jsonb(result);
end $$;
create function private.nova_engine_race(p_owner_id uuid,p_local_date date,p_user_score numeric,p_nova_score numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n public.nova_profiles; previous text; snapshot jsonb; leader text;
begin
 if not private.nova_owner_allowed(p_owner_id) then raise exception 'NOVA_ACCESS_REQUIRED'; end if;
 if p_local_date is null or (p_user_score is not null and p_user_score not between 0 and 100)
 or (p_nova_score is not null and p_nova_score not between 0 and 100) then raise exception 'NOVA_INVALID_SCORE'; end if;
 select * into n from public.nova_profiles where owner_id=p_owner_id for update;
 if n.id is null or not exists(select 1 from public.nova_daily_states where nova_id=n.id and local_date=p_local_date)
 then raise exception 'NOVA_DAY_REQUIRED'; end if;
 previous:=case when n.race_snapshot->>'localDate'=p_local_date::text then n.race_snapshot->>'leader' else null end;
 leader:=case when p_user_score is null or p_nova_score is null then 'unknown'
  when p_user_score>p_nova_score then 'user' when p_nova_score>p_user_score then 'nova' else 'tie' end;
 snapshot:=jsonb_build_object('localDate',p_local_date,'user',p_user_score,'nova',p_nova_score,'leader',leader,'observedAt',clock_timestamp());
 update public.nova_profiles set race_snapshot=snapshot where id=n.id;
 return jsonb_build_object('previousLeader',previous,'race',snapshot);
end $$;
create function private.nova_day_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if old.day_snapshot is distinct from new.day_snapshot or old.local_date<>new.local_date or old.seed<>new.seed
 or old.engine_version<>new.engine_version or old.timezone<>new.timezone then raise exception 'NOVA_DAY_IMMUTABLE'; end if;
 if old.finalized and (to_jsonb(old) is distinct from to_jsonb(new)) then raise exception 'NOVA_DAY_FINALIZED'; end if;
 return new;
end $$;
create trigger nova_day_immutable before update on public.nova_daily_states for each row execute function private.nova_day_immutable();
create function private.nova_engine_day(p_owner_id uuid,p_day jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n public.nova_profiles; d public.nova_daily_states; e jsonb; snapshot jsonb;
begin
 if not private.nova_owner_allowed(p_owner_id) then raise exception 'NOVA_ACCESS_REQUIRED'; end if;
 select * into n from public.nova_profiles where owner_id=p_owner_id for update;
 if n.id is null then raise exception 'NOVA_PROFILE_REQUIRED'; end if;
 snapshot:=p_day-'computedState'-'finalized'-'userScore'-'novaScore';
 if jsonb_typeof(snapshot->'events') is distinct from 'array' or jsonb_array_length(snapshot->'events')>100
 or not exists(select 1 from pg_timezone_names where name=p_day->>'timezone')
 or (p_day->>'startsAt')::timestamptz>=(p_day->>'endsAt')::timestamptz
 then raise exception 'NOVA_INVALID_DAY'; end if;
 insert into public.nova_daily_states(owner_id,nova_id,local_date,timezone,seed,engine_version,day_snapshot)
 values(p_owner_id,n.id,(p_day->>'localDate')::date,p_day->>'timezone',p_day->>'seed',p_day->>'engineVersion',snapshot)
 on conflict(nova_id,local_date) do nothing returning * into d;
 if d.id is not null then
  for e in select * from jsonb_array_elements(snapshot->'events') loop
   insert into public.nova_events(owner_id,nova_id,day_id,event_key,kind,starts_at,ends_at,event_snapshot)
   values(p_owner_id,n.id,d.id,e->>'id',e->>'kind',(e->>'startsAt')::timestamptz,(e->>'endsAt')::timestamptz,e);
  end loop;
 else
  select * into d from public.nova_daily_states where nova_id=n.id and local_date=(p_day->>'localDate')::date for update;
 end if;
 -- Only the stored snapshot can be finalized; new engine/version inputs never replace it.
 if not d.finalized and coalesce((p_day->>'finalized')::boolean,false)
 and d.day_snapshot=snapshot and (d.day_snapshot->>'endsAt')::timestamptz<=clock_timestamp() then
  update public.nova_daily_states set finalized=true,finalized_at=clock_timestamp(),computed_state=p_day->'computedState',
   user_score=p_day->'userScore',nova_score=p_day->'novaScore' where id=d.id returning * into d;
 end if;
 return to_jsonb(d);
end $$;

create function private.nova_safe_day(p_day jsonb) returns jsonb language sql stable set search_path='' as $$
 select (p_day-'inputSnapshot'-'events') || jsonb_build_object('events',coalesce((select jsonb_agg(
  case when (e->>'endsAt')::timestamptz<=clock_timestamp() then e else e-'result'-'stateDelta'-'reasonCodes' end order by e->>'startsAt')
  from jsonb_array_elements(coalesce(p_day->'events','[]')) e),'[]'))
$$;
create function private.nova_read_state(p_owner_id uuid,p_trusted boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not private.nova_owner_allowed(p_owner_id) then raise exception 'NOVA_ACCESS_REQUIRED'; end if;
 return jsonb_build_object('access',true,
 'profile',(select to_jsonb(p) from public.nova_profiles p where owner_id=p_owner_id),
 'settings',(select to_jsonb(s) from public.nova_settings s where owner_id=p_owner_id),
 'relationship',(select to_jsonb(r) from public.nova_relationships r where owner_id=p_owner_id),
 'days',coalesce((select jsonb_agg(case when p_trusted then to_jsonb(d) else
  (to_jsonb(d)-'day_snapshot')||jsonb_build_object('day_snapshot',private.nova_safe_day(d.day_snapshot)) end order by d.local_date)
  from (select * from public.nova_daily_states where owner_id=p_owner_id order by local_date desc limit 14) d),'[]'),
 'events',coalesce((select jsonb_agg(case when p_trusted or e.ends_at<=clock_timestamp() then to_jsonb(e)
  else (to_jsonb(e)-'event_snapshot')||jsonb_build_object('event_snapshot',e.event_snapshot-'result'-'stateDelta'-'reasonCodes') end order by e.starts_at)
  from (select * from public.nova_events where owner_id=p_owner_id order by starts_at desc limit 200) e),'[]'),
 'messages',coalesce((select jsonb_agg(to_jsonb(m) order by m.sequence) from
  (select * from public.nova_messages where owner_id=p_owner_id order by sequence desc limit 100) m),'[]'),
 'jobs',coalesce((select jsonb_agg(to_jsonb(j)-'claim_token'-'request_payload'-'context_hint'-'context_snapshot' order by j.created_at) from
  (select * from public.nova_ai_jobs where owner_id=p_owner_id order by created_at desc limit 100) j),'[]'),
 'memories',coalesce((select jsonb_agg(to_jsonb(m) order by m.pinned desc,m.updated_at desc) from
  (select * from public.nova_memories where owner_id=p_owner_id and status in ('candidate','active') order by pinned desc,updated_at desc limit 100) m),'[]'),
 'forgotten_source_ids',coalesce((select jsonb_agg(source_message_id) from private.nova_memory_blocks where owner_id=p_owner_id),'[]'),
 'devices',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at) from public.nova_devices d where owner_id=p_owner_id),'[]'));
end $$;
create function private.nova_state() returns jsonb language sql security definer set search_path='' as $$
 select private.nova_read_state(private.nova_require_owner(),false)
$$;
create function private.nova_engine_state(p_owner_id uuid) returns jsonb language sql security definer set search_path='' as $$
 select private.nova_read_state(p_owner_id,true)
$$;

create function private.nova_enqueue(p_request_id uuid,p_content text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.nova_require_owner(); n public.nova_profiles; j public.nova_ai_jobs; m uuid; seq bigint; payload jsonb;
begin
 if p_request_id is null or p_content is null or length(btrim(p_content)) not between 1 and 4000 then raise exception 'NOVA_INVALID_INPUT'; end if;
 select * into n from public.nova_profiles where owner_id=owner for update;
 if n.id is null then raise exception 'NOVA_PROFILE_REQUIRED'; end if;
 payload:=jsonb_build_object('content',p_content);
 select * into j from public.nova_ai_jobs where owner_id=owner and request_id=p_request_id;
 if j.id is not null then
  if j.request_payload<>payload then raise exception 'NOVA_IDEMPOTENCY_CONFLICT'; end if;
  return jsonb_build_object('message_id',j.source_message_id,'job_id',j.id,'replayed',true);
 end if;
 if (select count(*) from public.nova_ai_jobs where owner_id=owner and status not in ('COMPLETED','CANCELLED'))>=100 then raise exception 'NOVA_QUEUE_FULL'; end if;
 select coalesce(max(sequence),0)+1 into seq from public.nova_messages where nova_id=n.id;
 insert into public.nova_messages(owner_id,nova_id,sender,content,sequence) values(owner,n.id,'USER',p_content,seq) returning id into m;
 insert into public.nova_ai_jobs(owner_id,nova_id,source_message_id,request_id,request_payload)
 values(owner,n.id,m,p_request_id,payload) returning * into j;
 return jsonb_build_object('message_id',m,'job_id',j.id,'replayed',false);
end $$;
create function private.nova_job_retry(p_job_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.nova_require_owner(); j public.nova_ai_jobs;
begin
 select * into j from public.nova_ai_jobs where id=p_job_id and owner_id=owner for update;
 if j.id is null then raise exception 'NOVA_NOT_FOUND'; end if;
 if j.status<>'FAILED' then raise exception 'NOVA_INVALID_TRANSITION'; end if;
 update public.nova_ai_jobs set status='QUEUED',error=null,claim_token=null,device_id=null,lease_expires_at=null,
  next_attempt_at=null,retry_cycle_attempts=0,context_snapshot=null,context_version=null where id=j.id;
 update public.nova_messages set delivery_status='QUEUED' where id=j.source_message_id;
 return jsonb_build_object('status','QUEUED');
end $$;

create function private.nova_pair_begin(p_challenge_hash text,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.nova_pairings;
begin
 if p_challenge_hash is null or p_challenge_hash !~ '^[a-f0-9]{64}$' or p_name is null or length(btrim(p_name)) not between 1 and 100 then raise exception 'NOVA_INVALID_INPUT'; end if;
 perform pg_advisory_xact_lock(hashtextextended('nova-pair-limit',0));
 delete from public.nova_pairings where expires_at<clock_timestamp()-interval '1 hour';
 if (select count(*) from public.nova_pairings where created_at>clock_timestamp()-interval '10 minutes')>=100 then raise exception 'NOVA_PAIRING_RATE_LIMIT'; end if;
 if exists(select 1 from private.nova_pairing_credentials where challenge_hash=p_challenge_hash) then raise exception 'NOVA_PAIRING_INVALID'; end if;
 insert into public.nova_pairings(code,name,expires_at) values(upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),btrim(p_name),clock_timestamp()+interval '10 minutes') returning * into p;
 insert into private.nova_pairing_credentials(pairing_id,challenge_hash) values(p.id,p_challenge_hash);
 return jsonb_build_object('pairing_id',p.id,'code',p.code,'expires_at',p.expires_at);
end $$;
create function private.nova_pair_approve(p_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.nova_require_owner(); p public.nova_pairings;
begin
 select * into p from public.nova_pairings where code=upper(btrim(p_code)) and expires_at>clock_timestamp() and exchanged_at is null for update;
 if p.id is null or (p.owner_id is not null and p.owner_id<>owner) then raise exception 'NOVA_PAIRING_INVALID'; end if;
 if (select count(*) from public.nova_devices where owner_id=owner and revoked_at is null)>=5 then raise exception 'NOVA_DEVICE_LIMIT'; end if;
 update public.nova_pairings set owner_id=owner,approved_at=clock_timestamp() where id=p.id;
 return jsonb_build_object('pairing_id',p.id,'approved',true,'name',p.name);
end $$;
create function private.nova_pair_exchange(p_pairing_id uuid,p_challenge_hash text,p_secret_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.nova_pairings; device uuid;
begin
 select * into p from public.nova_pairings where id=p_pairing_id for update;
 if p.id is null or p.expires_at<=clock_timestamp() or p.exchanged_at is not null
 or not exists(select 1 from private.nova_pairing_credentials where pairing_id=p.id and challenge_hash=p_challenge_hash)
 or p_secret_hash is null or p_secret_hash !~ '^[a-f0-9]{64}$' then raise exception 'NOVA_PAIRING_INVALID'; end if;
 if p.approved_at is null then raise exception 'NOVA_PAIR_PENDING'; end if;
 if not private.nova_owner_allowed(p.owner_id) then raise exception 'NOVA_ACCESS_REQUIRED'; end if;
 perform 1 from public.nova_profiles where owner_id=p.owner_id for update;
 if (select count(*) from public.nova_devices where owner_id=p.owner_id and revoked_at is null)>=5 then raise exception 'NOVA_DEVICE_LIMIT'; end if;
 insert into public.nova_devices(owner_id,name) values(p.owner_id,p.name) returning id into device;
 insert into private.nova_device_credentials(device_id,secret_hash) values(device,p_secret_hash);
 update public.nova_pairings set exchanged_at=clock_timestamp() where id=p.id;
 return jsonb_build_object('device_id',device,'owner_id',p.owner_id);
end $$;
create function private.nova_device_revoke(p_device_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.nova_require_owner();
begin
 update public.nova_devices set revoked_at=coalesce(revoked_at,clock_timestamp()),model_available=false where id=p_device_id and owner_id=owner;
 if not found then raise exception 'NOVA_NOT_FOUND'; end if;
 update public.nova_ai_jobs set status='QUEUED',claim_token=null,device_id=null,lease_expires_at=null
 where device_id=p_device_id and status in ('CLAIMED','GENERATING');
 return jsonb_build_object('revoked',true);
end $$;

create function private.nova_settings_update(p_settings jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.nova_require_owner(); s public.nova_settings;
begin
 perform 1 from public.nova_profiles where owner_id=owner for update;
 if jsonb_typeof(p_settings) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_settings) k where k not in
 ('timezone','quiet_start','quiet_end','proactive_enabled','proactive_daily_limit','duel_weekly_limit','memory_enabled','notifications_enabled','weekly_adaptation_limit')) then raise exception 'NOVA_INVALID_INPUT'; end if;
 if p_settings ? 'timezone' and not exists(select 1 from pg_timezone_names where name=p_settings->>'timezone') then raise exception 'NOVA_INVALID_TIMEZONE'; end if;
 if p_settings ? 'timezone' and exists(select 1 from public.nova_daily_states where owner_id=owner)
 and (select timezone from public.nova_settings where owner_id=owner) is distinct from p_settings->>'timezone' then raise exception 'NOVA_TIMEZONE_LOCKED'; end if;
 update public.nova_settings set timezone=coalesce(p_settings->>'timezone',timezone),
 quiet_start=coalesce((p_settings->>'quiet_start')::int,quiet_start),quiet_end=coalesce((p_settings->>'quiet_end')::int,quiet_end),
 proactive_enabled=coalesce((p_settings->>'proactive_enabled')::boolean,proactive_enabled),
 proactive_daily_limit=coalesce((p_settings->>'proactive_daily_limit')::int,proactive_daily_limit),
 duel_weekly_limit=coalesce((p_settings->>'duel_weekly_limit')::int,duel_weekly_limit),
 memory_enabled=coalesce((p_settings->>'memory_enabled')::boolean,memory_enabled),
 notifications_enabled=coalesce((p_settings->>'notifications_enabled')::boolean,notifications_enabled),
 weekly_adaptation_limit=coalesce((p_settings->>'weekly_adaptation_limit')::numeric,weekly_adaptation_limit),updated_at=clock_timestamp()
 where owner_id=owner returning * into s;
 if not s.proactive_enabled then
  update public.nova_ai_jobs set status='CANCELLED',claim_token=null,lease_expires_at=null where owner_id=owner and kind='PROACTIVE' and status not in ('COMPLETED','CANCELLED');
 end if;
 if p_settings->>'memory_enabled'='false' then
  update public.nova_ai_jobs set status='QUEUED',claim_token=null,device_id=null,lease_expires_at=null,
   context_snapshot=null,context_version=null where owner_id=owner and status in ('CLAIMED','GENERATING');
  update public.nova_ai_jobs set context_snapshot=null,context_version=null where owner_id=owner and context_snapshot is not null;
 end if;
 return to_jsonb(s);
end $$;
create function private.nova_secret_text(p_content text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(p_content ~* '(password|parola|şifre|sifre|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|session[ _-]?cookie|bearer[ ]|sk-[a-zA-Z0-9]|eyJ[a-zA-Z0-9_-]{10})',false)
$$;
create function private.nova_memory_update(p_memory_id uuid,p_action text,p_content text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.nova_require_owner(); m public.nova_memories;
begin
 perform 1 from public.nova_profiles where owner_id=owner for update;
 select * into m from public.nova_memories where id=p_memory_id and owner_id=owner for update;
 if m.id is null then raise exception 'NOVA_NOT_FOUND'; end if;
 if m.status='forgotten' then raise exception 'NOVA_MEMORY_FORGOTTEN'; end if;
 if p_action in ('forget','reject') then
  insert into private.nova_memory_blocks(owner_id,source_message_id) values(owner,m.source_message_id) on conflict do nothing;
  insert into private.nova_context_boundaries(owner_id,forget_before_at) values(owner,clock_timestamp())
   on conflict(owner_id) do update set forget_before_at=excluded.forget_before_at;
  update public.nova_memories set status='forgotten',content='',source_quote='',tags='[]',pinned=false,updated_at=clock_timestamp()
   where owner_id=owner and source_message_id=m.source_message_id;
  update public.nova_messages set result=result-'memoryCandidates' where owner_id=owner and source_message_id=m.source_message_id;
  -- Discard cached context and revoke in-flight claim capabilities atomically.
  update public.nova_ai_jobs set status=case when source_message_id=m.source_message_id then 'CANCELLED' else 'QUEUED' end,
   claim_token=null,device_id=null,lease_expires_at=null,context_snapshot=null,context_version=null
   where owner_id=owner and status in ('CLAIMED','GENERATING');
  update public.nova_ai_jobs set context_snapshot=null,context_version=null where owner_id=owner and context_snapshot is not null;
  update public.nova_messages set delivery_status='QUEUED' where owner_id=owner and id in
   (select source_message_id from public.nova_ai_jobs where owner_id=owner and status='QUEUED');
 elsif p_action='approve' then
  if m.status<>'candidate' then raise exception 'NOVA_INVALID_TRANSITION'; end if;
  update public.nova_memories set status='active',updated_at=clock_timestamp() where id=m.id;
 elsif p_action='edit' then
  if p_content is null or length(btrim(p_content)) not between 1 and 1000 or private.nova_secret_text(p_content) then raise exception 'NOVA_INVALID_MEMORY'; end if;
  update public.nova_memories set content=btrim(p_content),updated_at=clock_timestamp() where id=m.id;
 elsif p_action in ('pin','unpin') then
  if m.status<>'active' then raise exception 'NOVA_INVALID_TRANSITION'; end if;
  update public.nova_memories set pinned=(p_action='pin'),updated_at=clock_timestamp() where id=m.id;
 else raise exception 'NOVA_INVALID_INPUT'; end if;
 return (select to_jsonb(x) from public.nova_memories x where id=m.id);
end $$;
create function private.nova_duel_decide(p_message_id uuid,p_accept boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner uuid:=private.nova_require_owner(); m public.nova_messages;
begin
 select * into m from public.nova_messages where id=p_message_id and owner_id=owner for update;
 if m.id is null then raise exception 'NOVA_NOT_FOUND'; end if;
 if m.action_status is null or m.result->'proposedAction'->>'type'<>'OFFER_FOCUS_DUEL' then raise exception 'NOVA_INVALID_ACTION'; end if;
 if m.action_status<>'PENDING' then return jsonb_build_object('status',m.action_status,'replayed',true); end if;
 update public.nova_messages set action_status=case when p_accept then 'ACCEPTED' else 'REJECTED' end where id=m.id;
 if p_accept then update public.nova_relationships set accepted_duels=accepted_duels+1,familiarity=least(100,familiarity+1),rivalry=least(100,rivalry+1),updated_at=clock_timestamp() where owner_id=owner; end if;
 return jsonb_build_object('status',case when p_accept then 'ACCEPTED' else 'REJECTED' end,'replayed',false);
end $$;

-- Generate only the enumerated API wrappers. No broad PUBLIC execute survives.
do $$ declare f record; arglist text; role_name text; begin
 for f in select p.oid,p.proname,p.pronargs,pg_get_function_identity_arguments(p.oid) identity_args,
  pg_get_function_arguments(p.oid) declaration_args,pg_get_function_result(p.oid) result_type
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'nova_%' loop
  execute format('revoke all on function private.%I(%s) from public,anon,authenticated,service_role',f.proname,f.identity_args);
  if f.proname in ('nova_access','nova_state','nova_enqueue','nova_job_retry','nova_pair_approve','nova_device_revoke',
   'nova_settings_update','nova_memory_update','nova_duel_decide','nova_messages_page','nova_message_source',
   'nova_engine_initialize','nova_engine_day','nova_engine_state','nova_engine_race','nova_pair_begin','nova_pair_exchange','nova_device_call','nova_proactive_enqueue') then
   select coalesce(string_agg('$'||i,',' order by i),'') into arglist from generate_series(1,f.pronargs) i;
   execute format('create function public.%I(%s) returns %s language sql security invoker set search_path='''' as %L',
    f.proname,f.declaration_args,f.result_type,format('select private.%I(%s)',f.proname,arglist));
   execute format('revoke all on function public.%I(%s) from public,anon,authenticated,service_role',f.proname,f.identity_args);
   role_name:=case when f.proname in ('nova_engine_initialize','nova_engine_day','nova_engine_state','nova_engine_race','nova_pair_begin','nova_pair_exchange','nova_device_call','nova_proactive_enqueue') then 'service_role' else 'authenticated' end;
   execute format('grant execute on function public.%I(%s),private.%I(%s) to %I',f.proname,f.identity_args,f.proname,f.identity_args,role_name);
  end if;
 end loop;
end $$;
grant usage on schema private to service_role;
grant execute on function private.nova_owner_allowed(uuid) to authenticated;
