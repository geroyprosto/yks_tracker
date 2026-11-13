import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const student = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const suspended = '44444444-4444-4444-8444-444444444444';
const teacher = '55555555-5555-4555-8555-555555555555';
const pending = '66666666-6666-4666-8666-666666666666';
const report = {
  schema_version: 1,
  run_id: 'same-run',
  mode: 'sample',
  generated_at: '2026-11-13T20:00:00Z',
  week_start: '2026-11-16',
  title: 'Örnek rapor',
  agents: [{ id: 'leader', status: 'ready', summary: 'Plan hazır.', recommendations: [], sources: [], tables: [], schedule: [] }],
};
let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;`);
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, migrations), 'utf8'));
  }
  await db.query('insert into auth.users values ($1), ($2), ($3), ($4), ($5), ($6)', [owner, student, other, suspended, teacher, pending]);
  await db.query('insert into public.owner_allowlist(user_id) values ($1)', [owner]);
  for (const [id, role, status] of [
    [owner, 'admin', 'approved'], [student, 'student', 'approved'], [other, 'student', 'approved'],
    [suspended, 'student', 'suspended'], [teacher, 'teacher', 'approved'], [pending, 'student', 'pending'],
  ]) {
    await db.query('insert into public.classroom_accounts(id,name,email,role,status) values ($1, $2, $3, $4, $5)',
      [id, 'Test', `${id}@example.test`, role, status]);
  }
});

after(async () => { await db?.close(); });

async function asRole(role: 'anon' | 'authenticated' | 'service_role', userId = '', clientId = '') {
  await db.exec(`reset role; set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false),
    set_config('request.jwt.claim.client_id', $2, false)`, [userId, clientId]);
}

async function save(userId: string, value = report) {
  const result = await db.query<{ result: { created: boolean; run: typeof report } }>(
    'select public.agent_house_save_for_user($1::uuid, $2::jsonb) as result', [userId, JSON.stringify(value)],
  );
  return result.rows[0].result;
}

test('reports are immutable and replays are scoped by owner and run id', async () => {
  await asRole('service_role');
  assert.deepEqual(await save(student), { created: true, run: report });
  assert.deepEqual(await save(student), { created: false, run: report });
  await assert.rejects(() => save(student, { ...report, title: 'Değişmiş içerik' }), /IDEMPOTENCY_CONFLICT/);
  assert.equal((await save(other, { ...report, mode: 'live', title: 'Kişisel rapor' })).created, true);
  assert.equal((await save(student, { ...report, run_id: 'live-run', mode: 'live' })).created, true);

  await asRole('authenticated', student);
  const own = await db.query('select user_id, run_id, mode from public.agent_house_reports order by mode');
  assert.deepEqual(own.rows, [
    { user_id: student, run_id: 'live-run', mode: 'live' }, { user_id: student, run_id: 'same-run', mode: 'sample' },
  ]);
  await assert.rejects(() => db.query("update public.agent_house_reports set mode = 'live'"), /permission denied/);
  await assert.rejects(() => db.query('delete from public.agent_house_reports'), /permission denied/);
  await assert.rejects(() => db.query('insert into public.agent_house_reports default values'), /permission denied/);
  await assert.rejects(() => save(other), /permission denied/);
});

test('report access requires an approved account and MCP publication requires the allowlisted owner', async () => {
  const publish = (userId: string) => db.query('select public.agent_house_publish_for_owner($1::uuid,$2::jsonb)', [userId, JSON.stringify(report)]);
  await asRole('service_role');
  await assert.rejects(() => save(suspended), /STUDENT_REQUIRED/);
  await assert.rejects(() => save(pending), /STUDENT_REQUIRED/);
  await assert.rejects(() => save(teacher), /STUDENT_REQUIRED/);
  await assert.rejects(() => publish(student), /OWNER_REQUIRED/);
  await publish(owner);
  await asRole('authenticated', owner);
  assert.deepEqual((await db.query('select user_id from public.agent_house_reports')).rows, [{ user_id: owner }]);
  await assert.rejects(() => publish(owner), /permission denied/);
  await asRole('authenticated', owner, 'oauth-client');
  assert.equal((await db.query('select run_id from public.agent_house_reports')).rows.length, 0);
  await db.exec('reset role');
  await db.query("update public.classroom_accounts set role = 'teacher' where id = $1", [owner]);
  await db.query("update public.classroom_accounts set status = 'suspended' where id = $1", [student]);
  await asRole('authenticated', owner);
  assert.equal((await db.query('select run_id from public.agent_house_reports')).rows.length, 0);
  await asRole('authenticated', student);
  assert.equal((await db.query('select run_id from public.agent_house_reports')).rows.length, 0);
  await asRole('anon');
  await assert.rejects(() => db.query('select run_id from public.agent_house_reports'), /permission denied/);
});
