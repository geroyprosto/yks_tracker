import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const [ADMIN, TEACHER, STUDENT, APPLICANT, ALERT] = Array.from({ length: 5 }, () => randomUUID());
let db: PGlite;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;`);
  const directory = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, directory), 'utf8'));
  }
  for (const [id, role] of [[ADMIN, 'admin'], [TEACHER, 'teacher'], [STUDENT, 'student'], [APPLICANT, 'student']]) {
    await db.query('insert into auth.users values($1,$2,now())', [id, `${id}@example.test`]);
    if (id === APPLICANT) continue;
    await db.query("insert into public.classroom_accounts(id,name,email,role,status,teacher_id) values($1,$2,$3,$4,'approved',$5)",
      [id, `Synthetic ${role}`, `${id}@example.test`, role, id === STUDENT ? TEACHER : null]);
  }
  await db.query('insert into public.owner_allowlist(user_id) values($1)', [ADMIN]);
  await db.query("insert into public.classroom_alerts(id,teacher_id,student_id,body,status,accepted_at,followup_due_at) values($1,$2,$3,'Historical reminder','accepted',now()-interval '20 minutes',now()-interval '5 minutes')", [ALERT, TEACHER, STUDENT]);
  // Simulate an old event remaining from before the pause.
  await db.exec('alter table public.classroom_events disable trigger classroom_filter_paused_teacher_event');
  await db.query('insert into public.classroom_events(user_id) values($1)', [TEACHER]);
  await db.exec('alter table public.classroom_events enable trigger classroom_filter_paused_teacher_event');
});
after(async () => { await db?.close(); });

async function browser(id: string) {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role: 'authenticated' })]);
  await db.query("select set_config('request.jwt.claim.client_id','',false)");
}
async function command(type: string, payload: unknown = {}) {
  return (await db.query<{ value: Record<string, unknown> }>('select public.classroom_command($1,$2,$3::jsonb) as value',
    [randomUUID(), type, JSON.stringify(payload)])).rows[0].value;
}
async function admin<T = Record<string, unknown>>(sql: string, args: unknown[] = []) {
  await db.exec('reset role');
  return db.query<T>(sql, args);
}

test('default pause hides teacher snapshots, historical events and every retained implementation', async () => {
  await browser(TEACHER);
  assert.equal((await db.query<{ value: boolean }>('select private.classroom_teacher_features_enabled() as value')).rows[0].value, false);
  const state = (await db.query<{ value: Record<string, unknown> }>('select public.classroom_state() as value')).rows[0].value;
  assert.equal(state.teacher_features_paused, true);
  assert.equal((state.account as { id: string }).id, TEACHER);
  for (const field of ['students', 'messages', 'alerts', 'feedback', 'applications', 'invites', 'accounts']) assert.deepEqual(state[field], []);
  assert.deepEqual((await db.query('select * from public.classroom_events')).rows, []);
  for (const sql of [
    'select private.classroom_state_unpaused()',
    "select private.classroom_command_unpaused(gen_random_uuid(),'invite.create','{}')",
    "select private.classroom_remove_student_unpaused(gen_random_uuid(),'{}')",
    'select private.classroom_tick_unpaused(null)',
  ]) await assert.rejects(() => db.query(sql), /permission denied/);
  await assert.rejects(() => db.exec("create or replace function private.classroom_teacher_features_enabled() returns boolean language sql as $$ select true $$"), /permission denied|must be owner/);
});

test('public RPCs reject teacher changes and student messages while presence writes no rows', async () => {
  await browser(TEACHER);
  for (const type of ['invite.create', 'invite.revoke', 'message.send', 'alert.send', 'application.review', 'account.suspend', 'student.remove']) {
    await assert.rejects(() => command(type, { id: STUDENT }), /TEACHER_FEATURES_PAUSED/);
  }
  await browser(STUDENT);
  for (const type of ['message.reply', 'message.read', 'alert.respond']) await assert.rejects(() => command(type), /TEACHER_FEATURES_PAUSED/);
  for (const type of ['presence.heartbeat', 'presence.leave']) {
    assert.deepEqual(await command(type, { device_id: randomUUID(), visible: true }), { paused: true });
  }
  assert.deepEqual((await admin('select * from public.classroom_presence')).rows, []);
  assert.deepEqual((await admin('select * from public.classroom_receipts')).rows, []);
});

test('student timer start and finish remain durable without classroom feedback or teacher events', async () => {
  const eventsBefore = (await admin('select id from public.classroom_events where user_id=$1', [TEACHER])).rows;
  await browser(STUDENT);
  const start = (await db.query<{ value: { id: string } }>("select public.yks_student_command($1,'timer.start',$2::jsonb) as value",
    [randomUUID(), JSON.stringify({ mode: 'stopwatch', title: 'Preserved personal timer' })])).rows[0].value;
  await admin("update public.study_sessions set started_at=now()-interval '90 seconds',active_since=now()-interval '90 seconds' where id=$1", [start.id]);
  await admin("update public.study_intervals set started_at=now()-interval '90 seconds' where session_id=$1", [start.id]);
  await browser(STUDENT);
  await db.query("select public.yks_student_command($1,'timer.finish',$2::jsonb)", [randomUUID(), JSON.stringify({ id: start.id, expected_revision: 1 })]);
  const saved = (await admin<{ status: string; accumulated_seconds: number }>('select status,accumulated_seconds from public.study_sessions where id=$1', [start.id])).rows[0];
  assert.equal(saved.status, 'finished');
  assert.ok(saved.accumulated_seconds >= 89);
  const intervals = (await admin<{ ended_at: string | null }>('select ended_at from public.study_intervals where session_id=$1', [start.id])).rows;
  assert.equal(intervals.length, 1); assert.ok(intervals[0].ended_at);
  assert.deepEqual((await admin('select * from public.classroom_feedback')).rows, []);
  assert.deepEqual((await admin('select id from public.classroom_events where user_id=$1', [TEACHER])).rows, eventsBefore);
});

test('scheduled ticks and old student state reads cannot create followups or mark classroom starts', async () => {
  await db.exec('reset role; set role service_role');
  assert.equal((await db.query<{ value: number }>('select public.classroom_tick() as value')).rows[0].value, 0);
  await browser(STUDENT);
  await db.query('select public.classroom_state()');
  const alerts = (await admin<{ id: string; started_at: string | null }>('select id,started_at from public.classroom_alerts')).rows;
  assert.deepEqual(alerts, [{ id: ALERT, started_at: null }]);
  assert.deepEqual((await admin('select * from public.classroom_feedback')).rows, []);
});

test('administrators still approve applicants and students can leave without notifying teachers', async () => {
  await browser(APPLICANT);
  const application = (await db.query<{ value: string }>("select public.classroom_apply('New student','student',null) as value")).rows[0].value;
  await browser(ADMIN);
  const adminState = (await db.query<{ value: { applications: { id: string }[] } }>('select public.classroom_state() as value')).rows[0].value;
  assert.ok(adminState.applications.some(row => row.id === application));
  await command('application.review', { id: application, decision: 'approved' });
  assert.equal((await admin<{ status: string }>('select status from public.classroom_accounts where id=$1', [APPLICANT])).rows[0].status, 'approved');
  const eventsBefore = (await admin('select id from public.classroom_events where user_id=$1', [TEACHER])).rows;
  await browser(STUDENT); await command('student.remove', { id: STUDENT });
  assert.equal((await admin<{ teacher_id: string | null }>('select teacher_id from public.classroom_accounts where id=$1', [STUDENT])).rows[0].teacher_id, null);
  assert.deepEqual((await admin('select id from public.classroom_events where user_id=$1', [TEACHER])).rows, eventsBefore);
  assert.equal((await admin('select id from public.study_sessions where user_id=$1', [STUDENT])).rows.length, 1);
});
