-- Preserve the immutable engine snapshot while hiding outcomes of unstarted work.
-- Direct event kind access bypasses temporal projection, so expose it only via RPC.
revoke select(kind) on public.nova_events from authenticated;

create function private.nova_safe_event(p_event jsonb,p_now timestamptz) returns jsonb
language sql stable set search_path='' as $$
 select case when (p_event->>'endsAt')::timestamptz<=p_now then p_event
  else (p_event-'result'-'stateDelta'-'reasonCodes') ||
   case when (p_event->>'startsAt')::timestamptz>p_now and p_event->>'kind'='distraction'
    then jsonb_build_object('kind','study','label','Çalışma bloğu') else '{}'::jsonb end end
$$;
revoke all on function private.nova_safe_event(jsonb,timestamptz) from public,anon,authenticated,service_role;

create or replace function private.nova_safe_day(p_day jsonb) returns jsonb
language sql stable set search_path='' as $$
 select (p_day-'inputSnapshot'-'events') || jsonb_build_object('events',coalesce((select jsonb_agg(
  private.nova_safe_event(e,statement_timestamp()) order by e->>'startsAt')
  from jsonb_array_elements(coalesce(p_day->'events','[]')) e),'[]'))
$$;

create or replace function private.nova_read_state(p_owner_id uuid,p_trusted boolean default false) returns jsonb
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
 'events',coalesce((select jsonb_agg(case when p_trusted then to_jsonb(e)
  else (to_jsonb(e)-'kind'-'event_snapshot')||jsonb_build_object(
   'kind',private.nova_safe_event(e.event_snapshot,statement_timestamp())->'kind',
   'event_snapshot',private.nova_safe_event(e.event_snapshot,statement_timestamp())) end order by e.starts_at)
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
