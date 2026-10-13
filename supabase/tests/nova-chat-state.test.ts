import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const A = randomUUID(), B = randomUUID(), NO_ACCESS = randomUUID(), PENDING = randomUUID(), REVOKED = randomUUID(), EMPTY = randomUUID();
const PRIVATE_VALUE = 'must-not-leave-database';
let db: PGlite;
type Row = Record<string, unknown>;
type ChatState = { server_now: string; messages: Row[]; jobs: Row[]; devices: Row[] };

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;`);
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort())
    await db.exec(await readFile(new URL(file, dir), 'utf8'));
  for (const id of [A, B, NO_ACCESS, PENDING, REVOKED, EMPTY]) {
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id, `${id}@example.test`]);
    await db.query("insert into public.classroom_accounts(id,name,email,role,status) values($1,$2,$3,'student',$4)",
      [id, id, `${id}@example.test`, id === PENDING ? 'pending' : 'approved']);
    if (id !== NO_ACCESS) await db.query('insert into public.nova_access_grants(owner_id,revoked_at) values($1,$2)', [id, id === REVOKED ? new Date().toISOString() : null]);
  }
  for (const owner of [A, B]) {
    await db.query("insert into public.nova_profiles(owner_id,personality,baseline,engine_version) values($1,'{}','{}','test-v1')", [owner]);
    await db.query(`insert into public.nova_messages(owner_id,nova_id,sender,content,sequence,created_at)
      select owner_id,id,'USER',case when owner_id=$1 then 'Owner A ' else 'Owner B ' end||s,s,now()+s*interval '1 second'
      from public.nova_profiles cross join generate_series(1,$3) s where owner_id=$2`, [A, owner, owner === A ? 105 : 1]);
    await db.query(`insert into public.nova_ai_jobs(owner_id,nova_id,source_message_id,status,attempt_count,request_id,
      request_payload,context_hint,context_snapshot,context_version,claim_token,lease_expires_at,generation_metrics,created_at,started_at,completed_at)
      select owner_id,nova_id,id,'COMPLETED',1,gen_random_uuid(),$2::jsonb,$2::jsonb,$2::jsonb,$3,gen_random_uuid(),now(),
      '{"durationMs":4000,"inputTokens":300,"outputTokens":80}',created_at,created_at+interval '1 second',created_at+interval '5 seconds'
      from public.nova_messages where owner_id=$1`, [owner, JSON.stringify({ privateValue: PRIVATE_VALUE }), PRIVATE_VALUE]);
  }
  await db.query(`insert into public.nova_messages(owner_id,nova_id,sender,content,sequence,source_message_id,job_id,delivery_status,result,action_status)
    select owner_id,nova_id,'NOVA','Birlikte odaklanabiliriz.',106,source_message_id,id,'ANSWERED',$2::jsonb,'PENDING'
    from public.nova_ai_jobs where owner_id=$1 order by created_at desc limit 1`, [A, JSON.stringify({
      reply: PRIVATE_VALUE, memoryCandidates: [{ content: PRIVATE_VALUE }], referencedFactIds: [PRIVATE_VALUE],
      proposedAction: { type: 'OFFER_FOCUS_DUEL', durationMinutes: 15, privateValue: PRIVATE_VALUE },
    })]);
  await db.query(`insert into public.nova_devices(owner_id,name,revoked_at,created_at)
    select $1,'Old device '||s,now(),now()+s*interval '1 second' from generate_series(1,30) s`, [A]);
  await db.query("insert into public.nova_devices(owner_id,name,version,model,model_available,last_seen_at,created_at) values($1,'Active device','1.0.0','qwen3:8b',true,now(),now()-interval '1 day'),($2,'Other owner device',null,null,false,null,now())", [A, B]);
  await db.query("insert into private.nova_device_credentials(device_id,secret_hash) select id,repeat('a',64) from public.nova_devices");
});
after(async () => { await db?.close(); });

async function browser(id = A) {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role: 'authenticated' })]);
  await db.query("select set_config('request.jwt.claim.client_id','',false)");
}
async function chat(schema = 'public'): Promise<ChatState> {
  return (await db.query<{ value: ChatState }>(`select ${schema}.nova_chat_state() as value`)).rows[0].value;
}

test('chat snapshot is bounded, ordered, owner scoped and exposes only display fields', async () => {
  await browser();
  const value = await chat();
  assert.deepEqual(Object.keys(value).sort(), ['devices', 'jobs', 'messages', 'server_now']);
  assert.ok(Math.abs(Date.parse(value.server_now) - Date.now()) < 10_000);
  assert.equal(value.messages.length, 100);
  assert.deepEqual(value.messages.map(m => m.sequence), Array.from({ length: 100 }, (_, i) => i + 7));
  assert.equal(value.jobs.length, 100);
  assert.ok(value.jobs.every((j, i, jobs) => i === 0 || String(j.created_at) >= String(jobs[i - 1].created_at)));
  assert.equal(value.devices.length, 25);
  assert.equal(value.devices[0].name, 'Active device');
  assert.ok(value.jobs.every(j => j.started_at && j.completed_at));
  assert.deepEqual(value.jobs[0].generation_metrics, { durationMs: 4000, inputTokens: 300, outputTokens: 80 });
  assert.deepEqual(value.messages.at(-1)?.result, { proposedAction: { type: 'OFFER_FOCUS_DUEL', durationMinutes: 15 } });
  assert.equal(value.messages.at(-1)?.action_status, 'PENDING');
  assert.deepEqual(Object.keys(value.messages[0]).sort(), ['action_status','content','created_at','delivery_status','id','job_id','result','sender','sequence','source_message_id']);
  assert.deepEqual(Object.keys(value.jobs[0]).sort(), ['attempt_count','completed_at','created_at','error','generation_metrics','id','kind','next_attempt_at','source_message_id','started_at','status']);
  assert.deepEqual(Object.keys(value.devices[0]).sort(), ['id','last_seen_at','model','model_available','name','revoked_at','version']);
  const serialized = JSON.stringify(value);
  for (const forbidden of [PRIVATE_VALUE, 'claim_token', 'context_snapshot', 'secret_hash', 'Other owner', 'Owner B', A, B])
    assert.ok(!serialized.includes(forbidden), forbidden);
  await browser(B);
  const other = await chat();
  assert.equal(other.messages.length, 1);
  assert.equal(other.messages[0].content, 'Owner B 1');
  assert.equal(other.jobs.length, 1);
  assert.equal(other.devices.length, 1);
});

test('chat RPC requires a current approved browser grant on both public and private entrypoints', async () => {
  for (const owner of [NO_ACCESS, PENDING, REVOKED]) {
    await browser(owner);
    for (const schema of ['public', 'private']) await assert.rejects(() => chat(schema), /NOVA_ACCESS_REQUIRED/);
  }
  await browser();
  await db.query("select set_config('request.jwt.claim.client_id','oauth-client',false)");
  await assert.rejects(() => chat(), /NOVA_ACCESS_REQUIRED/);
  await browser();
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(() => chat(), /NOVA_ACCESS_REQUIRED/);
  for (const role of ['anon', 'service_role']) {
    await db.exec(`reset role; set role ${role}`);
    for (const schema of ['public', 'private']) await assert.rejects(() => chat(schema), /permission denied/);
  }
  await db.exec('reset role');
  const functions = await db.query<{ schema: string; prosecdef: boolean; proconfig: string[]; provolatile: string }>(
    `select n.nspname as schema,p.prosecdef,p.proconfig,p.provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where p.proname='nova_chat_state' order by n.nspname`);
  assert.deepEqual(functions.rows.map(f => [f.schema, f.prosecdef, f.provolatile]), [['private', true, 's'], ['public', false, 's']]);
  assert.ok(functions.rows.every(f => f.proconfig.includes('search_path=""')));
});

test('chat reads work inside a read-only transaction and do not initialize a profile or simulation', async () => {
  for (const owner of [A, EMPTY]) {
    await browser(owner);
    await db.exec('begin read only');
    try {
      const value = await chat();
      assert.deepEqual(Object.keys(value).sort(), ['devices', 'jobs', 'messages', 'server_now']);
      if (owner === EMPTY) assert.deepEqual([value.messages, value.jobs, value.devices], [[], [], []]);
    } finally { await db.exec('rollback'); }
  }
  await db.exec('reset role');
  const result = await db.query<{ profiles: number; days: number; events: number; races: number }>(`select
    (select count(*)::int from public.nova_profiles where owner_id=$1) profiles,
    (select count(*)::int from public.nova_daily_states) days,
    (select count(*)::int from public.nova_events) events,
    (select count(*)::int from public.nova_profiles where race_snapshot is not null) races`, [EMPTY]);
  assert.deepEqual(result.rows[0], { profiles: 0, days: 0, events: 0, races: 0 });
});
