-- A friendship remains a separate, consensual group; overlapping pairs are
-- never merged transitively. Groups retain one calendar timezone for fair
-- comparisons even when members have different profile timezones.
create table private.friend_groups (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.classroom_accounts(id) on delete cascade,
 name text not null check (length(btrim(name)) between 1 and 160),
 timezone text not null check (length(timezone) between 1 and 100),
 created_at timestamptz not null default clock_timestamp()
);
create table private.friend_group_members (
 group_id uuid not null references private.friend_groups(id) on delete cascade,
 user_id uuid not null references public.classroom_accounts(id) on delete cascade,
 joined_at timestamptz not null default clock_timestamp(),
 primary key (group_id, user_id)
);
create index friend_group_members_user on private.friend_group_members(user_id, joined_at, group_id);
alter table private.friend_groups enable row level security;
alter table private.friend_group_members enable row level security;
revoke all on private.friend_groups, private.friend_group_members
 from public, anon, authenticated, service_role;

-- Preserve each accepted pair as its own two-member group. The earliest
-- consumed pair invitation identifies the original inviter/owner when known;
-- older pairs without invitation history fall back to the lower UUID.
do $$
declare pair record; new_group_id uuid;
begin
 for pair in
  select f.user_a, f.user_b, f.created_at,
   coalesce(consumed.inviter_id, f.user_a) as owner_id,
   coalesce(p.display_name, a.name) as owner_name,
   coalesce(p.timezone, 'Europe/Istanbul') as owner_timezone
  from private.friendships f
  left join lateral (
   select i.inviter_id from private.friend_invites i
   where i.used_at is not null and
    ((i.inviter_id = f.user_a and i.accepted_by = f.user_b) or
     (i.inviter_id = f.user_b and i.accepted_by = f.user_a))
   order by i.used_at, i.created_at, i.id limit 1
  ) consumed on true
  join public.classroom_accounts a on a.id = coalesce(consumed.inviter_id, f.user_a)
  left join public.profiles p on p.user_id = a.id
  order by f.created_at, f.user_a, f.user_b
 loop
  insert into private.friend_groups(owner_id, name, timezone, created_at)
  values (pair.owner_id, pair.owner_name || ' ve arkadaşları', pair.owner_timezone, pair.created_at)
  returning id into new_group_id;
  insert into private.friend_group_members(group_id, user_id, joined_at)
  values (new_group_id, pair.user_a, pair.created_at),
   (new_group_id, pair.user_b, pair.created_at);
 end loop;
end $$;

-- Pair links did not authorize joining an entire group, so every old token
-- becomes invalid. New invitations are bound to one specific group.
delete from private.friend_invites;
alter table private.friend_invites add column group_id uuid not null
 references private.friend_groups(id) on delete cascade;
create index friend_invites_group on private.friend_invites(group_id, created_at desc);

drop function public.friend_competition_state();
drop function public.friend_invite_create();
drop function public.friend_remove(uuid);
drop function private.friend_competition_state();
drop function private.friend_invite_create();
drop function private.friend_remove(uuid);
-- Keep historical pair rows for audit/compatibility; all live reads and
-- mutations now use friend_group_members exclusively.

