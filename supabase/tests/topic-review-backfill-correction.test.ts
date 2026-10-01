import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const correction = '20261001171631_remove_historical_topic_review_backfill.sql';
const snapshotCleanup = '20261001172426_purge_removed_review_plan_snapshots.sql';

test('correction removes only untouched delayed reviews and refreshes their day plans', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;
      insert into auth.users values('${owner}');`);
    const migrations = new URL('../migrations/', import.meta.url);
    for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql') && name !== correction && name !== snapshotCleanup).sort()) {
      await db.exec(await readFile(new URL(name, migrations), 'utf8'));
    }
    await db.exec(`insert into public.owner_allowlist(user_id) values('${owner}');
      set role authenticated;
      select set_config('request.jwt.claim.sub','${owner}',false);
      select public.yks_state();`);
    const topics = (await db.query<{ id: string }>("select id from public.topics where exam='AYT' and subject='Matematik' order by name limit 3")).rows;
    const command = async (type: string, payload: object) => db.query(
      'select public.yks_command($1,$2,$3::jsonb)', [randomUUID(), type, JSON.stringify(payload)],
    );

    await command('topic.update', { id: topics[0].id, expected_revision: 1, mastery: 2 });
    await command('topic.update', { id: topics[1].id, expected_revision: 1, mastery: 2 });
    const delayed = (await db.query<{ id: string; plan_date: string }>(
      'select id,plan_date::text from public.tasks where topic_id=$1 order by plan_date', [topics[0].id],
    )).rows;
    const fresh = (await db.query<{ id: string }>('select id from public.tasks where topic_id=$1', [topics[1].id])).rows;
    assert.equal(delayed.length, 5);
    assert.equal(fresh.length, 5);

    // Simulate the original migration running long after the recorded status change.
    await db.exec('reset role');
    await db.query("update public.topic_history set changed_at=now()-interval '2 hours' where topic_id=$1", [topics[0].id]);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false)`);
    await command('topic.update', { id: topics[0].id, expected_revision: 2, name: 'Yeniden adlandırılan konu' });
    await command('task.update', { id: delayed[0].id, expected_revision: 1, progress: 0.5 });
    const started = (await db.query<{ value: { id: string } }>(
      'select public.yks_command($1,$2,$3::jsonb) as value',
      [randomUUID(), 'timer.start', JSON.stringify({ task_id: delayed[1].id })],
    )).rows[0].value;
    await command('timer.finish', { id: started.id, expected_revision: 1 });
    await command('task.create', {
      title: 'Elle eklenmiş Pekiştirme (Düşük Öncelik)', plan_date: delayed[0].plan_date,
      topic_id: topics[0].id, priority: 'low', study_type: 'Tekrar', planned_minutes: 20,
    });
    const manual = (await db.query<{ id: string }>(
      "select id from public.tasks where topic_id=$1 and title='Elle eklenmiş Pekiştirme (Düşük Öncelik)'", [topics[0].id],
    )).rows[0];
    const beforeVersions = (await db.query<{ plan_date: string; version: number }>(
      'select plan_date::text,max(version)::int as version from public.daily_plan_versions where user_id=$1 and plan_date=any($2::date[]) group by plan_date',
      [owner, delayed.map(task => task.plan_date)],
    )).rows;

    await db.exec('reset role');
    await db.exec(await readFile(new URL(correction, migrations), 'utf8'));
    const remaining = (await db.query<{ id: string }>('select id from public.tasks where topic_id=$1', [topics[0].id])).rows.map(row => row.id);
    assert.deepEqual(new Set(remaining), new Set([delayed[0].id, delayed[1].id, manual.id]));
    assert.equal((await db.query('select id from public.tasks where topic_id=$1', [topics[1].id])).rows.length, 5);
    assert.equal((await db.query('select step from private.topic_review_schedule where topic_id=$1', [topics[0].id])).rows.length, 2);
    assert.equal((await db.query('select step from private.topic_review_schedule where topic_id=$1', [topics[1].id])).rows.length, 5);
    const removedIds = delayed.filter(task => !remaining.includes(task.id)).map(task => task.id);
    assert.equal((await db.query(
      "select id from public.audit_log where action='topic.review.schedule' and entity_id=any($1::uuid[])", [removedIds],
    )).rows.length, 0);
    assert.equal((await db.query(
      "select id from public.audit_log where action='topic.review.schedule' and entity_id=any($1::uuid[])",
      [[delayed[0].id, delayed[1].id, ...fresh.map(task => task.id)]],
    )).rows.length, 7);
    for (const prior of beforeVersions) {
      const latest = (await db.query<{ version: number; snapshot: Array<{ id: string }> }>(
        'select version,snapshot from public.daily_plan_versions where user_id=$1 and plan_date=$2 order by version desc limit 1',
        [owner, prior.plan_date],
      )).rows[0];
      const removedOnDay = delayed.filter(task => task.plan_date === prior.plan_date && !remaining.includes(task.id));
      assert.equal(latest.version, prior.version + (removedOnDay.length ? 1 : 0));
      assert.ok(removedOnDay.every(task => !latest.snapshot.some(snapshotTask => snapshotTask.id === task.id)));
      assert.ok(fresh.some(task => latest.snapshot.some(snapshotTask => snapshotTask.id === task.id)));
    }

    const latestBeforeCleanup = (await db.query<{ id: string; plan_date: string }>(
      'select distinct on(plan_date) id,plan_date::text from public.daily_plan_versions where user_id=$1 and plan_date=any($2::date[]) order by plan_date,version desc',
      [owner, delayed.map(task => task.plan_date)],
    )).rows;
    const obsoleteVersions = (await db.query<{ id: string }>(
      `select v.id from public.daily_plan_versions v where v.user_id=$1 and exists(
        select 1 from jsonb_array_elements(v.snapshot) entry
        where entry->>'id'=any($2::text[]) and (entry->>'created_at')::timestamptz=v.changed_at
      )`, [owner, removedIds],
    )).rows.map(row => row.id);
    assert.ok(obsoleteVersions.length >= 3);
    await db.exec('set role service_role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: 'service_role', aud: 'service_role' })]);
    const stateBefore = (await db.query<{ value: { day_plans: unknown[] } }>(
      'select public.mcp_owner_state($1::uuid) as value', [owner],
    )).rows[0].value;
    await db.exec('reset role');
    await db.exec(await readFile(new URL(snapshotCleanup, migrations), 'utf8'));
    const latestAfterCleanup = (await db.query<{ id: string; plan_date: string }>(
      'select distinct on(plan_date) id,plan_date::text from public.daily_plan_versions where user_id=$1 and plan_date=any($2::date[]) order by plan_date,version desc',
      [owner, delayed.map(task => task.plan_date)],
    )).rows;
    assert.deepEqual(latestAfterCleanup, latestBeforeCleanup);
    assert.equal((await db.query('select id from public.daily_plan_versions where id=any($1::uuid[])', [obsoleteVersions])).rows.length, 0);
    await db.exec('set role service_role');
    const stateAfter = (await db.query<{ value: { day_plans: unknown[] } }>(
      'select public.mcp_owner_state($1::uuid) as value', [owner],
    )).rows[0].value;
    assert.ok(stateAfter.day_plans.length < stateBefore.day_plans.length);
    assert.ok(JSON.stringify(stateAfter).length < JSON.stringify(stateBefore).length);
    await db.exec('reset role');
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false)`);
    await command('topic.update', { id: topics[2].id, expected_revision: 1, mastery: 2 });
    assert.equal((await db.query('select id from public.tasks where topic_id=$1', [topics[2].id])).rows.length, 5);
  } finally {
    await db.close();
  }
});
