import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const owner='11111111-1111-4111-8111-111111111111';
const cleanup='20261001172426_purge_removed_review_plan_snapshots.sql';

test('snapshot cleanup preserves history for a manually deleted new review task',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;
      insert into auth.users values('${owner}');`);
    const migrations=new URL('../migrations/',import.meta.url);
    for(const name of (await readdir(migrations)).filter(name=>name.endsWith('.sql')&&name!==cleanup&&!name.includes('topic_review_series_reconcile')).sort()){
      await db.exec(await readFile(new URL(name,migrations),'utf8'));
    }
    await db.exec(`insert into public.owner_allowlist(user_id) values('${owner}');
      set role authenticated;
      select set_config('request.jwt.claim.sub','${owner}',false);
      select public.yks_state();`);
    const topic=(await db.query<{id:string}>("select id from public.topics where exam='AYT' and subject='Matematik' order by name limit 1")).rows[0];
    await db.query('select public.yks_command($1,$2,$3::jsonb)',[
      randomUUID(),'topic.update',JSON.stringify({id:topic.id,expected_revision:1,mastery:2}),
    ]);
    const task=(await db.query<{id:string;plan_date:string}>(
      'select id,plan_date::text from public.tasks where topic_id=$1 order by plan_date limit 1',[topic.id],
    )).rows[0];
    const original=(await db.query<{id:string}>(`select v.id from public.daily_plan_versions v
      where v.user_id=$1 and v.plan_date=$2 and exists(
        select 1 from jsonb_array_elements(v.snapshot) entry where entry->>'id'=$3
      ) order by v.version limit 1`,[owner,task.plan_date,task.id])).rows[0];
    assert.ok(original);
    await db.query('select public.yks_command($1,$2,$3::jsonb)',[
      randomUUID(),'task.delete',JSON.stringify({id:task.id,expected_revision:1}),
    ]);
    assert.equal((await db.query('select id from public.tasks where id=$1',[task.id])).rows.length,0);
    await db.exec('reset role');
    await db.exec(await readFile(new URL(cleanup,migrations),'utf8'));
    assert.equal((await db.query('select id from public.daily_plan_versions where id=$1',[original.id])).rows.length,1);
  }finally{await db.close()}
});