create function private.friend_invite_create(p_group_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.friend_actor(); chosen private.friend_groups;
 invite_token text; expiry timestamptz := clock_timestamp() + interval '7 days';
 owner_name text; owner_timezone text;
begin
 perform pg_advisory_xact_lock(hashtextextended(actor::text, 6001));
 if p_group_id is not null then
  select g.* into chosen from private.friend_groups g
  join private.friend_group_members m on m.group_id = g.id
  where g.id = p_group_id and m.user_id = actor for update of g;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
 else
  select g.* into chosen from private.friend_groups g
  join private.friend_group_members m on m.group_id = g.id
  where m.user_id = actor order by g.created_at, g.id limit 1 for update of g;
  if not found then
   select coalesce(p.display_name, a.name), coalesce(p.timezone, 'Europe/Istanbul')
   into owner_name, owner_timezone from public.classroom_accounts a
   left join public.profiles p on p.user_id = a.id where a.id = actor;
   insert into private.friend_groups(owner_id, name, timezone)
   values (actor, owner_name || ' ve arkadaşları', owner_timezone)
   returning * into chosen;
   insert into private.friend_group_members(group_id, user_id)
   values (chosen.id, actor);
  end if;
 end if;
 invite_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
 insert into private.friend_invites(inviter_id, group_id, token_hash, expires_at)
 values (actor, chosen.id, sha256(decode(invite_token, 'hex')), expiry);
 return jsonb_build_object('token', invite_token, 'expires_at', expiry,
  'group_id', chosen.id, 'group_name', chosen.name);
end $$;

create or replace function private.friend_invite_preview(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 if p_token is null or length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$' then
  return null;
 end if;
 select jsonb_build_object(
  'display_name', coalesce(p.display_name, a.name),
  'expires_at', i.expires_at,
  'group_name', g.name,
  'member_count', (
   select count(*) from private.friend_group_members members
   join public.classroom_accounts participant on participant.id = members.user_id
   where members.group_id = g.id
    and participant.role = 'student' and participant.status = 'approved'
  )
 ) into result
 from private.friend_invites i
 join private.friend_groups g on g.id = i.group_id
 join private.friend_group_members inviter_member
  on inviter_member.group_id = g.id and inviter_member.user_id = i.inviter_id
 join public.classroom_accounts a on a.id = i.inviter_id
 left join public.profiles p on p.user_id = a.id
 where i.token_hash = sha256(decode(p_token, 'hex'))
  and i.used_at is null and i.expires_at > clock_timestamp()
  and a.role = 'student' and a.status = 'approved';
 return result;
end $$;

create or replace function private.friend_invite_accept(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.friend_actor(); invitation private.friend_invites;
 chosen private.friend_groups; target_group_id uuid; inviter_name text;
begin
 if p_token is null or length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$' then
  raise exception 'INVITE_INVALID';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text, 6001));
 select i.group_id into target_group_id from private.friend_invites i
 where i.token_hash = sha256(decode(p_token, 'hex'))
  and i.used_at is null and i.expires_at > clock_timestamp();
 if not found then raise exception 'INVITE_INVALID'; end if;
 select g.* into chosen from private.friend_groups g where g.id = target_group_id for update;
 if not found then raise exception 'INVITE_INVALID'; end if;
 select i.* into invitation from private.friend_invites i
 join private.friend_group_members m
  on m.group_id = i.group_id and m.user_id = i.inviter_id
 join public.classroom_accounts a on a.id = i.inviter_id
 where i.token_hash = sha256(decode(p_token, 'hex'))
  and i.group_id = chosen.id
  and i.used_at is null and i.expires_at > clock_timestamp()
  and a.role = 'student' and a.status = 'approved'
 for update of i;
 if not found then raise exception 'INVITE_INVALID'; end if;
 if invitation.inviter_id = actor then raise exception 'SELF_INVITE'; end if;
 select coalesce(p.display_name, a.name) into inviter_name
 from public.classroom_accounts a left join public.profiles p on p.user_id = a.id
 where a.id = invitation.inviter_id;
 insert into private.friend_group_members(group_id, user_id)
 values (chosen.id, actor) on conflict do nothing;
 if not found then raise exception 'ALREADY_FRIENDS'; end if;
 update private.friend_invites i set used_at = clock_timestamp(), accepted_by = actor
 where i.id = invitation.id;
 return jsonb_build_object('friend_id', invitation.inviter_id,
  'display_name', inviter_name, 'group_id', chosen.id, 'group_name', chosen.name);
end $$;

create function private.friend_remove(p_friend_id uuid, p_group_id uuid default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.friend_actor(); chosen private.friend_groups;
 successor uuid; successor_name text;
begin
 perform pg_advisory_xact_lock(hashtextextended(actor::text, 6001));
 if p_group_id is not null then
  select g.* into chosen from private.friend_groups g
  join private.friend_group_members m on m.group_id = g.id
  where g.id = p_group_id and m.user_id = actor for update of g;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
 else
  select g.* into chosen from private.friend_groups g
  join private.friend_group_members m on m.group_id = g.id
  where m.user_id = actor order by g.created_at, g.id limit 1 for update of g;
  if not found then return false; end if;
 end if;
 if p_friend_id is null then return false; end if;
 if p_friend_id <> actor and chosen.owner_id <> actor then
  raise exception 'GROUP_OWNER_REQUIRED';
 end if;
 delete from private.friend_group_members m
 where m.group_id = chosen.id and m.user_id = p_friend_id;
 if not found then return false; end if;
 -- A removed member's unused outgoing links must not re-admit others.
 update private.friend_invites i set expires_at = clock_timestamp()
 where i.group_id = chosen.id and i.inviter_id = p_friend_id
  and i.used_at is null and i.expires_at > clock_timestamp();
 if p_friend_id = chosen.owner_id then
  select m.user_id, coalesce(p.display_name, a.name)
  into successor, successor_name
  from private.friend_group_members m
  join public.classroom_accounts a on a.id = m.user_id
  left join public.profiles p on p.user_id = a.id
  where m.group_id = chosen.id
  order by case when a.role = 'student' and a.status = 'approved' then 0 else 1 end,
   m.joined_at, m.user_id limit 1;
  if successor is null then
   delete from private.friend_groups g where g.id = chosen.id;
  else
   update private.friend_groups g
   set owner_id = successor, name = successor_name || ' ve arkadaşları'
   where g.id = chosen.id;
  end if;
 end if;
 return true;
end $$;

-- The existing score projection clips timed intervals to these group-local
-- boundaries. Manual/practice/task rows have date labels only, so they match
-- group-local dates without pretending their original instant is known.
create function private.friend_competition_state(p_group_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.friend_actor(); chosen private.friend_groups;
 viewer_tz text; score_tz text; at_time timestamptz := clock_timestamp();
 local_today date; local_monday date; today_start timestamptz;
 week_start timestamptz; scores jsonb; group_list jsonb; member_total bigint;
begin
 select coalesce(p.timezone, 'Europe/Istanbul') into viewer_tz
 from public.profiles p where p.user_id = actor;
 viewer_tz := coalesce(viewer_tz, 'Europe/Istanbul');
 select coalesce(jsonb_agg(jsonb_build_object(
  'id', memberships.id, 'name', memberships.name,
  'owner_id', memberships.owner_id, 'member_count', memberships.member_count
 ) order by memberships.created_at, memberships.id), '[]'::jsonb)
 into group_list from (
  select g.id, g.name, g.owner_id, g.created_at,
   (select count(*) from private.friend_group_members m2
    join public.classroom_accounts a2 on a2.id = m2.user_id
    where m2.group_id = g.id and a2.role = 'student' and a2.status = 'approved')
   as member_count
  from private.friend_group_members mine
  join private.friend_groups g on g.id = mine.group_id
  where mine.user_id = actor
 ) memberships;
 if p_group_id is not null then
  select g.* into chosen from private.friend_groups g
  join private.friend_group_members m on m.group_id = g.id
  where g.id = p_group_id and m.user_id = actor;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
 else
  select g.* into chosen from private.friend_groups g
  join private.friend_group_members m on m.group_id = g.id
  where m.user_id = actor order by g.created_at, g.id limit 1;
 end if;
 score_tz := coalesce(chosen.timezone, viewer_tz);
 local_today := (at_time at time zone score_tz)::date;
 local_monday := local_today - (extract(isodow from local_today)::int - 1);
 today_start := local_today::timestamp at time zone score_tz;
 week_start := local_monday::timestamp at time zone score_tz;
 if chosen.id is null then
  scores := '[]'::jsonb;
 else
  select count(*) into member_total from private.friend_group_members m
  join public.classroom_accounts a on a.id = m.user_id
  where m.group_id = chosen.id and a.role = 'student' and a.status = 'approved';
  select coalesce(jsonb_agg(
   private.friend_score(a.id, local_today, local_monday, today_start, week_start, at_time)
   order by coalesce(p.display_name, a.name), a.id
  ), '[]'::jsonb) into scores
  from private.friend_group_members m
  join public.classroom_accounts a on a.id = m.user_id
  left join public.profiles p on p.user_id = a.id
  where m.group_id = chosen.id and m.user_id <> actor
   and a.role = 'student' and a.status = 'approved';
 end if;
 return jsonb_build_object(
  'today', local_today, 'week_start', local_monday,
  'me', private.friend_score(actor, local_today, local_monday, today_start, week_start, at_time),
  'friends', scores, 'groups', group_list,
  'group', case when chosen.id is null then null else jsonb_build_object(
   'id', chosen.id, 'name', chosen.name, 'owner_id', chosen.owner_id,
   'member_count', member_total, 'timezone', chosen.timezone
  ) end
 );
end $$;

create function public.friend_competition_state(p_group_id uuid default null) returns jsonb
language sql security invoker set search_path = '' as $$
 select private.friend_competition_state(p_group_id)
$$;
create function public.friend_invite_create(p_group_id uuid default null) returns jsonb
language sql security invoker set search_path = '' as $$
 select private.friend_invite_create(p_group_id)
$$;
create function public.friend_remove(p_friend_id uuid, p_group_id uuid default null) returns boolean
language sql security invoker set search_path = '' as $$
 select private.friend_remove(p_friend_id, p_group_id)
$$;

revoke all on function private.friend_invite_create(uuid),
 private.friend_remove(uuid,uuid), private.friend_competition_state(uuid)
 from public, anon, authenticated, service_role;
grant execute on function private.friend_invite_create(uuid),
 private.friend_remove(uuid,uuid), private.friend_competition_state(uuid) to authenticated;
revoke all on function public.friend_competition_state(uuid),
 public.friend_invite_create(uuid), public.friend_remove(uuid,uuid)
 from public, anon, authenticated, service_role;
grant execute on function public.friend_competition_state(uuid),
 public.friend_invite_create(uuid), public.friend_remove(uuid,uuid) to authenticated;

-- Replaced token functions retain signatures, so reaffirm their grants.
revoke all on function private.friend_invite_preview(text), private.friend_invite_accept(text),
 public.friend_invite_preview(text), public.friend_invite_accept(text)
 from public, anon, authenticated, service_role;
grant execute on function private.friend_invite_preview(text), public.friend_invite_preview(text)
 to anon, authenticated;
grant execute on function private.friend_invite_accept(text), public.friend_invite_accept(text)
 to authenticated;
