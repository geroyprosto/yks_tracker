-- Lightweight browser polling. No engine synchronization, profile creation,
-- queue claims or other writes occur here. Both entrypoints check the same
-- approved browser owner/access-grant boundary as nova_state.
create function private.nova_chat_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner uuid:=private.nova_require_owner();
begin
 return jsonb_build_object(
  'server_now',statement_timestamp(),
  'messages',coalesce((select jsonb_agg(jsonb_build_object(
   'id',m.id,'sender',m.sender,'content',m.content,'sequence',m.sequence,
   'source_message_id',m.source_message_id,'job_id',m.job_id,
   'delivery_status',m.delivery_status,'action_status',m.action_status,'created_at',m.created_at,
   'result',case when m.result is null then null else jsonb_build_object('proposedAction',
    case when jsonb_typeof(m.result->'proposedAction')='object' then jsonb_build_object(
     'type',m.result->'proposedAction'->'type','durationMinutes',m.result->'proposedAction'->'durationMinutes')
    else null end) end
   ) order by m.sequence) from
   (select id,sender,content,sequence,source_message_id,job_id,delivery_status,action_status,created_at,result
    from public.nova_messages where owner_id=owner order by sequence desc limit 100) m),'[]'::jsonb),
  'jobs',coalesce((select jsonb_agg(jsonb_build_object(
   'id',j.id,'source_message_id',j.source_message_id,'kind',j.kind,'status',j.status,
   'attempt_count',j.attempt_count,'error',j.error,'created_at',j.created_at,
   'started_at',j.started_at,'completed_at',j.completed_at,'next_attempt_at',j.next_attempt_at,
   'generation_metrics',j.generation_metrics
   ) order by j.created_at,j.id) from
   (select id,source_message_id,kind,status,attempt_count,error,created_at,started_at,completed_at,next_attempt_at,generation_metrics
    from public.nova_ai_jobs where owner_id=owner order by created_at desc,id desc limit 100) j),'[]'::jsonb),
  'devices',coalesce((select jsonb_agg(jsonb_build_object(
   'id',d.id,'name',d.name,'version',d.version,'model',d.model,'model_available',d.model_available,
   'last_seen_at',d.last_seen_at,'revoked_at',d.revoked_at
   ) order by (d.revoked_at is null) desc,d.created_at desc,d.id desc) from
   (select id,name,version,model,model_available,last_seen_at,revoked_at,created_at
    from public.nova_devices where owner_id=owner
    order by (revoked_at is null) desc,created_at desc,id desc limit 25) d),'[]'::jsonb)
 );
end $$;

create function public.nova_chat_state() returns jsonb
language sql stable security invoker set search_path='' as $$
 select private.nova_chat_state()
$$;

revoke all on function public.nova_chat_state(),private.nova_chat_state() from public,anon,authenticated,service_role;
grant execute on function public.nova_chat_state(),private.nova_chat_state() to authenticated;
