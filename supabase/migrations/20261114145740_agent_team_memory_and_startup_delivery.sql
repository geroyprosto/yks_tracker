-- Separate working memories and a bounded, durable inter-agent mailbox.
-- These tables are private. Only the verified server/owner RPCs expose them.
create table private.agent_team_memory (
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null check (agent_id in ('leader','tracking','awareness','strategy','discovery','daily')),
  skill text not null default '' check (octet_length(skill) <= 24000),
  memory jsonb not null default '{}' check (jsonb_typeof(memory) = 'object' and octet_length(memory::text) <= 32768),
  brief text not null default '' check (length(brief) <= 1600),
  result jsonb,
  version bigint not null default 0,
  last_run_id text,
  last_commit_hash text,
  updated_at timestamptz not null default now(),
  primary key (user_id, agent_id),
  check (result is null or (jsonb_typeof(result) = 'object' and (result->>'id') is not distinct from agent_id and octet_length(result::text) <= 24576))
);
create table private.agent_team_messages (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  sender text not null check (sender in ('user','leader','tracking','awareness','strategy','discovery','daily')),
  recipient text not null check (recipient in ('user','leader','tracking','awareness','strategy','discovery','daily')),
  kind text not null check (kind in ('request','answer','observation')),
  body text not null check (length(body) between 1 and 6000),
  parent_id uuid,
  hop integer not null default 0 check (hop between 0 and 4),
  status text not null default 'pending' check (status in ('pending','done')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  primary key (user_id, id),
  foreign key (user_id, parent_id) references private.agent_team_messages(user_id, id),
  check (sender <> recipient),
  check ((sender <> 'user' or recipient = 'leader') and (recipient <> 'user' or sender = 'leader'))
);
create index agent_team_inbox on private.agent_team_messages(user_id, recipient, created_at) where status = 'pending';
create index agent_team_parent on private.agent_team_messages(user_id, parent_id);
create unique index agent_team_one_answer on private.agent_team_messages(user_id, parent_id, sender) where kind = 'answer';
create table private.agent_house_drafts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  report jsonb not null check (octet_length(report::text) <= 196608),
  updated_at timestamptz not null default now()
);
alter table private.agent_team_memory enable row level security;
alter table private.agent_team_messages enable row level security;
alter table private.agent_house_drafts enable row level security;
revoke all on private.agent_team_memory, private.agent_team_messages, private.agent_house_drafts from public, anon, authenticated, service_role;

