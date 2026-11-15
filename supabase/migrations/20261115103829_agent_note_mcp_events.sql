-- ChatGPT MCP Events: private subscriptions and a transactional, leased outbox.
create table private.agent_event_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^sub_[a-f0-9]{64}$'),
  client_id text not null check (length(client_id) between 1 and 256),
  callback_url text not null check (length(callback_url) <= 2048 and callback_url like 'https://%'),
  secret text not null check (length(secret) between 38 and 100),
  previous_secret text,
  previous_secret_until timestamptz,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id,id)
);
create table private.agent_event_deliveries (
  user_id uuid not null,
  subscription_id text not null,
  message_id uuid not null,
  status text not null default 'pending' check (status in ('pending','delivering','delivered','failed')),
  attempt integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  http_status integer,
  updated_at timestamptz not null default now(),
  primary key (user_id,subscription_id,message_id),
  foreign key (user_id,subscription_id) references private.agent_event_subscriptions(user_id,id) on delete cascade,
  foreign key (user_id,message_id) references private.agent_team_messages(user_id,id) on delete cascade
);
create index agent_event_delivery_ready on private.agent_event_deliveries(user_id,next_attempt_at)
  where status in ('pending','delivering');
create index agent_event_delivery_message on private.agent_event_deliveries(user_id,message_id);
alter table private.agent_event_subscriptions enable row level security;
alter table private.agent_event_deliveries enable row level security;
revoke all on private.agent_event_subscriptions,private.agent_event_deliveries from public,anon,authenticated,service_role;

create function private.agent_note_event_enqueue() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.sender='user' and new.recipient='leader' and new.kind='request' then
    insert into private.agent_event_deliveries(user_id,subscription_id,message_id)
      select new.user_id,s.id,new.id from private.agent_event_subscriptions s
      where s.user_id=new.user_id and s.expires_at>now() on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function private.agent_note_event_enqueue() from public,anon,authenticated,service_role;
create trigger agent_note_event_enqueue after insert on private.agent_team_messages
  for each row execute function private.agent_note_event_enqueue();

