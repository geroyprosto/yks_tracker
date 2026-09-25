-- Keep Supabase OAuth access tokens out of the browser Data API. The MCP server
-- verifies a bearer token, then uses a separate server-only service key below.
-- An ordinary email/password web JWT has no client_id and keeps its existing RLS.
create function private.is_browser_session()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.client_id', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id'
  ) is null
$$;
revoke all on function private.is_browser_session() from public, anon, authenticated, service_role;
grant execute on function private.is_browser_session() to authenticated;

create or replace function private.require_owner()
returns uuid language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid();
begin
  if not private.is_browser_session() or owner_id is null or
     not exists (select 1 from public.owner_allowlist where user_id = owner_id) then
    raise exception 'OWNER_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  return owner_id;
end;
$$;

-- Every owner data table that currently permits direct authenticated SELECT
-- receives a restrictive policy. It composes with the existing owner policies;
-- OAuth client JWTs cannot query private rows through PostgREST.
do $$
declare row record;
begin
  for row in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    execute format(
      'create policy mcp_oauth_browser_only on %I.%I as restrictive for all to authenticated using (private.is_browser_session()) with check (private.is_browser_session())',
      row.schema_name, row.table_name
    );
  end loop;
end;
$$;

-- Supabase Storage may be absent from embedded SQL tests. Existing policies
-- still enforce owner UID and bucket path for normal browser uploads/downloads.
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'create policy mcp_oauth_browser_only on storage.objects as restrictive for all to authenticated
      using (bucket_id <> ''exam-documents'' or private.is_browser_session())
      with check (bucket_id <> ''exam-documents'' or private.is_browser_session())';
  end if;
end;
$$;

-- Only server-held service_role credentials may call these RPCs. The server
-- supplies p_user_id only after verifying JWT signature, aud, client_id, active
-- Auth user and the owner allowlist. No OAuth bearer is passed to PostgREST.
create function public.mcp_owner_allowed(p_user_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  return p_user_id is not null and exists (
    select 1 from public.owner_allowlist where user_id = p_user_id
  );
end;
$$;
revoke all on function public.mcp_owner_allowed(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_owner_allowed(uuid) to service_role;

-- Supabase auth.uid() reads the request claim sub. Save and restore both
-- PostgREST claim formats so nested owner-checked functions see this owner
-- only during the current service-role transaction.
create function public.mcp_owner_state(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  prior_sub text := current_setting('request.jwt.claim.sub', true);
  prior_claims text := current_setting('request.jwt.claims', true);
  claims jsonb := coalesce(nullif(prior_claims, '')::jsonb, '{}'::jsonb);
  value jsonb;
begin
  perform private.analysis_require_target_owner(p_user_id);
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claims',
    (claims || jsonb_build_object('sub', p_user_id::text))::text, true);
  value := public.yks_state();
  perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
  return value;
exception when others then
  perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
  raise;
end;
$$;
revoke all on function public.mcp_owner_state(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_owner_state(uuid) to service_role;

create function public.mcp_owner_command(
  p_user_id uuid, request_id uuid, command_type text, payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  prior_sub text := current_setting('request.jwt.claim.sub', true);
  prior_claims text := current_setting('request.jwt.claims', true);
  claims jsonb := coalesce(nullif(prior_claims, '')::jsonb, '{}'::jsonb);
  receipt jsonb;
begin
  if command_type is null or command_type not in (
    'task.create', 'manual_study.create', 'exam.create', 'topic.update'
  ) then raise exception 'INVALID_INPUT'; end if;
  perform private.analysis_require_target_owner(p_user_id);
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claims',
    (claims || jsonb_build_object('sub', p_user_id::text))::text, true);
  receipt := public.yks_command(request_id, command_type, payload);
  if receipt->'replayed' is distinct from 'true'::jsonb then
    insert into public.audit_log(user_id, entity, entity_id, action, new_value, source)
    values (p_user_id, 'mcp_call', nullif(receipt->>'id', '')::uuid,
      command_type, jsonb_build_object('request_id', request_id), 'mcp');
  end if;
  perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
  return receipt;
exception when others then
  perform set_config('request.jwt.claim.sub', coalesce(prior_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(prior_claims, ''), true);
  raise;
end;
$$;
revoke all on function public.mcp_owner_command(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_owner_command(uuid, uuid, text, jsonb) to service_role;
