-- Friendship is an explicit, mutual opt-in. Only the aggregate projection below
-- crosses student boundaries; no underlying study table gains a friend policy.
create table private.friend_invites (
 id uuid primary key default gen_random_uuid(),
 inviter_id uuid not null references public.classroom_accounts(id) on delete cascade,
 token_hash bytea not null unique check (octet_length(token_hash) = 32),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 used_at timestamptz,
 accepted_by uuid references public.classroom_accounts(id) on delete cascade,
 check (used_at is null or accepted_by is not null)
);
create index friend_invites_inviter on private.friend_invites(inviter_id, created_at desc);

create table private.friendships (
 user_a uuid not null references public.classroom_accounts(id) on delete cascade,
 user_b uuid not null references public.classroom_accounts(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 primary key (user_a, user_b),
 check (user_a < user_b)
);
create index friendships_user_b on private.friendships(user_b, user_a);

alter table private.friend_invites enable row level security;
alter table private.friendships enable row level security;
revoke all on private.friend_invites, private.friendships from public, anon, authenticated, service_role;

create function private.friend_actor() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
 if actor is null or not private.is_browser_session() or not exists (
  select 1 from public.classroom_accounts a
  where a.id = actor and a.role = 'student' and a.status = 'approved'
 ) then
  raise exception 'STUDENT_REQUIRED';
 end if;
 return actor;
end $$;

create function private.friend_invite_create() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.friend_actor(); invite_token text;
 expiry timestamptz := clock_timestamp() + interval '7 days';
begin
 -- Two independent UUIDv4 values provide 244 random bits, represented as
 -- 64 hex characters. Only their SHA-256 digest persists in the database.
 invite_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
 insert into private.friend_invites(inviter_id, token_hash, expires_at)
 values (actor, sha256(decode(invite_token, 'hex')), expiry);
 return jsonb_build_object('token', invite_token, 'expires_at', expiry);
end $$;

create function private.friend_invite_preview(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 if p_token is null or length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$' then
  return null;
 end if;
 select jsonb_build_object('display_name', coalesce(p.display_name, a.name), 'expires_at', i.expires_at)
 into result
 from private.friend_invites i
 join public.classroom_accounts a on a.id = i.inviter_id
 left join public.profiles p on p.user_id = a.id
 where i.token_hash = sha256(decode(p_token, 'hex'))
  and i.used_at is null and i.expires_at > clock_timestamp()
  and a.role = 'student' and a.status = 'approved';
 return result;
end $$;

create function private.friend_invite_accept(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.friend_actor(); invitation private.friend_invites;
 inviter_name text;
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
  raise exception 'INVITE_INVALID';
 end if;
 select i.* into invitation from private.friend_invites i
 join public.classroom_accounts a on a.id = i.inviter_id
 where i.token_hash = sha256(decode(p_token, 'hex'))
  and i.used_at is null and i.expires_at > clock_timestamp()
  and a.role = 'student' and a.status = 'approved'
 for update of i;
 if not found then raise exception 'INVITE_INVALID'; end if;
 if invitation.inviter_id = actor then raise exception 'SELF_INVITE'; end if;
 select coalesce(p.display_name, a.name) into inviter_name from public.classroom_accounts a
 left join public.profiles p on p.user_id = a.id
 where a.id = invitation.inviter_id and a.role = 'student' and a.status = 'approved';
 if not found then raise exception 'INVITE_INVALID'; end if;
 insert into private.friendships(user_a, user_b)
 values (least(actor, invitation.inviter_id), greatest(actor, invitation.inviter_id))
 on conflict do nothing;
 if not found then raise exception 'ALREADY_FRIENDS'; end if;
 update private.friend_invites i
 set used_at = clock_timestamp(), accepted_by = actor where i.id = invitation.id;
 return jsonb_build_object('friend_id', invitation.inviter_id, 'display_name', inviter_name);
end $$;

create function private.friend_remove(p_friend_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.friend_actor();
begin
 delete from private.friendships f
 where f.user_a = least(actor, p_friend_id) and f.user_b = greatest(actor, p_friend_id);
 return found;
end $$;

-- Calculate time from saved intervals, clipping open intervals at the current
-- time (and a running countdown at its configured end). Date-only manual and
-- practice records, and completed tasks, use their stored date labels because
-- they contain no clock time that could be converted to the viewer's timezone.
create function private.friend_score(
 p_user_id uuid, p_today date, p_week_date date,
 p_today_start timestamptz, p_week_start timestamptz, p_now timestamptz
) returns jsonb
language sql stable security invoker set search_path = '' as $$
 with interval_totals as (
  select
   coalesce(sum(greatest(0, extract(epoch from least(
    coalesce(i.ended_at, p_now), p_now,
    case when i.ended_at is null and s.mode = 'countdown' then
      s.active_since + make_interval(secs => greatest(0, s.target_seconds - s.accumulated_seconds))
    else p_now end
   ) - greatest(i.started_at, p_today_start)))), 0)::bigint as today_seconds,
   coalesce(sum(greatest(0, extract(epoch from least(
    coalesce(i.ended_at, p_now), p_now,
    case when i.ended_at is null and s.mode = 'countdown' then
      s.active_since + make_interval(secs => greatest(0, s.target_seconds - s.accumulated_seconds))
    else p_now end
   ) - greatest(i.started_at, p_week_start)))), 0)::bigint as week_seconds
  from public.study_intervals i
  join public.study_sessions s on s.id = i.session_id and s.user_id = i.user_id
  where i.user_id = p_user_id and i.started_at < p_now
   and coalesce(i.ended_at, p_now) > p_week_start
 ),
 manual_totals as (
  select
   coalesce(sum(m.duration_seconds) filter (where m.study_date = p_today), 0)::bigint as today_seconds,
   coalesce(sum(m.duration_seconds), 0)::bigint as week_seconds
  from public.manual_study_entries m
  where m.user_id = p_user_id and m.study_date between p_week_date and p_today
 ),
 practice_totals as (
  select
   coalesce(sum(p.question_count) filter (where p.practice_date = p_today), 0)::bigint as today_questions,
   coalesce(sum(p.question_count), 0)::bigint as week_questions,
   coalesce(sum(p.test_count) filter (where p.practice_date = p_today), 0)::bigint as today_tests,
   coalesce(sum(p.test_count), 0)::bigint as week_tests
  from public.practice_entries p
  where p.user_id = p_user_id and p.practice_date between p_week_date and p_today
 ),
 task_totals as (
  select
   count(*) filter (where t.plan_date = p_today)::bigint as today_tasks,
   count(*)::bigint as week_tasks
  from public.tasks t
  where t.user_id = p_user_id and t.plan_date between p_week_date and p_today
   and t.progress = 1
 )
 select jsonb_build_object(
  'user_id', a.id, 'display_name', coalesce(profile.display_name, a.name),
  'today_seconds', i.today_seconds + m.today_seconds,
  'week_seconds', i.week_seconds + m.week_seconds,
  'today_questions', p.today_questions, 'week_questions', p.week_questions,
  'today_tests', p.today_tests, 'week_tests', p.week_tests,
  'today_tasks', t.today_tasks, 'week_tasks', t.week_tasks
 )
 from public.classroom_accounts a
 left join public.profiles profile on profile.user_id = a.id
 cross join interval_totals i cross join manual_totals m
 cross join practice_totals p cross join task_totals t
 where a.id = p_user_id and a.role = 'student' and a.status = 'approved'
$$;

create function private.friend_competition_state() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.friend_actor(); viewer_tz text;
 at_time timestamptz := clock_timestamp(); local_today date; local_monday date;
 today_start timestamptz; week_start timestamptz; scores jsonb;
begin
 select coalesce(p.timezone, 'Europe/Istanbul') into viewer_tz
 from public.profiles p where p.user_id = actor;
 viewer_tz := coalesce(viewer_tz, 'Europe/Istanbul');
 local_today := (at_time at time zone viewer_tz)::date;
 local_monday := local_today - (extract(isodow from local_today)::int - 1);
 today_start := local_today::timestamp at time zone viewer_tz;
 week_start := local_monday::timestamp at time zone viewer_tz;
 select coalesce(jsonb_agg(
  private.friend_score(a.id, local_today, local_monday, today_start, week_start, at_time)
  order by coalesce(p.display_name, a.name), a.id
 ), '[]'::jsonb) into scores
 from private.friendships f
 join public.classroom_accounts a on a.id = case when f.user_a = actor then f.user_b else f.user_a end
 left join public.profiles p on p.user_id = a.id
 where (f.user_a = actor or f.user_b = actor)
  and a.role = 'student' and a.status = 'approved';
 return jsonb_build_object(
  'today', local_today, 'week_start', local_monday,
  'me', private.friend_score(actor, local_today, local_monday, today_start, week_start, at_time),
  'friends', scores
 );
end $$;

-- Public RPC names are stable for supabase.rpc(). The privileged work is
-- isolated in private functions, with an empty search_path and explicit grants.
create function public.friend_competition_state() returns jsonb
language sql security invoker set search_path = '' as $$
 select private.friend_competition_state()
$$;
create function public.friend_invite_create() returns jsonb
language sql security invoker set search_path = '' as $$
 select private.friend_invite_create()
$$;
create function public.friend_invite_preview(p_token text) returns jsonb
language sql security invoker set search_path = '' as $$
 select private.friend_invite_preview(p_token)
$$;
create function public.friend_invite_accept(p_token text) returns jsonb
language sql security invoker set search_path = '' as $$
 select private.friend_invite_accept(p_token)
$$;
create function public.friend_remove(p_friend_id uuid) returns boolean
language sql security invoker set search_path = '' as $$
 select private.friend_remove(p_friend_id)
$$;

revoke all on function private.friend_actor(), private.friend_invite_create(),
 private.friend_invite_preview(text), private.friend_invite_accept(text),
 private.friend_remove(uuid), private.friend_competition_state(),
 private.friend_score(uuid,date,date,timestamptz,timestamptz,timestamptz)
 from public, anon, authenticated, service_role;
grant execute on function private.friend_invite_create(), private.friend_invite_accept(text),
 private.friend_remove(uuid), private.friend_competition_state() to authenticated;
grant execute on function private.friend_invite_preview(text) to anon, authenticated;

revoke all on function public.friend_competition_state(), public.friend_invite_create(),
 public.friend_invite_preview(text), public.friend_invite_accept(text), public.friend_remove(uuid)
 from public, anon, authenticated, service_role;
grant execute on function public.friend_competition_state(), public.friend_invite_create(),
 public.friend_invite_accept(text), public.friend_remove(uuid) to authenticated;
grant execute on function public.friend_invite_preview(text) to anon, authenticated;