create function private.agent_team_require_owner(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or not public.mcp_owner_allowed(p_user_id) then raise exception 'OWNER_REQUIRED'; end if;
  if not private.agent_house_eligible(p_user_id) then raise exception 'STUDENT_REQUIRED'; end if;
end $$;

create function private.agent_team_read(p_user_id uuid, p_agent_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare state jsonb; inbox jsonb;
begin
  perform private.agent_team_require_owner(p_user_id);
  if p_agent_id is null or p_agent_id not in ('leader','tracking','awareness','strategy','discovery','daily') then raise exception 'INVALID_AGENT'; end if;
  select jsonb_build_object('agent_id', agent_id, 'skill', skill, 'version', version, 'memory', memory, 'brief', brief,
    'result', result, 'last_run_id', last_run_id, 'updated_at', updated_at) into state
    from private.agent_team_memory where user_id = p_user_id and agent_id = p_agent_id;
  select coalesce(jsonb_agg(to_jsonb(m) - 'user_id' order by m.created_at), '[]') into inbox
    from (select * from private.agent_team_messages where user_id = p_user_id and recipient = p_agent_id
      and status = 'pending' and expires_at > now() order by created_at limit 30) m;
  return coalesce(state, jsonb_build_object('agent_id', p_agent_id, 'skill', '', 'version', 0, 'memory', '{}'::jsonb))
    || jsonb_build_object('inbox', inbox);
end $$;

-- Peers share only deliberately written briefs/results, never their private memory.
create function private.agent_team_briefs(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.agent_team_require_owner(p_user_id);
  return coalesce((select jsonb_agg(jsonb_build_object('agent_id', agent_id, 'brief', brief, 'result', result,
    'version', version, 'updated_at', updated_at) order by agent_id)
    from private.agent_team_memory where user_id = p_user_id), '[]');
end $$;

create function private.agent_team_commit(p_user_id uuid, p_agent_id text, p_commit jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare state private.agent_team_memory; msg jsonb; parent private.agent_team_messages;
  new_id uuid; new_parent uuid; new_hop integer; recipient text; handled uuid; saved private.agent_team_messages;
begin
  perform private.agent_team_require_owner(p_user_id);
  if p_agent_id is null or p_agent_id not in ('leader','tracking','awareness','strategy','discovery','daily') then raise exception 'INVALID_AGENT'; end if;
  if jsonb_typeof(p_commit) is distinct from 'object' or octet_length(p_commit::text) > 98304
    or coalesce(p_commit->>'run_id','') !~ '^[A-Za-z0-9._-]{1,128}$'
    or jsonb_typeof(p_commit->'memory') is distinct from 'object'
    or jsonb_typeof(p_commit->'brief') is distinct from 'string'
    or jsonb_typeof(p_commit->'messages') is distinct from 'array'
    or jsonb_typeof(p_commit->'handled') is distinct from 'array'
    or jsonb_array_length(p_commit->'messages') > 8 or jsonb_array_length(p_commit->'handled') > 30
    then raise exception 'INVALID_INPUT'; end if;
  insert into private.agent_team_memory(user_id, agent_id) values (p_user_id, p_agent_id) on conflict do nothing;
  select * into state from private.agent_team_memory where user_id = p_user_id and agent_id = p_agent_id for update;
  if state.last_run_id = p_commit->>'run_id' then
    if state.last_commit_hash <> md5(p_commit::text) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('version', state.version, 'created', false);
  end if;
  if state.version is distinct from (p_commit->>'version')::bigint then raise exception 'VERSION_CONFLICT'; end if;
  for msg in select value from jsonb_array_elements(p_commit->'messages') loop
    new_id := (msg->>'id')::uuid; new_parent := (msg->>'parent_id')::uuid;
    recipient := msg->>'recipient'; new_hop := 0;
    if recipient is null or recipient = p_agent_id or msg->>'kind' not in ('request','answer','observation') then raise exception 'INVALID_MESSAGE'; end if;
    if new_parent is not null then
      select * into parent from private.agent_team_messages where user_id = p_user_id and id = new_parent;
      if not found or parent.recipient <> p_agent_id then raise exception 'INVALID_PARENT'; end if;
      new_hop := parent.hop + 1;
      if new_hop > 4 then raise exception 'HOP_LIMIT'; end if;
      if msg->>'kind' = 'answer' and recipient <> parent.sender then raise exception 'INVALID_REPLY'; end if;
    elsif msg->>'kind' = 'answer' then raise exception 'INVALID_PARENT'; end if;
    if recipient = 'user' and (p_agent_id <> 'leader' or new_parent is null or parent.sender <> 'user' or msg->>'kind' <> 'answer') then raise exception 'INVALID_REPLY'; end if;
    insert into private.agent_team_messages(user_id,id,sender,recipient,kind,body,parent_id,hop,status)
      values(p_user_id,new_id,p_agent_id,recipient,msg->>'kind',msg->>'body',new_parent,new_hop,
        case when recipient = 'user' then 'done' else 'pending' end) on conflict (user_id,id) do nothing;
    if not found then
      select * into saved from private.agent_team_messages where user_id=p_user_id and id=new_id;
      if saved.sender <> p_agent_id or saved.recipient <> recipient or saved.kind <> msg->>'kind'
        or saved.body <> msg->>'body' or saved.parent_id is distinct from new_parent then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    end if;
    if msg->>'kind' = 'answer' then
      update private.agent_team_messages set status='done' where user_id=p_user_id and id=new_parent;
    end if;
  end loop;
  for handled in select value::uuid from jsonb_array_elements_text(p_commit->'handled') loop
    update private.agent_team_messages m set status='done' where m.user_id=p_user_id and m.id=handled and m.recipient=p_agent_id;
    if not found then raise exception 'INVALID_ACK'; end if;
  end loop;
  update private.agent_team_memory set memory=p_commit->'memory', brief=p_commit->>'brief',
    result=nullif(p_commit->'result','null'::jsonb), version=version+1, last_run_id=p_commit->>'run_id',
    last_commit_hash=md5(p_commit::text), updated_at=now() where user_id=p_user_id and agent_id=p_agent_id;
  return jsonb_build_object('version', state.version+1, 'created', true);
end $$;

create function private.agent_team_chat_send(p_user_id uuid, p_id uuid, p_content text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare existing private.agent_team_messages;
begin
  perform private.agent_team_require_owner(p_user_id);
  -- Serialize per-user submissions for idempotency and the bounded pending queue.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text), 207);
  if p_id is null or p_content is null or length(btrim(p_content)) not between 1 and 4000 then raise exception 'INVALID_INPUT'; end if;
  select * into existing from private.agent_team_messages where user_id=p_user_id and id=p_id;
  if found then
    if existing.sender <> 'user' or existing.body <> p_content then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('id',p_id,'created',false);
  end if;
  if (select count(*) from private.agent_team_messages where user_id=p_user_id and sender='user' and status='pending' and expires_at>now()) >= 10
    then raise exception 'CHAT_PENDING_LIMIT'; end if;
  insert into private.agent_team_messages(user_id,id,sender,recipient,kind,body)
    values(p_user_id,p_id,'user','leader','request',p_content);
  return jsonb_build_object('id',p_id,'created',true);
end $$;
create function private.agent_team_chat_read(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.agent_team_require_owner(p_user_id);
  return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'author',m.sender,'content',m.body,
    'reply_to',m.parent_id,'status',case when m.status='pending' and m.expires_at<=now() then 'expired' else m.status end,
    'created_at',m.created_at) order by m.created_at,m.id)
    from (select * from private.agent_team_messages where user_id=p_user_id and (sender='user' or recipient='user')
      order by created_at desc,id desc limit 60) m),'[]');
