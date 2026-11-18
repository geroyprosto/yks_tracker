import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const migrations = new URL('../migrations/', import.meta.url);
const balancingMigration = '20261118125707_balance_topic_review_workload.sql';
const crossingDay = '2026-10-01T10:00:00+03:00';
const cutoff = '2026-10-01T16:00:00+03:00';

async function database(before?: string) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    insert into auth.users values ('${owner}');`);
  for (const file of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    if (before && file >= before) break;
    await db.exec(await readFile(new URL(file, migrations), 'utf8'));
  }
  await db.exec(`insert into public.owner_allowlist(user_id) values ('${owner}');
    set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);
    select public.yks_state(); reset role;`);
  return db;
}

async function addCrossings(db: PGlite, count: number) {
  await db.query(`with changed as (
    update public.topics set mastery=2 where id in (
      select id from public.topics where user_id=$1 order by id limit $2
    ) returning id,user_id
  ) insert into public.topic_history(user_id,topic_id,old_mastery,new_mastery,changed_at)
    select user_id,id,1,2,$3::timestamptz from changed`, [owner, count, crossingDay]);
}

async function reconcile(db: PGlite, runId = randomUUID()) {
  await db.exec('set role service_role');
  try {
    const response = await db.query<{ receipt: {
      run_id: string;
      results: Array<{ status: string; stages: Array<{ status: string }> }>;
    } }>(
      'select public.topic_review_reconcile($1,$2,$3,false,$4) receipt',
      [owner, cutoff, '2026-09-30T16:00:00+03:00', runId],
    );
    return response.rows[0].receipt;
  } finally { await db.exec('reset role'); }
}

async function linkedStages(db: PGlite) {
  return (await db.query<{ id: string; series: string; stage: number; day: string }>(
    `select t.id,st.series_id as series,st.stage,t.plan_date::text as day
     from private.topic_review_stages st join public.tasks t on t.id=st.task_id
     where st.user_id=$1 order by st.series_id,st.stage`, [owner],
  )).rows;
}

async function rebalance(db: PGlite) {
  return (await db.query<{ moved: number }>(
    "select private.topic_review_rebalance($1,'2026-11-18') moved", [owner],
  )).rows[0].moved;
}

test('normal reconciliation respects rest days, other study blocks and daily target overrides', async () => {
  const db = await database();
  try {
    await db.query(`update public.profiles set weekday_targets=array[420,420,420,420,420,420,0]
      where user_id=$1`, [owner]);
    await db.query(`insert into public.tasks(user_id,title,plan_date,planned_minutes) values
      ($1,'Full day','2026-10-05',420), ($1,'Heavy day','2026-10-06',360)`, [owner]);
    await db.query(`select private.snapshot_day($1,'2026-10-07','{"target_minutes":20}')`, [owner]);
    await addCrossings(db, 5);
    const runId = randomUUID();
    const receipt = await reconcile(db, runId);
    const stages = await linkedStages(db);
    assert.equal(stages.length, 25);
    assert.deepEqual(stages.filter(row => row.stage === 0).map(row => row.day).sort(), [
      '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-08', '2026-10-09',
    ]);
    for (let index = 0; index < stages.length; index += 5) {
      const series = stages.slice(index, index + 5);
      assert.deepEqual(series.map(row => row.stage), [0, 1, 2, 3, 4]);
      assert.ok(series.slice(1).every((row, i) => row.day > series[i].day));
      assert.ok(Date.parse(series[1].day) - Date.parse(series[0].day) >= 14 * 86400000);
    }
    assert.deepEqual(await reconcile(db, runId), receipt);
    await reconcile(db);
    assert.deepEqual(await linkedStages(db), stages);
  } finally { await db.close(); }
});

test('existing 85-topic collision keeps task identities and both stage links when redistributed', async () => {
  const db = await database(balancingMigration);
  try {
    await addCrossings(db, 85);
    await reconcile(db);
    const before = await linkedStages(db);
    const due = '2026-11-18';
    assert.equal(before.filter(row => row.day === due).length, 85);
    await db.query(`insert into public.tasks(user_id,title,plan_date,planned_minutes)
      select $1,'Study block '||n,$2,case when n=10 then 15 else 45 end
      from generate_series(1,10) n`, [owner, due]);
    await db.exec(await readFile(new URL(balancingMigration, migrations), 'utf8'));
    assert.ok(await rebalance(db) >= 85);
    const after = await linkedStages(db);
    assert.deepEqual(after.map(row => row.id), before.map(row => row.id));
    assert.deepEqual(after.filter(row => row.day < due), before.filter(row => row.day < due));
    assert.equal(after.filter(row => row.day === due).length, 0);
    const daily = new Map<string, number>();
    for (const row of after.filter(row => row.day >= due)) {
      daily.set(row.day, (daily.get(row.day) ?? 0) + 1);
    }
    assert.equal(Math.max(...daily.values()), 2);
    const stages = after.filter(row => row.stage === 2);
    assert.equal(stages.length, 85);
    assert.equal(new Set(stages.map(row => row.day)).size, 43);
    const mismatches = await db.query(`select st.task_id from private.topic_review_stages st
      join public.tasks t on t.id=st.task_id
      left join private.topic_review_schedule legacy on legacy.user_id=st.user_id
        and legacy.topic_id=st.topic_id and legacy.step=st.stage+1
      where t.plan_date<>st.plan_date or legacy.plan_date is distinct from t.plan_date
        or legacy.task_id is distinct from t.id`);
    assert.deepEqual(mismatches.rows, []);
    for (let index = 0; index < after.length; index += 5) {
      const series = after.slice(index, index + 5);
      assert.ok(series.slice(1).every((row, i) => row.day > series[i].day));
    }
    const core = await db.query<{ count: number; minutes: number }>(`select count(*)::int,
      sum(planned_minutes)::int minutes from public.tasks where user_id=$1 and plan_date=$2`, [owner, due]);
    assert.deepEqual(core.rows, [{ count: 10, minutes: 420 }]);
    assert.equal(await rebalance(db), 0);
    assert.deepEqual(await linkedStages(db), after);
  } finally { await db.close(); }
});

test('repair preserves progressed, session-linked, manually moved and unlinked lookalike tasks', async () => {
  const db = await database(balancingMigration);
  try {
    await addCrossings(db, 8);
    await reconcile(db);
    const before = await linkedStages(db);
    const [progressed, studied, moved] = before.filter(row => row.stage === 2);
    await db.exec('set role authenticated');
    for (const fields of [
      { id: progressed.id, progress: 0.5 }, { id: moved.id, plan_date: '2026-11-19' },
    ]) {
      await db.query("select public.yks_command($1,'task.update',$2::jsonb)",
        [randomUUID(), JSON.stringify({ ...fields, expected_revision: 1 })]);
    }
    await db.exec('reset role');
    await db.query(`insert into public.study_sessions(user_id,task_id,status,started_at,finished_at)
      values ($1,$2,'finished','2026-11-18T08:00:00Z','2026-11-18T08:20:00Z')`, [owner, studied.id]);
    const manualId = randomUUID();
    await db.query(`insert into public.tasks(id,user_id,title,plan_date,priority,study_type,planned_minutes)
      values ($1,$2,'Fiiller Pekiştirme','2026-11-18','low','Aralıklı tekrar',20)`, [manualId, owner]);
    const protectedIds = [progressed.id, studied.id, moved.id, manualId];
    const protectedTasks = () => db.query(
      'select * from public.tasks where id=any($1::uuid[]) order by id', [protectedIds],
    );
    const preserved = (await protectedTasks()).rows;
    await db.exec(await readFile(new URL(balancingMigration, migrations), 'utf8'));
    assert.ok(await rebalance(db) > 0);
    assert.deepEqual((await protectedTasks()).rows, preserved);
    assert.deepEqual((await linkedStages(db)).filter(row => row.stage < 2), before.filter(row => row.stage < 2));
  } finally { await db.close(); }
});

test('zero-capacity weeks defer reviews and the retry worker schedules each stage once when time opens', async () => {
  const db = await database();
  try {
    await db.query('update public.profiles set weekday_targets=array_fill(0,array[7]), daily_target_minutes=0 where user_id=$1', [owner]);
    await db.query('delete from public.daily_plan_versions where user_id=$1', [owner]);
    await addCrossings(db, 1);
    const receipt = await reconcile(db);
    assert.equal(receipt.results[0].status, 'deferred_capacity');
    assert.ok(receipt.results[0].stages.every(stage => stage.status === 'deferred_capacity'));
    assert.deepEqual(await linkedStages(db), []);
    await db.query('update public.profiles set weekday_targets=array_fill(40,array[7]), daily_target_minutes=40 where user_id=$1', [owner]);
    await db.exec('set role service_role');
    await db.query('select public.topic_review_retry_pending(null,$1)', [cutoff]);
    await db.exec('reset role');
    const scheduled = await linkedStages(db);
    assert.equal(scheduled.length, 5);
    assert.equal(new Set(scheduled.map(row => row.id)).size, 5);
    await reconcile(db);
    assert.deepEqual(await linkedStages(db), scheduled);
  } finally { await db.close(); }
});

test('a newly added study plan can fill a previously scheduled review day', async () => {
  const db = await database();
  try {
    await addCrossings(db, 1);
    const receipt = await reconcile(db);
    const before = await linkedStages(db);
    await db.query(`insert into public.tasks(user_id,title,plan_date,planned_minutes)
      values ($1,'Study plan',$2,360)`, [owner, before[0].day]);
    await db.exec('set role service_role');
    await db.query('select public.topic_review_retry_pending(null,$1)', [cutoff]);
    const latest = await db.query<{ run_id: string }>(
      "select public.topic_review_receipt($1)->>'run_id' as run_id", [owner],
    );
    assert.equal(latest.rows[0].run_id, receipt.run_id);
    await db.exec('reset role');
    const after = await linkedStages(db);
    assert.deepEqual(after.map(row => row.id), before.map(row => row.id));
    assert.ok(after[0].day > before[0].day);
  } finally { await db.close(); }
});

test('retrying a failed first stage after its due date shifts its delivered successors in place', async () => {
  const db = await database();
  try {
    await addCrossings(db, 1);
    await db.exec(`create function public.fail_first_review() returns trigger language plpgsql as $$
      begin
        if new.plan_date='2026-10-04' then raise exception 'temporary failure'; end if;
        return new;
      end $$;
      create trigger fail_first_review before insert on public.tasks
      for each row execute function public.fail_first_review();`);
    await reconcile(db);
    const delivered = await linkedStages(db);
    assert.deepEqual(delivered.map(row => row.stage), [1, 2, 3, 4]);
    await db.exec('drop trigger fail_first_review on public.tasks');
    await db.query(`insert into public.tasks(user_id,title,plan_date,planned_minutes)
      values ($1,'Full day on retry','2026-10-06',360)`, [owner]);
    await db.exec('set role service_role');
    await db.query('select public.topic_review_retry_pending($1,$2)', [owner, '2026-10-06T09:00:00+03:00']);
    await db.exec('reset role');
    const repaired = await linkedStages(db);
    assert.deepEqual(repaired.map(row => row.day), [
      '2026-10-07', '2026-10-21', '2026-11-21', '2027-01-21', '2027-04-21',
    ]);
    assert.deepEqual(repaired.slice(1).map(row => row.id), delivered.map(row => row.id));
  } finally { await db.close(); }
});
