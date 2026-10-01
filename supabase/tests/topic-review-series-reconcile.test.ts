import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const cutoff = '2026-10-01T15:00:00+03:00';

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values('${owner}');`);
  const directory = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, directory), 'utf8'));
  }
  await db.exec(`insert into public.owner_allowlist(user_id) values('${owner}');
    set role authenticated;
    select set_config('request.jwt.claim.sub','${owner}',false);
    select public.yks_state(); reset role;`);
  return db;
}

async function service(db: PGlite) {
  await db.exec('set role service_role');
}

async function reconcile(db: PGlite, initial: boolean, runId = randomUUID(), previous: string | null = null) {
  await service(db);
  try {
    const value = await db.query<{ value: { run_id: string; results: Array<Record<string, unknown>> } }>(
      'select public.topic_review_reconcile($1,$2,$3,$4,$5) value',
      [owner, cutoff, previous, initial, runId],
    );
    return value.rows[0].value;
  } finally {
    await db.exec('reset role');
  }
}

async function firstTopic(db: PGlite, subject: string, offset: number) {
  const result = await db.query<{ id: string; name: string }>(
    'select id,name from public.topics where exam=$1 and subject=$2 order by name limit 1 offset $3',
    ['AYT', subject, offset],
  );
  return result.rows[0];
}

async function crossing(db: PGlite, id: string, mastery: number, when: string) {
  await db.query('update public.topics set mastery=$1 where id=$2', [mastery, id]);
  await db.query('insert into public.topic_history(user_id,topic_id,old_mastery,new_mastery,changed_at) values($1,$2,1,2,$3)', [owner, id, when]);
}

test('new stage dates keep only the first two Sundays, then use calendar anniversaries', async () => {
  const db = await database();
  try {
    const rows = await db.query<{ stage: number; plan_date: string }>(
      "select stage,plan_date::text from private.topic_review_stage_dates('2026-10-01'::date)",
    );
    assert.deepEqual(rows.rows.map(row => [row.stage, row.plan_date]), [
      [0, '2026-10-04'], [1, '2026-10-18'], [2, '2026-11-18'],
      [3, '2027-01-18'], [4, '2027-04-18'],
    ]);
  } finally { await db.close(); }
});

test('initial reconciliation uses all recorded first crossings for currently completed topics, skips past stages, and snapshots once per day', async () => {
  const db = await database();
  try {
    const a = await firstTopic(db, 'Matematik', 0);
    const b = await firstTopic(db, 'Matematik', 1);
    const c = await firstTopic(db, 'Matematik', 2);
    const noEvent = await firstTopic(db, 'Matematik', 3);
    await crossing(db, a.id, 2, '2026-10-01T10:00:00+03:00');
    await crossing(db, b.id, 3, '2026-10-01T11:00:00+03:00');
    await crossing(db, c.id, 4, '2026-09-01T10:00:00+03:00');
    await db.query('update public.topics set mastery=2 where id=$1', [noEvent.id]);
    const runId = randomUUID();
    const first = await reconcile(db, true, runId);
    assert.equal(first.results.length, 3);
    assert.equal((await db.query('select id from public.tasks where topic_id=$1', [noEvent.id])).rows.length, 0);
    const tasks = await db.query<{ topic_id: string; plan_date: string; title: string; priority: string; study_type: string }>(
      'select topic_id,plan_date::text,title,priority,study_type from public.tasks where topic_id=any($1::uuid[]) order by topic_id,plan_date',
      [[a.id,b.id,c.id]],
    );
    assert.equal(tasks.rows.length, 13);
    assert.ok(tasks.rows.every(row => row.title.endsWith(' Pekiştirme') && row.priority === 'low' && row.study_type === 'Aralıklı tekrar'));
    assert.equal(tasks.rows.filter(row => row.topic_id === c.id).length, 3);
    const oldStages = await db.query<{ stage: number; status: string }>(
      'select stage,status from private.topic_review_stages where topic_id=$1 order by stage', [c.id],
    );
    assert.deepEqual(oldStages.rows.slice(0, 2).map(row => row.status), ['skipped_past','skipped_past']);
    const snapshots = await db.query<{ plan_date: string; n: number }>(
      'select plan_date::text,count(*)::int n from public.daily_plan_versions where user_id=$1 and plan_date=$2 group by plan_date',
      [owner, '2026-10-04'],
    );
    assert.equal(snapshots.rows[0].n, 1);
    assert.deepEqual(await reconcile(db, true, runId), first);
    assert.equal((await db.query('select id from public.tasks where topic_id=any($1::uuid[])', [[a.id,b.id,c.id]])).rows.length, 13);
    const freshRun = await reconcile(db, true);
    assert.ok(freshRun.results.every(row => row.status === 'existing'));
  } finally { await db.close(); }
});

test('existing legacy task is retained while NULL identities become real review tasks', async () => {
  const db = await database();
  try {
    const topic = await firstTopic(db, 'Fizik', 0);
    await crossing(db, topic.id, 2, '2026-10-01T10:00:00+03:00');
    const history = (await db.query<{ id: string }>('select id from public.topic_history where topic_id=$1', [topic.id])).rows[0];
    const existing = (await db.query<{ id: string }>(
      "insert into public.tasks(user_id,title,plan_date,exam,subject,topic_id,priority,study_type) values($1,'Old review','2026-10-04','AYT','Fizik',$2,'low','Tekrar') returning id",
      [owner, topic.id],
    )).rows[0];
    await db.query('insert into private.topic_review_schedule(user_id,topic_id,step,plan_date,origin_history_id,task_id) values($1,$2,1,$3,$4,$5)', [owner,topic.id,'2026-10-04',history.id,existing.id]);
    await db.query('insert into private.topic_review_schedule(user_id,topic_id,step,plan_date,origin_history_id) select $1,$2,step,plan_date,$3 from private.topic_review_dates($4::date) where step>1', [owner,topic.id,history.id,'2026-10-01']);
    const result = await reconcile(db, true);
    assert.equal(result.results[0].status, 'created');
    assert.equal((await db.query<{ id: string }>('select id from public.tasks where topic_id=$1', [topic.id])).rows.length, 5);
    const linked = await db.query<{ task_id: string }>('select task_id from private.topic_review_stages where topic_id=$1 and stage=0', [topic.id]);
    assert.equal(linked.rows[0].task_id, existing.id);
    assert.equal((await db.query<{ task_id: string | null }>('select task_id from private.topic_review_schedule where topic_id=$1 and task_id is null', [topic.id])).rows.length, 0);
  } finally { await db.close(); }
});

test('trigger captures only first 1-to-2 crossing; transient task failure retries without duplicating delivered stages', async () => {
  const db = await database();
  try {
    const topic = await firstTopic(db, 'Kimya', 0);
    await db.query('update public.topics set mastery=2 where id=$1', [topic.id]);
    await db.query('insert into public.topic_history(user_id,topic_id,old_mastery,new_mastery,changed_at) values($1,$2,1,2,$3)', [owner,topic.id,'2026-10-01T10:00:00+03:00']);
    await db.query('insert into public.topic_history(user_id,topic_id,old_mastery,new_mastery,changed_at) values($1,$2,2,3,$3)', [owner,topic.id,'2026-10-01T11:00:00+03:00']);
    assert.equal((await db.query('select id from private.topic_review_series where topic_id=$1', [topic.id])).rows.length, 1);
    assert.equal((await db.query('select id from public.tasks where topic_id=$1', [topic.id])).rows.length, 0);
    await db.exec(`create function public.fail_review_test() returns trigger language plpgsql as $$
      begin if new.plan_date='2026-11-18'::date then raise exception 'TEST_RETRY'; end if; return new; end $$;
      create trigger fail_review_test before insert on public.tasks for each row execute function public.fail_review_test();`);
    const runId = randomUUID();
    const first = await reconcile(db, false, runId, '2026-09-30T23:00:00+03:00');
    assert.equal(first.results[0].status, 'retry_pending');
    assert.equal((await db.query('select id from public.tasks where topic_id=$1', [topic.id])).rows.length, 4);
    const before = (await db.query<{ id: string }>('select id from public.tasks where topic_id=$1 order by plan_date', [topic.id])).rows.map(row => row.id);
    await db.exec('drop trigger fail_review_test on public.tasks; drop function public.fail_review_test(); set role service_role;');
    const retry = await db.query<{ value: Array<{ results: Array<Record<string, unknown>> }> }>(
      'select public.topic_review_retry_pending(null,$1) value', [cutoff],
    );
    await db.exec('reset role');
    assert.equal(retry.rows[0].value.length, 1);
    assert.equal(retry.rows[0].value[0].results[0].status, 'created');
    const after = (await db.query<{ id: string }>('select id from public.tasks where topic_id=$1 order by plan_date', [topic.id])).rows.map(row => row.id);
    assert.equal(after.length, 5);
    assert.ok(before.every(id => after.includes(id)));
    const attempts = await db.query<{ stage: number; attempt_count: number }>(
      'select stage,attempt_count from private.topic_review_stages where topic_id=$1 order by stage', [topic.id],
    );
    assert.equal(attempts.rows[2].attempt_count, 2);
    assert.equal((await db.query('select id from private.topic_review_series where topic_id=$1', [topic.id])).rows.length, 1);
    const refreshed = await reconcile(db, false, runId, '2026-09-30T23:00:00+03:00');
    assert.equal(refreshed.results[0].status, 'existing');
    assert.equal((refreshed.results[0].task_ids as string[]).length, 5);
    await service(db);
    const persisted = await db.query<{ value: typeof refreshed }>('select public.topic_review_receipt($1,$2) value', [owner,runId]);
    await db.exec('reset role');
    assert.deepEqual(persisted.rows[0].value, refreshed);
  } finally { await db.close(); }
});

test('topic.create with mastery 2 is captured, service creates reviews, and browser cannot invoke review RPC', async () => {
  const db = await database();
  try {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false)`);
    const made = await db.query<{ value: { id: string } }>(
      'select public.yks_command($1,$2,$3::jsonb) value',
      [randomUUID(),'topic.create',JSON.stringify({exam:'TYT',subject:'Matematik',name:'Yeni işlenen konu',mastery:2})],
    );
    const id = made.rows[0].value.id;
    assert.equal((await db.query('select id from public.tasks where topic_id=$1', [id])).rows.length, 0);
    await assert.rejects(
      () => db.query('select public.topic_review_reconcile($1,$2)', [owner,cutoff]),
      /permission denied/,
    );
    await assert.rejects(() => db.query('select * from private.topic_review_stages'), /permission denied/);
    await db.exec('reset role');
    const actualCutoff = (await db.query<{ now: string }>('select clock_timestamp()::text as now')).rows[0].now;
    await service(db);
    const receipt = await db.query<{ value: { results: Array<Record<string, unknown>> } }>(
      'select public.topic_review_reconcile($1,$2,$3,$4,$5) value',
      [owner,actualCutoff,null,true,randomUUID()],
    );
    await db.exec('reset role');
    assert.equal(receipt.rows[0].value.results.length, 1);
    assert.equal((await db.query('select id from public.tasks where topic_id=$1', [id])).rows.length, 5);
  } finally { await db.close(); }
});