create function private.mcp_agent_event_verified(p_user_id uuid,p_id text,p_client_id text,p_secret text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform private.agent_team_require_owner(p_user_id);
  return exists(select 1 from private.agent_event_subscriptions where user_id=p_user_id and id=p_id
    and client_id=p_client_id and secret=p_secret and expires_at>now() and verified_at>now()-interval '10 minutes');
end $$;

create function private.mcp_agent_event_subscribe(p_user_id uuid,p_id text,p_client_id text,p_url text,p_secret text,p_expires_at timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.agent_team_require_owner(p_user_id);
  if p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '8 days' then raise exception 'INVALID_EXPIRY'; end if;
  -- Serialize admission per owner to bound webhook fan-out even under concurrent subscriptions.
  perform 1 from public.owner_allowlist where user_id=p_user_id for update;
  if not exists(select 1 from private.agent_event_subscriptions where user_id=p_user_id and id=p_id)
    and (select count(*) from private.agent_event_subscriptions where user_id=p_user_id and expires_at>now())>=5
    then raise exception 'SUBSCRIPTION_LIMIT'; end if;
  insert into private.agent_event_subscriptions as s(user_id,id,client_id,callback_url,secret,expires_at)
    values(p_user_id,p_id,p_client_id,p_url,p_secret,p_expires_at)
    on conflict(user_id,id) do update set
      previous_secret=case when s.secret<>excluded.secret then s.secret else s.previous_secret end,
      previous_secret_until=case when s.secret<>excluded.secret then now()+interval '5 minutes' else s.previous_secret_until end,
      secret=excluded.secret,expires_at=excluded.expires_at,
      verified_at=case when s.secret<>excluded.secret or s.verified_at<now()-interval '10 minutes' then now() else s.verified_at end
    where s.client_id=excluded.client_id and s.callback_url=excluded.callback_url;
  if not found then raise exception 'SUBSCRIPTION_CONFLICT'; end if;
end $$;

create function private.mcp_agent_event_unsubscribe(p_user_id uuid,p_id text,p_client_id text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.agent_team_require_owner(p_user_id);
  delete from private.agent_event_subscriptions where user_id=p_user_id and id=p_id and client_id=p_client_id;
end $$;

create function private.mcp_agent_event_claim(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item record; result jsonb:='[]'::jsonb;
begin
  perform private.agent_team_require_owner(p_user_id);
  -- Expired/answered notes are never reactivated by event redelivery.
  for item in
    select d.subscription_id,d.message_id,d.attempt,s.callback_url,s.secret,
      case when s.previous_secret_until>now() then s.previous_secret else null end as previous_secret,m.created_at
    from private.agent_event_deliveries d
    join private.agent_event_subscriptions s on s.user_id=d.user_id and s.id=d.subscription_id
    join private.agent_team_messages m on m.user_id=d.user_id and m.id=d.message_id
    where d.user_id=p_user_id and s.expires_at>now() and m.status='pending' and m.expires_at>now()
      and d.attempt<5 and d.next_attempt_at<=now()
      and (d.status='pending' or (d.status='delivering' and d.lease_until<now()))
    order by m.created_at limit 5 for update of d skip locked
  loop
    update private.agent_event_deliveries set status='delivering',attempt=attempt+1,lease_until=now()+interval '60 seconds',updated_at=now()
      where user_id=p_user_id and subscription_id=item.subscription_id and message_id=item.message_id;
    result:=result||jsonb_build_array(jsonb_build_object('id',item.subscription_id,'message_id',item.message_id,
      'attempt',item.attempt+1,'callback_url',item.callback_url,'secret',item.secret,
      'previous_secret',item.previous_secret,'created_at',item.created_at));
  end loop;
  return result;
end $$;

create function private.mcp_agent_event_finish(p_user_id uuid,p_id text,p_message_id uuid,p_attempt integer,p_outcome text,p_http_status integer)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.agent_team_require_owner(p_user_id);
  if p_outcome is null or p_outcome not in ('delivered','failed','retry') then raise exception 'INVALID_OUTCOME'; end if;
  update private.agent_event_deliveries set
    status=case when p_outcome='retry' then case when attempt>=5 then 'failed' else 'pending' end else p_outcome end,
    next_attempt_at=now()+make_interval(secs=>least(300,5*power(2,attempt-1))::integer),
    lease_until=null,http_status=p_http_status,updated_at=now()
    where user_id=p_user_id and subscription_id=p_id and message_id=p_message_id and attempt=p_attempt and status='delivering';
  -- A gone destination must not receive later notes either.
  if found and p_http_status=410 then
    update private.agent_event_subscriptions set expires_at=now() where user_id=p_user_id and id=p_id;
  end if;
end $$;

create function public.mcp_agent_event_verified(p_user_id uuid,p_id text,p_client_id text,p_secret text) returns boolean
language sql security invoker set search_path='' as $$ select private.mcp_agent_event_verified(p_user_id,p_id,p_client_id,p_secret) $$;
create function public.mcp_agent_event_subscribe(p_user_id uuid,p_id text,p_client_id text,p_url text,p_secret text,p_expires_at timestamptz) returns void
language sql security invoker set search_path='' as $$ select private.mcp_agent_event_subscribe(p_user_id,p_id,p_client_id,p_url,p_secret,p_expires_at) $$;
create function public.mcp_agent_event_unsubscribe(p_user_id uuid,p_id text,p_client_id text) returns void
language sql security invoker set search_path='' as $$ select private.mcp_agent_event_unsubscribe(p_user_id,p_id,p_client_id) $$;
create function public.mcp_agent_event_claim(p_user_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.mcp_agent_event_claim(p_user_id) $$;
create function public.mcp_agent_event_finish(p_user_id uuid,p_id text,p_message_id uuid,p_attempt integer,p_outcome text,p_http_status integer) returns void
language sql security invoker set search_path='' as $$ select private.mcp_agent_event_finish(p_user_id,p_id,p_message_id,p_attempt,p_outcome,p_http_status) $$;

do $$ declare signature text; begin
  foreach signature in array array[
    'mcp_agent_event_verified(uuid,text,text,text)','mcp_agent_event_subscribe(uuid,text,text,text,text,timestamptz)',
    'mcp_agent_event_unsubscribe(uuid,text,text)','mcp_agent_event_claim(uuid)',
    'mcp_agent_event_finish(uuid,text,uuid,integer,text,integer)'] loop
    execute 'revoke all on function private.'||signature||' from public,anon,authenticated';
    execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
    execute 'grant execute on function private.'||signature||' to service_role';
    execute 'grant execute on function public.'||signature||' to service_role';
  end loop;
end $$;
