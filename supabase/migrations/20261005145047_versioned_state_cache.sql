-- Redis stores projections only. PostgreSQL remains the source of both data and
-- cache generations, so a lost Redis invalidation cannot return old study rows.
create table private.state_cache_generations (
 user_id uuid primary key references auth.users(id) on delete cascade,
 generation bigint not null default 1 check (generation>0)
);
create table private.state_cache_global_generation (
 singleton boolean primary key default true check(singleton),
 generation bigint not null default 1 check (generation>0)
);
insert into private.state_cache_global_generation(singleton) values(true);
alter table private.state_cache_generations enable row level security;
alter table private.state_cache_global_generation enable row level security;
revoke all on private.state_cache_generations,private.state_cache_global_generation
 from public,anon,authenticated,service_role;

create function private.bump_state_cache_generation(actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 -- ON DELETE CASCADE runs after auth.users has gone. Never recreate a deleted
 -- account's generation from a child-row deletion trigger.
 if actor is null or not exists(select 1 from auth.users where id=actor) then return;end if;
 insert into private.state_cache_generations(user_id) values(actor)
 on conflict(user_id) do update set generation=state_cache_generations.generation+1;
end $$;
create function private.state_cache_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_actor uuid;after_actor uuid;
begin
 if tg_op='UPDATE' and old is not distinct from new then return new;end if;
 if tg_op<>'INSERT' then before_actor:=(to_jsonb(old)->>tg_argv[0])::uuid;end if;
 if tg_op<>'DELETE' then after_actor:=(to_jsonb(new)->>tg_argv[0])::uuid;end if;
 perform private.bump_state_cache_generation(coalesce(after_actor,before_actor));
 if before_actor is not null and after_actor is not null and before_actor<>after_actor then
  perform private.bump_state_cache_generation(before_actor);
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create function private.state_cache_global_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update private.state_cache_global_generation set generation=generation+1 where singleton;
 return null;
end $$;

-- Table triggers cover browser RPCs, MCP gateways, generated coaching/review
-- tasks, import commits, cascades, and privileged maintenance writes alike.
do $$ declare relation text;begin
 foreach relation in array array[
  'profiles','tasks','topics','topic_history','study_sessions','study_intervals',
  'manual_study_entries','daily_plan_versions','practice_entries','exams',
  'exam_results','journal_entries','day_marks','education_profiles',
  'education_drafts','education_terms','education_courses','course_exam_results',
  'owner_allowlist'
 ] loop
  execute format('create trigger state_cache_changed after insert or update or delete on public.%I for each row execute function private.state_cache_changed(''user_id'')',relation);
  execute format('create trigger state_cache_truncated after truncate on public.%I for each statement execute function private.state_cache_global_changed()',relation);
 end loop;
end $$;
create trigger state_cache_changed after insert or update or delete on public.classroom_accounts
 for each row execute function private.state_cache_changed('id');
create trigger state_cache_truncated after truncate on public.classroom_accounts
 for each statement execute function private.state_cache_global_changed();
create trigger state_cache_global_changed after insert or update or delete or truncate on public.exam_format_versions
 for each statement execute function private.state_cache_global_changed();

create function private.state_cache_version(actor uuid,at_time timestamptz) returns text
language sql stable security definer set search_path='' as $$
 select coalesce((select generation from private.state_cache_generations where user_id=actor),0)::text
  || ':' || (select generation from private.state_cache_global_generation where singleton)::text
  || ':' || (at_time at time zone p.timezone)::date::text
  || ':' || (at_time at time zone 'Europe/Istanbul')::date::text
  || ':' || md5(p.timezone)
 from public.profiles p where p.user_id=actor
$$;
create function private.state_cache_context() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_owner();at_time timestamptz;
begin
 -- A state read initializes today's plan and settles expired countdowns.
 -- Cache hits must perform these same writes before choosing a generation.
 perform private.initialize_owner(actor);
 at_time:=date_trunc('second',clock_timestamp());
 perform private.settle_countdown(actor,at_time);
 return jsonb_build_object('user_id',actor,'version',private.state_cache_version(actor,at_time),'server_now',at_time);
end $$;
create function public.yks_state_cache_context() returns jsonb
language sql security invoker set search_path='' as $$select private.state_cache_context()$$;

create function private.state_cache_snapshot(p_known_version text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;value jsonb;version_after text;attempt integer;
begin
 for attempt in 1..2 loop
  context:=private.state_cache_context();
  if p_known_version is not null and p_known_version=context->>'version' then
   return context||jsonb_build_object('state',null);
  end if;
  value:=public.yks_state();
  version_after:=private.state_cache_version((context->>'user_id')::uuid,(value->>'server_now')::timestamptz);
  -- Existing RPC writers share the owner advisory lock. A privileged writer or
  -- reference-catalog change can bypass it; do not publish a mixed generation.
  if version_after=context->>'version' then
   return jsonb_build_object('user_id',context->'user_id','version',version_after,
    'server_now',value->'server_now','state',value);
  end if;
 end loop;
 raise exception 'CACHE_SNAPSHOT_CHANGED';
end $$;
create function public.yks_state_cache_snapshot(p_known_version text default null) returns jsonb
language sql security invoker set search_path='' as $$select private.state_cache_snapshot(p_known_version)$$;

revoke all on function private.bump_state_cache_generation(uuid),private.state_cache_changed(),
 private.state_cache_global_changed(),private.state_cache_version(uuid,timestamptz),
 private.state_cache_context(),private.state_cache_snapshot(text),
 public.yks_state_cache_context(),public.yks_state_cache_snapshot(text)
 from public,anon,authenticated,service_role;
grant execute on function private.state_cache_context(),private.state_cache_snapshot(text),
 public.yks_state_cache_context(),public.yks_state_cache_snapshot(text) to authenticated;
