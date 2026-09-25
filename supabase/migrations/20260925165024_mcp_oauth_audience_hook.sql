-- Prepared only. Do not select this function in Authentication > Hooks until a
-- dedicated OAuth client and the final HTTPS MCP URL have been registered.
-- The empty table makes the hook a no-op for every current YKSim web session.
create table private.mcp_oauth_audience_config (
  singleton boolean primary key default true check (singleton),
  client_id text not null unique check (length(btrim(client_id)) between 1 and 2048),
  resource_url text not null check (
    length(resource_url) <= 2048 and
    resource_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/api/mcp$'
  )
);
alter table private.mcp_oauth_audience_config enable row level security;
revoke all on private.mcp_oauth_audience_config from public, anon, authenticated, service_role;

-- Supabase Auth passes the complete original event. Keep every claim as-is
-- except aud for the one explicitly configured OAuth client. In particular,
-- normal password/refresh sessions retain the ordinary "authenticated" aud.
-- Matching claims.client_id is required; a user-controlled value cannot grant
-- MCP access because the OAuth server, not the web client, issues the claim.
create function private.mcp_oauth_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claim_client_id text;
  event_client_id text;
  resource_url text;
begin
  if jsonb_typeof(event) is distinct from 'object' or
     jsonb_typeof(event->'claims') is distinct from 'object' or
     jsonb_typeof(event->'claims'->'aud') is distinct from 'string' then
    return event;
  end if;

  claim_client_id := nullif(btrim(event->'claims'->>'client_id'), '');
  event_client_id := nullif(btrim(event->>'client_id'), '');
  if claim_client_id is null or
     (event_client_id is not null and event_client_id <> claim_client_id) then
    return event;
  end if;

  select config.resource_url into resource_url
  from private.mcp_oauth_audience_config as config
  where config.singleton and config.client_id = claim_client_id;
  if not found then return event; end if;

  return jsonb_set(event, '{claims,aud}', to_jsonb(resource_url), false);
end;
$$;
revoke all on function private.mcp_oauth_access_token_hook(jsonb)
  from public, anon, authenticated, service_role;

-- The hosted Supabase Auth role exists in production. Local embedded-Postgres
-- suites that do not emulate it may still apply this migration safely. Never
-- expose the config table or hook to browser roles or the Data API.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema private to supabase_auth_admin;
    grant select on private.mcp_oauth_audience_config to supabase_auth_admin;
    create policy mcp_oauth_hook_read on private.mcp_oauth_audience_config
      for select to supabase_auth_admin using (true);
    grant execute on function private.mcp_oauth_access_token_hook(jsonb)
      to supabase_auth_admin;
  end if;
end;
$$;
