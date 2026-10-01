import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const plan = { months: [], daily_minutes: 100, buffer_ratio: 0.15 };

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
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

async function setPlan(db: PGlite, value = plan) {
  await db.exec('set role service_role');
  await db.query('select public.coaching_plan_set($1,$2::jsonb)', [owner,JSON.stringify(value)]);
  await db.exec('reset role');
}

async function begin(db: PGlite, runId: string) {
  await db.exec('set role service_role');
  try {
    const result = await db.query<{ value: { cutoff: string; status: string; plan: typeof plan; source_state: object } }>(
      'select public.coaching_run_begin($1,$2) value', [owner,runId],
    );
    return result.rows[0].value;
  } finally { await db.exec('reset role'); }
}

test('coaching run freezes source and plan, serializes owner, and retry preserves the cutoff', async () => {
  const db = await database();
  try {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false)`);
    await assert.rejects(() => db.query('select public.coaching_plan_set($1,$2::jsonb)', [owner,JSON.stringify(plan)]), /permission denied/);
    await assert.rejects(() => db.query('select * from private.coaching_runs'), /permission denied/);
    await db.exec('reset role');
    await setPlan(db);
    await db.exec('set role service_role');
    await assert.rejects(() => db.query('select public.coaching_plan_set($1,$2::jsonb)',
      [owner,JSON.stringify({ months: [], daily_minutes: 100 })]), /INVALID_COACHING_PLAN/);
    await assert.rejects(() => db.query('select public.coaching_plan_set($1,$2::jsonb)',
      [owner,JSON.stringify({ months: [], daily_minutes: 100, buffer_ratio: 0.2 })]), /INVALID_COACHING_PLAN/);
    await db.exec('reset role');
    const runId = randomUUID();
    const first = await begin(db,runId);
    assert.equal(first.status,'running');
    assert.deepEqual(first.plan,plan);
    assert.ok(first.source_state);
    await assert.rejects(() => begin(db,runId), /COACHING_BUSY/);
    await assert.rejects(() => begin(db,randomUUID()), /COACHING_BUSY/);
    await setPlan(db,{ months: [], daily_minutes: 300, buffer_ratio: 0.15 });
    await db.exec('set role service_role');
    await db.query('select public.coaching_run_fail($1,$2)', [owner,runId]);
    await db.exec('reset role');
    const retried = await begin(db,runId);
    assert.equal(retried.status,'running');
    assert.equal(retried.cutoff,first.cutoff);
    assert.deepEqual(retried.plan,first.plan);
    assert.deepEqual(retried.source_state,first.source_state);
  } finally { await db.close(); }
});

test('homework requires active run, reuses manual work, respects frozen daily capacity, and snapshots once', async () => {
  const db = await database();
  try {
    await setPlan(db);
    const day = (await db.query<{ local_day: string }>("select (clock_timestamp() at time zone 'Europe/Istanbul')::date::text as local_day")).rows[0].local_day;
    const topics = (await db.query<{ id: string }>(
      "select id from public.topics where exam='AYT' and subject='Matematik' order by name limit 3",
    )).rows;
    const manual = (await db.query<{ id: string }>(
      "insert into public.tasks(user_id,title,plan_date,exam,subject,topic_id,study_type,planned_minutes) values($1,'Manual practice',$2,'AYT','Matematik',$3,'Soru çözümü',30) returning id",
      [owner,day,topics[0].id],
    )).rows[0];
    const runId = randomUUID();
    const candidates = topics.map((topic,index) => ({
      key: `homework-${index}`,topic_id:topic.id,title:`Ödev ${index}`,
      plan_date:day,planned_minutes:index===0?30:index===1?40:20,
      priority:'high',study_type:'Soru çözümü',completion_criteria:'20 soru çöz',reason:'Konu eksiği',
    }));
    await db.exec('set role service_role');
    await assert.rejects(() => db.query('select public.coaching_homework_create($1,$2,$3::jsonb)',
      [owner,runId,JSON.stringify(candidates)]), /COACHING_RUN_REQUIRED/);
    await db.exec('reset role');
    await begin(db,runId);
    await db.exec('set role service_role');
    const first = await db.query<{ value: { results: Array<{ status: string; task_ids: string[] }> } }>(
      'select public.coaching_homework_create($1,$2,$3::jsonb) value',
      [owner,runId,JSON.stringify(candidates)],
    );
    await db.exec('reset role');
    assert.deepEqual(first.rows[0].value.results.map(row => row.status), ['existing','created','capacity_exceeded']);
    assert.deepEqual(first.rows[0].value.results[0].task_ids,[manual.id]);
    await db.exec('set role service_role');
    const context = await db.query<{ value: { homework_results: Array<{ key: string; status: string }> } }>(
      'select public.coaching_context($1) value',[owner],
    );
    await db.exec('reset role');
    assert.equal(context.rows[0].value.homework_results.find(row=>row.key==='homework-0')?.status,'existing');
    assert.equal(context.rows[0].value.homework_results.find(row=>row.key==='homework-1')?.status,'created');
    assert.equal((await db.query('select id from public.tasks where topic_id=any($1::uuid[])', [topics.map(topic=>topic.id)])).rows.length,2);
    const plans = await db.query<{ count: number }>(
      'select count(*)::int count from public.daily_plan_versions where user_id=$1 and plan_date=$2', [owner,day],
    );
    assert.equal(plans.rows[0].count,2); // Initial owner plan, then one batched homework snapshot.
    await setPlan(db,{ months: [], daily_minutes: 500, buffer_ratio: 0.15 });
    await db.exec('set role service_role');
    const replay = await db.query<{ value: { results: Array<{ status: string; task_ids: string[] }> } }>(
      'select public.coaching_homework_create($1,$2,$3::jsonb) value',
      [owner,runId,JSON.stringify(candidates)],
    );
    assert.deepEqual(replay.rows[0].value.results.map(row => row.status), ['existing','existing','capacity_exceeded']);
    assert.deepEqual(replay.rows[0].value.results[1].task_ids,first.rows[0].value.results[1].task_ids);
    await db.query('select public.coaching_run_fail($1,$2)', [owner,runId]);
    await assert.rejects(() => db.query('select public.coaching_homework_create($1,$2,$3::jsonb)',
      [owner,runId,JSON.stringify(candidates)]), /COACHING_RUN_REQUIRED/);
  } finally { await db.close(); }
});

test('report finalization requires a review receipt and commits report with the successful cutoff', async () => {
  const db = await database();
  try {
    await setPlan(db);
    const runId = randomUUID();
    const run = await begin(db,runId);
    await db.exec('update private.ai_budget_policy set enabled=true,monthly_budget_usd=10');
    await db.exec('set role service_role');
    const claim = await db.query<{ value: { report: { id: string } } }>(
      "select public.analysis_report_claim_for_owner($1,$2,'2026-09-25','2026-10-01',$3,10,10,0.1) value",
      [owner,runId,'a'.repeat(64)],
    );
    const reportId = claim.rows[0].value.report.id;
    const finish = () => db.query(
      'select public.coaching_report_finalize($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
      [owner,runId,reportId,'Rapor',JSON.stringify({coaching:{tasks:1}}),JSON.stringify({}),0.05],
    );
    await assert.rejects(finish, /COACHING_REVIEW_RECEIPT_REQUIRED/);
    await db.query('select public.topic_review_reconcile($1,$2,$3,$4,$5)', [owner,run.cutoff,null,true,runId]);
    await finish();
    await finish();
    await db.exec('reset role');
    const state = await db.query<{ status: string; report_id: string; cutoff: string }>(
      'select status,report_id,cutoff::text from private.coaching_runs where user_id=$1 and run_id=$2', [owner,runId],
    );
    assert.equal(state.rows[0].status,'completed');
    assert.equal(state.rows[0].report_id,reportId);
    const report = await db.query<{ status: string }>('select status from public.analysis_reports where id=$1', [reportId]);
    assert.equal(report.rows[0].status,'completed');
    await db.exec('set role service_role');
    const context = await db.query<{ value: { previous_cutoff: string; previous_report_id: string } }>(
      'select public.coaching_context($1) value',[owner],
    );
    assert.equal(context.rows[0].value.previous_report_id,reportId);
    assert.equal(context.rows[0].value.previous_cutoff,run.cutoff);
  } finally { await db.close(); }
});

test('pending reviews block finalization until the original run receipt is refreshed', async () => {
  const db = await database();
  try {
    await setPlan(db);
    const topic = (await db.query<{ id: string }>(
      "select id from public.topics where exam='TYT' and subject='Kimya' order by name limit 1",
    )).rows[0];
    await db.query('update public.topics set mastery=2 where id=$1',[topic.id]);
    await db.query("insert into public.topic_history(user_id,topic_id,old_mastery,new_mastery,changed_at) values($1,$2,1,2,clock_timestamp()-interval '1 minute')",[owner,topic.id]);
    const runId = randomUUID();
    const run = await begin(db,runId);
    await db.exec(`create function public.fail_repetition_for_coach() returns trigger language plpgsql as $$
      begin if new.study_type='Aralıklı tekrar' then raise exception 'TEST_FAIL'; end if; return new; end $$;
      create trigger fail_repetition_for_coach before insert on public.tasks for each row execute function public.fail_repetition_for_coach();`);
    await db.exec('set role service_role');
    const receipt = await db.query<{ value: { results: Array<{ status: string }> } }>(
      'select public.topic_review_reconcile($1,$2,$3,$4,$5) value',
      [owner,run.cutoff,null,true,runId],
    );
    assert.equal(receipt.rows[0].value.results[0].status,'retry_pending');
    await assert.rejects(
      () => db.query('select public.coaching_report_finalize($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
        [owner,runId,randomUUID(),'Report',JSON.stringify({}),JSON.stringify({}),0]),
      /COACHING_REVIEWS_PENDING/,
    );
    await db.exec('reset role; drop trigger fail_repetition_for_coach on public.tasks; drop function public.fail_repetition_for_coach(); set role service_role;');
    await db.query('select public.topic_review_retry_pending($1,$2)',[owner,run.cutoff]);
    const refreshed = await db.query<{ value: { results: Array<{ status: string }> } }>(
      'select public.topic_review_reconcile($1,$2,$3,$4,$5) value',
      [owner,run.cutoff,null,true,runId],
    );
    assert.equal(refreshed.rows[0].value.results[0].status,'existing');
    await assert.rejects(
      () => db.query('select public.coaching_report_finalize($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
        [owner,runId,randomUUID(),'Report',JSON.stringify({}),JSON.stringify({}),0]),
      /REPORT_NOT_FOUND/,
    );
  } finally { await db.close(); }
});

test('an expired older run cannot finalize after a newer run begins', async () => {
  const db = await database();
  try {
    await setPlan(db);
    const olderId = randomUUID();
    await begin(db,olderId);
    await db.query("update private.coaching_runs set lease_until=clock_timestamp()-interval '1 second' where user_id=$1 and run_id=$2",[owner,olderId]);
    await begin(db,randomUUID());
    await db.exec('set role service_role');
    await assert.rejects(
      () => db.query('select public.coaching_report_finalize($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',
        [owner,olderId,randomUUID(),'Report',JSON.stringify({}),JSON.stringify({}),0]),
      /COACHING_STALE_RUN/,
    );
  } finally { await db.close(); }
});
