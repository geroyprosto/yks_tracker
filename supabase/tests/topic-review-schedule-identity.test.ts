import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const repair = '20261001173055_restore_topic_review_schedule_identity.sql';

test('historical first completion restores missing schedule identity without adding tasks', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      insert into auth.users values('${owner}');`);
    const migrations = new URL('../migrations/', import.meta.url);
    for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql') && name !== repair && !name.includes('topic_review_series_reconcile')).sort()) {
      await db.exec(await readFile(new URL(name, migrations), 'utf8'));
    }
    await db.exec(`insert into public.owner_allowlist(user_id) values('${owner}');
      set role authenticated;
      select set_config('request.jwt.claim.sub','${owner}',false);
      select public.yks_state();`);
    const topics = (await db.query<{ id: string }>("select id from public.topics where exam='AYT' and subject='Matematik' order by name limit 4")).rows;
    const update = (id: string, revision: number, mastery: number) => db.query(
      'select public.yks_command($1,$2,$3::jsonb)',
      [randomUUID(), 'topic.update', JSON.stringify({ id, expected_revision: revision, mastery })],
    );
    await update(topics[0].id, 1, 2);
    await update(topics[1].id, 1, 2);
    await db.exec('reset role');
    const kept = (await db.query<{ step: number; task_id: string }>(
      'select step,task_id from private.topic_review_schedule where topic_id=$1 and step in(1,3,5) order by step', [topics[1].id],
    )).rows;
    await db.query('delete from private.topic_review_schedule where topic_id=$1', [topics[0].id]);
    await db.query('delete from public.tasks where topic_id=$1', [topics[0].id]);
    const removedPartial = (await db.query<{ task_id: string }>(
      'delete from private.topic_review_schedule where topic_id=$1 and step in(2,4) returning task_id', [topics[1].id],
    )).rows.map(row => row.task_id);
    await db.query('delete from public.tasks where id=any($1::uuid[])', [removedPartial]);
    const taskCount = (await db.query<{ count: number }>('select count(*)::int as count from public.tasks where user_id=$1', [owner])).rows[0].count;
    await db.exec(await readFile(new URL(repair, migrations), 'utf8'));
    await db.exec(await readFile(new URL(repair, migrations), 'utf8'));
    assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.tasks where user_id=$1', [owner])).rows[0].count, taskCount);
    const restored = (await db.query<{ step: number; plan_date: string; origin_history_id: string; task_id: string | null }>(
      'select step,plan_date::text,origin_history_id,task_id from private.topic_review_schedule where topic_id=$1 order by step', [topics[0].id],
    )).rows;
    assert.equal(restored.length, 5);
    assert.ok(restored.every(row => row.task_id === null));
    const firstHistory = (await db.query<{ id: string; local_day: string }>(
      `select h.id,(h.changed_at at time zone p.timezone)::date::text as local_day
       from public.topic_history h join public.profiles p on p.user_id=h.user_id
       where h.topic_id=$1 and h.old_mastery<2 and h.new_mastery>=2 order by h.changed_at,h.id limit 1`, [topics[0].id],
    )).rows[0];
    const expected = (await db.query<{ step: number; plan_date: string }>(
      'select step,plan_date::text from private.topic_review_dates($1::date)', [firstHistory.local_day],
    )).rows;
    assert.deepEqual(restored.map(row => [row.step, row.plan_date, row.origin_history_id]),
      expected.map(row => [row.step, row.plan_date, firstHistory.id]));
    const partial = (await db.query<{ step: number; task_id: string | null }>(
      'select step,task_id from private.topic_review_schedule where topic_id=$1 order by step', [topics[1].id],
    )).rows;
    assert.equal(partial.length, 5);
    assert.deepEqual(partial.filter(row => row.task_id !== null), kept);
    assert.equal((await db.query('select step from private.topic_review_schedule where topic_id=$1', [topics[2].id])).rows.length, 0);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false)`);
    await update(topics[0].id, 2, 1);
    await update(topics[0].id, 3, 2);
    assert.equal((await db.query('select id from public.tasks where topic_id=$1', [topics[0].id])).rows.length, 0);
    await update(topics[3].id, 1, 2);
    assert.equal((await db.query('select id from public.tasks where topic_id=$1', [topics[3].id])).rows.length, 5);
  } finally {
    await db.close();
  }
});
