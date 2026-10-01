import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';

async function createDatabase(beforeReviewMigration = false) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    insert into auth.users values('${owner}');`);
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql') &&
    !name.includes('topic_review_series_reconcile') && (!beforeReviewMigration ||
    !['topic_spaced_repetition', 'remove_historical_topic_review_backfill',
      'purge_removed_review_plan_snapshots', 'restore_topic_review_schedule_identity'].some(part => name.includes(part)))).sort()) {
    await db.exec(await readFile(new URL(name, migrations), 'utf8'));
  }
  await db.exec(`insert into public.owner_allowlist(user_id) values('${owner}');
    set role authenticated;
    select set_config('request.jwt.claim.sub','${owner}',false);
    select public.yks_state();`);
  return db;
}

async function updateTopic(db: PGlite, id: string, revision: number, changes: Record<string, unknown>, requestId = randomUUID()) {
  return db.query('select public.yks_command($1,$2,$3::jsonb)', [requestId, 'topic.update', JSON.stringify({ id, expected_revision: revision, ...changes })]);
}

test('repetition dates use completion-week Sunday and successive Sunday-rounded calendar offsets', async () => {
  const db = await createDatabase();
  try {
    await db.exec('reset role');
    const dates = await db.query<{ step: number; plan_date: string }>("select step,plan_date::text from private.topic_review_dates('2026-10-01'::date)");
    assert.deepEqual(dates.rows.map(row => [row.step, row.plan_date]), [
      [1, '2026-10-04'], [2, '2026-10-18'], [3, '2026-11-22'], [4, '2027-01-24'], [5, '2027-04-25'],
    ]);
    const sunday = await db.query<{ step: number; plan_date: string }>("select step,plan_date::text from private.topic_review_dates('2026-11-29'::date)");
    assert.equal(sunday.rows[0].plan_date, '2026-11-29');
  } finally {
    await db.close();
  }
});

test('first topic instruction completion creates five linked low-priority tasks exactly once', async () => {
  const db = await createDatabase();
  try {
    const topic = (await db.query<{ id: string; name: string }>("select id,name from public.topics where exam='AYT' and subject='Matematik' order by name limit 1")).rows[0];
    await db.exec('reset role');
    const course = (await db.query<{ id: string }>("insert into public.education_courses(user_id,name,context,exam) values($1,'Matematik','yks','AYT') returning id", [owner])).rows[0];
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false)`);
    await updateTopic(db, topic.id, 1, { mastery: 1 });
    assert.equal((await db.query('select id from public.tasks where topic_id=$1', [topic.id])).rows.length, 0);
    const requestId = randomUUID();
    await updateTopic(db, topic.id, 2, { mastery: 2 }, requestId);
    await updateTopic(db, topic.id, 2, { mastery: 2 }, requestId);
    let tasks = (await db.query<{ title: string; priority: string; plan_date: string; study_type: string; exam: string; subject: string; course_id: string | null }>(
      'select title,priority,plan_date::text,study_type,exam,subject,course_id from public.tasks where topic_id=$1 order by plan_date', [topic.id],
    )).rows;
    assert.equal(tasks.length, 5);
    assert.ok(tasks.every(task => task.title === `${topic.name} Pekiştirme (Düşük Öncelik)`));
    assert.ok(tasks.every(task => task.priority === 'low' && task.study_type === 'Tekrar' && task.exam === 'AYT' && task.subject === 'Matematik'));
    assert.ok(tasks.every(task => task.course_id === course.id));
    assert.ok(tasks.every(task => new Date(`${task.plan_date}T00:00:00Z`).getUTCDay() === 0));
    await updateTopic(db, topic.id, 3, { mastery: 3, review_requested: true });
    await updateTopic(db, topic.id, 4, { mastery: 1 });
    await updateTopic(db, topic.id, 5, { mastery: 2 });
    tasks = (await db.query('select id from public.tasks where topic_id=$1', [topic.id])).rows as typeof tasks;
    assert.equal(tasks.length, 5);
    const removed = (await db.query<{ id: string }>('select id from public.tasks where topic_id=$1 order by plan_date limit 1', [topic.id])).rows[0];
    await db.query('select public.yks_command($1,$2,$3::jsonb)', [randomUUID(), 'task.delete', JSON.stringify({ id: removed.id, expected_revision: 1 })]);
    await updateTopic(db, topic.id, 6, { mastery: 1 });
    await updateTopic(db, topic.id, 7, { mastery: 2 });
    assert.equal((await db.query('select id from public.tasks where topic_id=$1', [topic.id])).rows.length, 4);
    await db.exec('reset role');
    const schedules = await db.query<{ task_id: string | null }>('select task_id from private.topic_review_schedule where topic_id=$1', [topic.id]);
    assert.equal(schedules.rows.length, 5);
    assert.equal(schedules.rows.filter(row => row.task_id === null).length, 1);
  } finally {
    await db.close();
  }
});

test('creating an already completed topic schedules reviews through command history and keeps schedule private', async () => {
  const db = await createDatabase();
  try {
    const created = (await db.query<{ value: { id: string } }>(
      'select public.yks_command($1,$2,$3::jsonb) as value',
      [randomUUID(), 'topic.create', JSON.stringify({ exam: 'TYT', subject: 'Matematik', name: 'Yeni biten konu', mastery: 2 })],
    )).rows[0].value;
    assert.equal((await db.query('select id from public.topic_history where topic_id=$1 and old_mastery=0 and new_mastery=2', [created.id])).rows.length, 1);
    assert.equal((await db.query('select id from public.tasks where topic_id=$1 and priority=$2', [created.id, 'low'])).rows.length, 5);
    await assert.rejects(() => db.query('select * from private.topic_review_schedule'), /permission denied/);
    await db.exec('reset role');
    await db.query('delete from auth.users where id=$1', [owner]);
    assert.equal((await db.query('select topic_id from private.topic_review_schedule where topic_id=$1', [created.id])).rows.length, 0);
  } finally {
    await db.close();
  }
});

test('migration backfills only real completion transitions from the current local week', async () => {
  const db = await createDatabase(true);
  try {
    const topics = (await db.query<{ id: string }>("select id from public.topics where exam='TYT' and subject='Matematik' order by name limit 3")).rows;
    await db.exec('reset role');
    await db.query('update public.topics set mastery=2 where id=$1', [topics[0].id]);
    await db.query("insert into public.topic_history(user_id,topic_id,old_mastery,new_mastery,changed_at) values($1,$2,1,2,now())", [owner, topics[0].id]);
    await db.query('update public.topics set mastery=2 where id=$1', [topics[1].id]);
    await db.query("insert into public.topic_history(user_id,topic_id,old_mastery,new_mastery,changed_at) values($1,$2,1,2,now()-interval '14 days')", [owner, topics[1].id]);
    await db.query('update public.topics set mastery=2 where id=$1', [topics[2].id]);
    const migrations = new URL('../migrations/', import.meta.url);
    const name = (await readdir(migrations)).find(file => file.includes('topic_spaced_repetition') && file.endsWith('.sql'))!;
    await db.exec(await readFile(new URL(name, migrations), 'utf8'));
    assert.equal((await db.query('select id from public.tasks where topic_id=$1', [topics[0].id])).rows.length, 5);
    assert.equal((await db.query('select id from public.tasks where topic_id=$1', [topics[1].id])).rows.length, 0);
    assert.equal((await db.query('select id from public.tasks where topic_id=$1', [topics[2].id])).rows.length, 0);
  } finally {
    await db.close();
  }
});