end $$;

-- Background workers stage reports. Only the local Windows login publisher promotes them.
create function private.agent_house_stage_for_owner(p_user_id uuid, p_report jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_report jsonb; latest_time timestamptz; report_time timestamptz;
begin
  perform private.agent_team_require_owner(p_user_id);
  perform pg_advisory_xact_lock(hashtext(p_user_id::text), 208);
  if jsonb_typeof(p_report) is distinct from 'object' or p_report->'schema_version' is distinct from '1'::jsonb
    or p_report->>'mode' is distinct from 'live' or coalesce(p_report->>'run_id','') !~ '^[A-Za-z0-9._-]{1,128}$'
    or jsonb_typeof(p_report->'agents') is distinct from 'array' or jsonb_array_length(p_report->'agents') not between 1 and 6
    or octet_length(p_report::text)>196608 then raise exception 'INVALID_INPUT'; end if;
  report_time := (p_report->>'generated_at')::timestamptz;
  if report_time is null or not isfinite(report_time) or report_time > now()+interval '15 minutes' then raise exception 'INVALID_INPUT'; end if;
  select report into current_report from private.agent_house_drafts where user_id=p_user_id;
  if current_report->>'run_id'=p_report->>'run_id' then
    if current_report<>p_report then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('staged',false,'run_id',p_report->>'run_id');
  end if;
  if current_report is not null and (current_report->>'generated_at')::timestamptz>=report_time then raise exception 'STALE_REPORT'; end if;
  select max(generated_at) into latest_time from public.agent_house_reports where user_id=p_user_id and mode='live';
  if latest_time>=report_time then raise exception 'STALE_REPORT'; end if;
  insert into private.agent_house_drafts(user_id,report) values(p_user_id,p_report)
    on conflict(user_id) do update set report=excluded.report,updated_at=now();
  return jsonb_build_object('staged',true,'run_id',p_report->>'run_id');
end $$;
create function private.agent_house_read_draft(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.agent_team_require_owner(p_user_id);
  return (select report from private.agent_house_drafts where user_id=p_user_id);
end $$;
create function private.agent_house_publish_draft(p_user_id uuid, p_run_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare draft jsonb; result jsonb;
begin
  perform private.agent_team_require_owner(p_user_id);
  perform pg_advisory_xact_lock(hashtext(p_user_id::text),208);
  select report into draft from private.agent_house_drafts where user_id=p_user_id for update;
  if not found then return jsonb_build_object('published',false); end if;
  if draft->>'run_id' is distinct from p_run_id then raise exception 'DRAFT_CHANGED'; end if;
  result := private.agent_house_publish_for_owner(p_user_id,draft);
  delete from private.agent_house_drafts where user_id=p_user_id;
  return jsonb_build_object('published',true,'run_id',p_run_id,'created',result->'created');
end $$;

-- Expose only service-role invoker wrappers; keep definer implementations private.
create function public.agent_team_read(p_user_id uuid,p_agent_id text) returns jsonb language sql security invoker set search_path='' as $$ select private.agent_team_read(p_user_id,p_agent_id) $$;
create function public.agent_team_briefs(p_user_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.agent_team_briefs(p_user_id) $$;
create function public.agent_team_commit(p_user_id uuid,p_agent_id text,p_commit jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.agent_team_commit(p_user_id,p_agent_id,p_commit) $$;
create function public.agent_team_chat_send(p_user_id uuid,p_id uuid,p_content text) returns jsonb language sql security invoker set search_path='' as $$ select private.agent_team_chat_send(p_user_id,p_id,p_content) $$;
create function public.agent_team_chat_read(p_user_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.agent_team_chat_read(p_user_id) $$;
create function public.agent_house_stage_for_owner(p_user_id uuid,p_report jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.agent_house_stage_for_owner(p_user_id,p_report) $$;
create function public.agent_house_read_draft(p_user_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.agent_house_read_draft(p_user_id) $$;
create function public.agent_house_publish_draft(p_user_id uuid,p_run_id text) returns jsonb language sql security invoker set search_path='' as $$ select private.agent_house_publish_draft(p_user_id,p_run_id) $$;

do $$
declare signature text; schema_name text;
begin
  foreach signature in array array['agent_team_read(uuid,text)','agent_team_briefs(uuid)','agent_team_commit(uuid,text,jsonb)',
    'agent_team_chat_send(uuid,uuid,text)','agent_team_chat_read(uuid)','agent_house_stage_for_owner(uuid,jsonb)',
    'agent_house_read_draft(uuid)','agent_house_publish_draft(uuid,text)'] loop
    foreach schema_name in array array['private','public'] loop
      execute format('revoke all on function %s.%s from public,anon,authenticated,service_role',schema_name,signature);
      execute format('grant execute on function %s.%s to service_role',schema_name,signature);
    end loop;
  end loop;
end $$;
revoke all on function private.agent_team_require_owner(uuid) from public,anon,authenticated,service_role;
