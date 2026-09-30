import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {after, before, test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const ALICE = randomUUID();
const BOB = randomUUID();
const CAROL = randomUUID();
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
type State = {today: string; week_start: string; me: Score; friends: Score[]};

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
  for (const id of [ALICE, BOB, CAROL, PENDING, TEACHER]) {
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())',
      [id, `${id}@example.test`]);
  }
  for (const [id, name, role, status] of [
    [ALICE, 'Alice Classroom', 'student', 'approved'],
    [BOB, 'Bob Classroom', 'student', 'approved'],
    [CAROL, 'Carol', 'student', 'approved'],
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
});
after(async () => { await db?.close(); });

async function browser(id: string) {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub: id, role: 'authenticated'})]);
  await db.query("select set_config('request.jwt.claim.client_id','',false)");
}
async function admin() { await db.exec('reset role'); }
async function state() {
  return (await db.query<{value: State}>('select public.friend_competition_state() as value')).rows[0].value;
}
async function createInvite() {
  return (await db.query<{value: {token: string; expires_at: string}}>(
    'select public.friend_invite_create() as value')).rows[0].value;
}
async function preview(token: string) {
  return (await db.query<{value: {display_name: string; expires_at: string} | null}>(
    'select public.friend_invite_preview($1) as value', [token])).rows[0].value;
}
async function accept(token: string) {
  return (await db.query<{value: {friend_id: string; display_name: string}}>(
    'select public.friend_invite_accept($1) as value', [token])).rows[0].value;
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
  for (const table of ['friend_invites', 'friendships']) {
    await assert.rejects(() => db.query(`select * from private.${table}`), /permission denied/);
  }
  await assert.rejects(() => db.query(
    "select private.friend_score($1,current_date,current_date,now(),now(),now())", [BOB]), /permission denied/);
  await db.query("select set_config('request.jwt.claim.client_id','mcp-client',false)");
  await assert.rejects(createInvite, /STUDENT_REQUIRED/);
  await assert.rejects(state, /STUDENT_REQUIRED/);
  await admin();
  const rls = await db.query<{relname: string; relrowsecurity: boolean}>(
    "select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and relname in ('friend_invites','friendships')");
  assert.equal(rls.rows.length, 2);
  assert.ok(rls.rows.every(row => row.relrowsecurity));
});

test('one-time hashed link requires consent and cannot be reused or accepted by self', async () => {
  await browser(ALICE);
  const empty = await state();
  assert.equal(empty.me.user_id, ALICE);
  assert.deepEqual(empty.friends, []);
  const invitation = await createInvite();
  assert.match(invitation.token, /^[0-9a-f]{64}$/);
  assert.equal((await preview(invitation.token))?.display_name, 'Alice');
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
  assert.deepEqual(await accept(invitation.token), {friend_id: ALICE, display_name: 'Alice'});
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
  assert.deepEqual((await state()).friends, []);
  await admin();
  await db.query("update public.classroom_accounts set status='approved' where id=$1", [BOB]);
  await browser(ALICE);
  assert.equal((await db.query<{value: boolean}>(
    'select public.friend_remove($1::uuid) as value', [BOB])).rows[0].value, true);
  assert.deepEqual((await state()).friends, []);
  await browser(BOB);
  assert.deepEqual((await state()).friends, []);
  assert.equal((await db.query<{value: boolean}>(
    'select public.friend_remove($1::uuid) as value', [ALICE])).rows[0].value, false);
});

test('deleting a recipient account cascades through a consumed invite and friendship', async () => {
  await browser(ALICE);
  const invitation = await createInvite();
  await browser(CAROL);
  assert.deepEqual(await accept(invitation.token), {friend_id: ALICE, display_name: 'Alice'});
  await admin();
  await db.query('delete from auth.users where id=$1', [CAROL]);
  assert.equal((await db.query<{count: string}>(
    'select count(*)::text as count from private.friendships where user_a=$1 or user_b=$1', [CAROL])).rows[0].count, '0');
  assert.equal((await db.query<{count: string}>(
    'select count(*)::text as count from private.friend_invites where accepted_by=$1', [CAROL])).rows[0].count, '0');
});
