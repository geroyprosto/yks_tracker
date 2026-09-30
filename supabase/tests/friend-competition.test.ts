import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {after, before, test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const ALICE = randomUUID();
const BOB = randomUUID();
const CAROL = randomUUID();
const DAVE = randomUUID();
const EVE = randomUUID();
const PENDING = randomUUID();
const TEACHER = randomUUID();
let db: PGlite;

type Score = {
  user_id: string; display_name: string;
  today_seconds: number; week_seconds: number;
  today_questions: number; week_questions: number;
  today_tests: number; week_tests: number;
  today_tasks: number; week_tasks: number;
};
type Group = {id: string; name: string; owner_id: string; member_count: number; timezone?: string};
type State = {today: string; week_start: string; me: Score; friends: Score[]; groups: Group[]; group: Group | null};

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;`);
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, migrations), 'utf8'));
  }
  for (const id of [ALICE, BOB, CAROL, DAVE, EVE, PENDING, TEACHER]) {
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())',
      [id, `${id}@example.test`]);
  }
  for (const [id, name, role, status] of [
    [ALICE, 'Alice Classroom', 'student', 'approved'],
    [BOB, 'Bob Classroom', 'student', 'approved'],
    [CAROL, 'Carol', 'student', 'approved'],
    [DAVE, 'Dave', 'student', 'approved'],
    [EVE, 'Eve', 'student', 'approved'],
    [PENDING, 'Pending', 'student', 'pending'],
    [TEACHER, 'Teacher', 'teacher', 'approved'],
  ]) {
    await db.query('insert into public.classroom_accounts(id,name,email,role,status) values($1,$2,$3,$4,$5)',
      [id, name, `${id}@example.test`, role, status]);
  }
  // Pick a timezone whose current local hour is comfortably away from midnight.
  const tz = (await db.query<{name: string}>(`select name from (values
    ('Pacific/Kiritimati'),('UTC'),('America/Los_Angeles')) as z(name)
    where extract(hour from clock_timestamp() at time zone name) between 4 and 20
    limit 1`)).rows[0].name;
  await db.query('insert into public.profiles(user_id,display_name,timezone) values($1,$2,$3),($4,$5,$6)',
    [ALICE, 'Alice', tz, BOB, 'Bob', 'Pacific/Honolulu']);
  await db.query('insert into public.profiles(user_id,display_name,timezone) values($1,$2,$3)',
    [DAVE, 'Dave', 'Pacific/Honolulu']);
});
after(async () => { await db?.close(); });

async function browser(id: string) {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub: id, role: 'authenticated'})]);
  await db.query("select set_config('request.jwt.claim.client_id','',false)");
}
async function admin() { await db.exec('reset role'); }
async function state(groupId: string | null = null) {
  return (await db.query<{value: State}>(
    'select public.friend_competition_state($1::uuid) as value', [groupId])).rows[0].value;
}
async function createInvite(groupId: string | null = null) {
  return (await db.query<{value: {token: string; expires_at: string; group_id: string; group_name: string}}>(
    'select public.friend_invite_create($1::uuid) as value', [groupId])).rows[0].value;
}
async function preview(token: string) {
  return (await db.query<{value: {display_name: string; expires_at: string; group_name: string; member_count: number} | null}>(
    'select public.friend_invite_preview($1) as value', [token])).rows[0].value;
}
async function accept(token: string) {
  return (await db.query<{value: {friend_id: string; display_name: string; group_id: string; group_name: string}}>(
    'select public.friend_invite_accept($1) as value', [token])).rows[0].value;
}
async function remove(friendId: string, groupId: string | null = null) {
  return (await db.query<{value: boolean}>(
    'select public.friend_remove($1::uuid,$2::uuid) as value', [friendId, groupId])).rows[0].value;
}

test('friend RPCs enforce student approval and keep private rows closed', async () => {
  for (const id of [PENDING, TEACHER]) {
    await browser(id);
    await assert.rejects(createInvite, /STUDENT_REQUIRED/);
    await assert.rejects(state, /STUDENT_REQUIRED/);
    await assert.rejects(() => accept('a'.repeat(64)), /STUDENT_REQUIRED/);
    await assert.rejects(() => db.query('select public.friend_remove($1::uuid)', [ALICE]), /STUDENT_REQUIRED/);
  }
  await db.exec('reset role; set role anon; reset request.jwt.claim.sub');
  await assert.rejects(createInvite, /permission denied/);
  await assert.rejects(state, /permission denied/);
  await assert.rejects(() => accept('a'.repeat(64)), /permission denied/);
  await assert.rejects(() => db.query('select public.friend_remove($1::uuid)', [ALICE]), /permission denied/);
  assert.equal(await preview('a'.repeat(64)), null);
  await browser(CAROL);
  for (const table of ['friend_invites', 'friendships', 'friend_groups', 'friend_group_members']) {
    await assert.rejects(() => db.query(`select * from private.${table}`), /permission denied/);
  }
  await assert.rejects(() => db.query(
    "select private.friend_score($1,current_date,current_date,now(),now(),now())", [BOB]), /permission denied/);
  await db.query("select set_config('request.jwt.claim.client_id','mcp-client',false)");
  await assert.rejects(createInvite, /STUDENT_REQUIRED/);
  await assert.rejects(state, /STUDENT_REQUIRED/);
  await admin();
  const rls = await db.query<{relname: string; relrowsecurity: boolean}>(
    "select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and relname in ('friend_invites','friendships','friend_groups','friend_group_members')");
  assert.equal(rls.rows.length, 4);
  assert.ok(rls.rows.every(row => row.relrowsecurity));
});

test('one-time hashed link requires consent and cannot be reused or accepted by self', async () => {
  await browser(ALICE);
  const empty = await state();
  assert.equal(empty.me.user_id, ALICE);
  assert.deepEqual(empty.friends, []);
  assert.deepEqual(empty.groups, []);
  assert.equal(empty.group, null);
  const invitation = await createInvite();
  assert.match(invitation.token, /^[0-9a-f]{64}$/);
  assert.match(invitation.group_id, /^[0-9a-f-]{36}$/);
  assert.equal(invitation.group_name, 'Alice ve arkadaşları');
  assert.equal((await preview(invitation.token))?.display_name, 'Alice');
  assert.equal((await preview(invitation.token))?.member_count, 1);
  await admin();
  const stored = (await db.query<{hash: string}>(
    'select encode(token_hash,\'hex\') as hash from private.friend_invites where inviter_id=$1', [ALICE])).rows[0];
  assert.match(stored.hash, /^[0-9a-f]{64}$/);
  assert.notEqual(stored.hash, invitation.token);
  await db.exec('reset role; set role anon; reset request.jwt.claim.sub');
  assert.equal((await preview(invitation.token))?.display_name, 'Alice');
  assert.equal(await preview('not-a-token'), null);
  await browser(PENDING);
  await assert.rejects(() => accept(invitation.token), /STUDENT_REQUIRED/);
  await browser(ALICE);
  await assert.rejects(() => accept(invitation.token), /SELF_INVITE/);
  await browser(BOB);
  assert.deepEqual(await accept(invitation.token), {
    friend_id: ALICE, display_name: 'Alice',
    group_id: invitation.group_id, group_name: invitation.group_name,
  });
  assert.equal(await preview(invitation.token), null);
  await browser(CAROL);
  await assert.rejects(() => accept(invitation.token), /INVITE_INVALID/);
  assert.deepEqual((await state()).friends, []);
  await browser(ALICE);
  const duplicate = await createInvite();
  await browser(BOB);
  await assert.rejects(() => accept(duplicate.token), /ALREADY_FRIENDS/);
  await browser(ALICE);
  const expiring = await createInvite();
  await admin();
  await db.query("update private.friend_invites set expires_at=clock_timestamp()-interval '1 second' where token_hash=sha256(decode($1,'hex'))", [expiring.token]);
  await browser(CAROL);
  assert.equal(await preview(expiring.token), null);
  await assert.rejects(() => accept(expiring.token), /INVITE_INVALID/);
});

test('both friends see only aggregate scores at the viewer timezone boundaries', async () => {
  await admin();
  const bounds = (await db.query<{today: string; monday: string; day_start: string}>(`
    select (clock_timestamp() at time zone timezone)::date::text as today,
      ((clock_timestamp() at time zone timezone)::date -
        (extract(isodow from clock_timestamp() at time zone timezone)::int - 1))::text as monday,
      (((clock_timestamp() at time zone timezone)::date)::timestamp at time zone timezone)::text as day_start
    from public.profiles where user_id=$1`, [ALICE])).rows[0];
  const dayStart = new Date(bounds.day_start);
  assert.ok(Number.isFinite(dayStart.valueOf()));
  const start = new Date(dayStart.valueOf() - 120_000);
  const end = new Date(dayStart.valueOf() + 120_000);
  await db.query(`insert into public.study_sessions(user_id,status,started_at,active_since)
    values($1,'running',$2,$2)`, [BOB, start.toISOString()]);
  const session = (await db.query<{id: string}>(
    'select id from public.study_sessions where user_id=$1', [BOB])).rows[0];
  await db.query('insert into public.study_intervals(user_id,session_id,started_at,ended_at) values($1,$2,$3,$4)',
    [BOB, session.id, start.toISOString(), end.toISOString()]);
  await db.query(`update public.study_sessions set status='finished',active_since=null,
    accumulated_seconds=240,finished_at=$2 where id=$1`, [session.id, end.toISOString()]);
  await db.query(`insert into public.study_sessions(user_id,status,started_at,active_since)
    values($1,'running',clock_timestamp()-interval '60 seconds',clock_timestamp()-interval '60 seconds')`, [BOB]);
  const open = (await db.query<{id: string}>(
    "select id from public.study_sessions where user_id=$1 and status='running'", [BOB])).rows[0];
  await db.query(`insert into public.study_intervals(user_id,session_id,started_at)
    values($1,$2,clock_timestamp()-interval '60 seconds')`, [BOB, open.id]);
  await db.query(`insert into public.manual_study_entries(user_id,study_date,subject,duration_seconds)
    values($1,$2,'Math',1800)`, [BOB, bounds.today]);
  await db.query(`insert into public.practice_entries(user_id,practice_date,exam,subject,question_count,test_count)
    values($1,$2,'TYT','Math',12,2)`, [BOB, bounds.today]);
  await db.query(`insert into public.tasks(user_id,title,plan_date,progress)
    values($1,'SECRET_TASK_TITLE',$2,1)`, [BOB, bounds.today]);
  if (bounds.today !== bounds.monday) {
    await db.query(`insert into public.manual_study_entries(user_id,study_date,subject,duration_seconds)
      values($1,$2,'Math',600)`, [BOB, bounds.monday]);
    await db.query(`insert into public.practice_entries(user_id,practice_date,exam,subject,question_count,test_count)
      values($1,$2,'TYT','Math',7,1)`, [BOB, bounds.monday]);
    await db.query(`insert into public.tasks(user_id,title,plan_date,progress)
      values($1,'ANOTHER_SECRET',$2,1)`, [BOB, bounds.monday]);
  }
  await db.query(`insert into public.practice_entries(user_id,practice_date,exam,subject,question_count,test_count)
    values($1,$2,'TYT','Math',999,99)`, [CAROL, bounds.today]);
  await browser(ALICE);
  for (const table of ['study_intervals', 'manual_study_entries', 'practice_entries', 'tasks']) {
    assert.equal((await db.query(`select * from public.${table} where user_id=$1`, [BOB])).rows.length, 0);
  }
  const alice = await state();
  assert.equal(alice.group?.owner_id, ALICE);
  assert.equal(alice.group?.member_count, 2);
  assert.equal(alice.group?.timezone, (await db.query<{timezone: string}>(
    'select timezone from public.profiles where user_id=$1', [ALICE])).rows[0].timezone);
  assert.equal(alice.today, bounds.today);
  assert.equal(alice.week_start, bounds.monday);
  assert.deepEqual(alice.friends.map(score => score.user_id), [BOB]);
  assert.equal(alice.me.today_seconds, 0);
  assert.equal(alice.friends[0].today_questions, 12);
  assert.equal(alice.friends[0].today_tests, 2);
  assert.equal(alice.friends[0].today_tasks, 1);
  assert.equal(alice.friends[0].week_questions, bounds.today === bounds.monday ? 12 : 19);
  assert.equal(alice.friends[0].week_tests, bounds.today === bounds.monday ? 2 : 3);
  assert.equal(alice.friends[0].week_tasks, bounds.today === bounds.monday ? 1 : 2);
  assert.ok(alice.friends[0].today_seconds >= 1975 && alice.friends[0].today_seconds <= 1990);
  const expectedWeekSeconds = bounds.today === bounds.monday ? 1980 : 2700;
  assert.ok(alice.friends[0].week_seconds >= expectedWeekSeconds - 5);
  assert.ok(alice.friends[0].week_seconds <= expectedWeekSeconds + 10);
  assert.equal(JSON.stringify(alice).includes('SECRET_TASK_TITLE'), false);
  assert.equal(JSON.stringify(alice).includes(CAROL), false);
  await browser(BOB);
  assert.deepEqual((await state()).friends.map(score => score.user_id), [ALICE]);
  await admin();
  await db.query("update public.classroom_accounts set status='suspended' where id=$1", [BOB]);
  await browser(ALICE);
  const duringSuspension = await state();
  assert.deepEqual(duringSuspension.friends, []);
  assert.equal(duringSuspension.group?.member_count, 1);
  await browser(BOB);
  await assert.rejects(state, /STUDENT_REQUIRED/);
  await admin();
  await db.query("update public.classroom_accounts set status='approved' where id=$1", [BOB]);
  await browser(ALICE);
  assert.equal(await remove(BOB), true);
  assert.deepEqual((await state()).friends, []);
  await browser(BOB);
  assert.deepEqual((await state()).friends, []);
  assert.equal(await remove(ALICE), false);
});

test('deleting a recipient account cascades through a consumed invite and friendship', async () => {
  await browser(ALICE);
  const invitation = await createInvite();
  await browser(CAROL);
  assert.deepEqual(await accept(invitation.token), {
    friend_id: ALICE, display_name: 'Alice',
    group_id: invitation.group_id, group_name: invitation.group_name,
  });
  await admin();
  await db.query('delete from auth.users where id=$1', [CAROL]);
  assert.equal((await db.query<{count: string}>(
    'select count(*)::text as count from private.friendships where user_a=$1 or user_b=$1', [CAROL])).rows[0].count, '0');
  assert.equal((await db.query<{count: string}>(
    'select count(*)::text as count from private.friend_invites where accepted_by=$1', [CAROL])).rows[0].count, '0');
});

test('shared groups show every member, stay isolated, and transfer ownership on leave', async () => {
  await browser(ALICE);
  const aliceGroup = (await state()).group;
  assert.ok(aliceGroup);
  const bobLink = await createInvite(aliceGroup.id);
  await browser(BOB);
  assert.equal((await accept(bobLink.token)).group_id, aliceGroup.id);
  const daveLink = await createInvite(aliceGroup.id);
  await browser(DAVE);
  assert.equal((await accept(daveLink.token)).group_id, aliceGroup.id);
  const davePending = await createInvite(aliceGroup.id);
  const daveState = await state();
  assert.deepEqual(new Set(daveState.friends.map(score => score.user_id)), new Set([ALICE, BOB]));
  assert.equal(daveState.group?.member_count, 3);
  await browser(ALICE);
  assert.equal(daveState.today, (await state()).today);

  await browser(EVE);
  assert.equal((await state()).group, null);
  await assert.rejects(() => state(aliceGroup.id), /GROUP_NOT_FOUND/);
  await assert.rejects(() => createInvite(aliceGroup.id), /GROUP_NOT_FOUND/);
  await assert.rejects(() => remove(ALICE, aliceGroup.id), /GROUP_NOT_FOUND/);
  const eveLink = await createInvite();
  assert.notEqual(eveLink.group_id, aliceGroup.id);
  await browser(BOB);
  assert.equal((await accept(eveLink.token)).group_id, eveLink.group_id);
  const bobDefault = await state();
  assert.deepEqual(new Set(bobDefault.groups.map(group => group.id)),
    new Set([aliceGroup.id, eveLink.group_id]));
  assert.equal(bobDefault.group?.id, aliceGroup.id);
  assert.deepEqual(new Set(bobDefault.friends.map(score => score.user_id)), new Set([ALICE, DAVE]));
  const bobOther = await state(eveLink.group_id);
  assert.deepEqual(bobOther.friends.map(score => score.user_id), [EVE]);
  assert.equal(bobOther.group?.member_count, 2);
  await assert.rejects(() => remove(DAVE, aliceGroup.id), /GROUP_OWNER_REQUIRED/);

  await browser(ALICE);
  assert.equal(await remove(DAVE, aliceGroup.id), true);
  assert.equal(await preview(davePending.token), null);
  await browser(DAVE);
  assert.equal((await state()).group, null);
  await browser(ALICE);
  const alicePending = await createInvite(aliceGroup.id);
  assert.equal(await remove(ALICE, aliceGroup.id), true);
  assert.equal(await preview(alicePending.token), null);
  await assert.rejects(() => state(aliceGroup.id), /GROUP_NOT_FOUND/);
  await browser(BOB);
  const transferred = await state(aliceGroup.id);
  assert.equal(transferred.group?.owner_id, BOB);
  assert.equal(transferred.group?.name, 'Bob ve arkadaşları');
  assert.equal(transferred.group?.member_count, 1);
  assert.deepEqual(transferred.friends, []);
  assert.equal(await remove(BOB, aliceGroup.id), true);
  assert.equal((await state()).group?.id, eveLink.group_id);
  assert.equal(await remove(BOB, eveLink.group_id), true);
  await browser(EVE);
  assert.equal((await state()).group?.member_count, 1);
  assert.equal(await remove(EVE, eveLink.group_id), true);
  assert.equal((await state()).group, null);
});
