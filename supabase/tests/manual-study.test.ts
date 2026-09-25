import {before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
let db: PGlite;
let studyDate: string;
let futureDate: string;

before(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role; create schema auth;" +
    "create table auth.users(id uuid primary key);" +
    "create function auth.uid() returns uuid language sql stable as $$" +
    " select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;" +
    "grant usage on schema public,auth to anon,authenticated,service_role;" +
    "grant execute on function auth.uid() to anon,authenticated,service_role;");
  await db.query('insert into auth.users values($1),($2)', [OWNER, OTHER]);
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, migrations), 'utf8'));
  }
  await db.query('insert into public.owner_allowlist(user_id) values($1)', [OWNER]);
  await asOwner();
  await db.query('select public.yks_state()');
  const dates = await db.query<{past: string; future: string}>(
    "select ((clock_timestamp() at time zone timezone)::date - 1)::text as past," +
    " ((clock_timestamp() at time zone timezone)::date + 1)::text as future" +
    ' from public.profiles where user_id=$1', [OWNER]);
  studyDate = dates.rows[0].past;
  futureDate = dates.rows[0].future;
});
after(async () => { await db?.close(); });
async function asOwner() {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [OWNER]);
}
async function asOther() {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [OTHER]);
}
async function asService() { await db.exec('reset role; set role service_role; reset request.jwt.claim.sub'); }
async function create(payload: Record<string, unknown>, id = randomUUID()) {
  return (await db.query<{value: {id: string; request_id: string; replayed: boolean}}>(
    "select public.yks_command($1::uuid,'manual_study.create',$2::jsonb) as value",
    [id, JSON.stringify(payload)])).rows[0].value;
}
const valid = () => ({confirmed_by_user: true, study_date: studyDate, subject: 'TYT Fizik', minutes: 50});

test('confirmed manual study write is atomic, replay-safe, audited and visible without a clock interval', async () => {
  const requestId = randomUUID();
  const first = await create(valid(), requestId);
  assert.equal(first.replayed, false);
  assert.equal(first.request_id, requestId);
  const replay = await create(valid(), requestId);
  assert.equal(replay.id, first.id);
  assert.equal(replay.replayed, true);
  await assert.rejects(() => create({...valid(), minutes: 60}, requestId), /IDEMPOTENCY_CONFLICT/);

  const state = (await db.query<{value: {manual_study_entries: Array<{
    id: string; study_date: string; subject: string; duration_seconds: number; created_at: string; started_at?: string}>;
    intervals: unknown[]; sessions: unknown[]}}>('select public.yks_state() as value')).rows[0].value;
  const entries = state.manual_study_entries.filter(row => row.id === first.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].study_date, studyDate);
  assert.equal(entries[0].subject, 'TYT Fizik');
  assert.equal(entries[0].duration_seconds, 3000);
  assert.ok(entries[0].created_at);
  assert.equal('started_at' in entries[0], false);
  assert.equal(state.intervals.length, 0);
  assert.equal(state.sessions.length, 0);
  const audit = await db.query<{action: string; source: string; subject: string}>(
    "select action,source,new_value->>'subject' as subject from public.audit_log where entity_id=$1", [first.id]);
  assert.deepEqual(audit.rows, [{action: 'manual_study.create', source: 'manual', subject: 'TYT Fizik'}]);
  const receipts = await db.query<{count: number}>(
    'select count(*)::int as count from public.command_receipts where request_id=$1', [requestId]);
  assert.equal(receipts.rows[0].count, 1);
});

test('direct RPC rejects unconfirmed, hidden, future and invalid duration inputs without writing', async () => {
  const invalid = [
    {...valid(), confirmed_by_user: false},
    {...valid(), confirmed_by_user: undefined},
    {...valid(), user_id: OTHER},
    {...valid(), minutes: 0},
    {...valid(), minutes: 1441},
    {...valid(), minutes: '50'},
    {...valid(), subject: ''},
    {...valid(), study_date: futureDate},
    {...valid(), study_date: '2026-02-31'},
  ];
  const beforeCount = (await db.query<{count: number}>('select count(*)::int as count from public.manual_study_entries')).rows[0].count;
  for (const payload of invalid) await assert.rejects(() => create(payload));
  const afterCount = (await db.query<{count: number}>('select count(*)::int as count from public.manual_study_entries')).rows[0].count;
  assert.equal(afterCount, beforeCount);
});

test('RLS permits only owner reads; direct writes and non-owner RPC are denied', async () => {
  await assert.rejects(() => db.query("insert into public.manual_study_entries(user_id,study_date,subject,duration_seconds) values($1,$2,'TYT Fizik',3000)",
    [OWNER, studyDate]), /permission denied/);
  await asOther();
  assert.equal((await db.query('select * from public.manual_study_entries')).rows.length, 0);
  await assert.rejects(() => create(valid()), /OWNER_REQUIRED/);
  await db.exec('reset role; set role anon; reset request.jwt.claim.sub');
  await assert.rejects(() => db.query('select * from public.manual_study_entries'), /permission denied/);
  await assert.rejects(() => create(valid()), /permission denied/);
  await asOwner();
});

test('service report source includes date-only study entries and keeps its owner gate', async () => {
  await assert.rejects(() => db.query('select public.analysis_source_state($1::uuid)', [OWNER]), /permission denied/);
  await asService();
  try {
    const result = await db.query<{value: {manual_study_entries: Array<{subject: string; duration_seconds: number}>}}>(
      'select public.analysis_source_state($1::uuid) as value', [OWNER]);
    assert.equal(result.rows[0].value.manual_study_entries.some(entry => entry.subject === 'TYT Fizik' && entry.duration_seconds === 3000), true);
    await assert.rejects(() => db.query('select public.analysis_source_state($1::uuid)', [OTHER]), /OWNER_REQUIRED/);
  } finally { await asOwner(); }
});