test('approved students use the same service-only review reconciliation and receipt contract', async () => {
  const db = await database();
  try {
    const student = randomUUID();
    await db.query('insert into auth.users(id) values($1)',[student]);
    await db.query("insert into public.classroom_accounts(id,name,email,role,status) values($1,'Student','student@example.test','student','approved')",[student]);
    await db.query('insert into public.profiles(user_id) values($1)',[student]);
    const topic = (await db.query<{ id: string }>(
      "insert into public.topics(user_id,exam,subject,name,mastery) values($1,'TYT','Matematik','Student topic',2) returning id",[student],
    )).rows[0];
    await db.query('insert into public.topic_history(user_id,topic_id,old_mastery,new_mastery,changed_at) values($1,$2,1,2,$3)',
      [student,topic.id,'2026-10-01T10:00:00+03:00']);
    const runId = randomUUID();
    await service(db);
    const result = await db.query<{ value: { results: Array<{ task_ids: string[] }> } }>(
      'select public.topic_review_reconcile($1,$2,$3,$4,$5) value',[student,cutoff,null,true,runId],
    );
    assert.equal(result.rows[0].value.results[0].task_ids.length,5);
    const receipt = await db.query<{ value: typeof result.rows[0]['value'] }>(
      'select public.topic_review_receipt($1,$2) value',[student,runId],
    );
    assert.deepEqual(receipt.rows[0].value,result.rows[0].value);
  } finally { await db.close(); }
});
