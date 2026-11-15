import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
let db: PGlite;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;`);
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrations)).filter(n => n.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, migrations), 'utf8'));
  }
  await db.query('insert into auth.users values ($1),($2)', [owner, other]);
  await db.query('insert into public.owner_allowlist(user_id) values ($1)', [owner]);
  for (const id of [owner, other]) await db.query(`insert into public.classroom_accounts(id,name,email,role,status)
    values ($1,'Test',$2,'student','approved')`, [id, `${id}@example.test`]);
  await db.exec('set role service_role');
});
after(async () => { await db?.close(); });

type DbResult = { version: number; created: boolean; staged: boolean; published: boolean;
  memory: Record<string, unknown>; inbox: { id: string; parent_id: string | null }[] };
async function rpc<T = DbResult>(name: string, params: unknown[]) {
  const result = await db.query<{ value: T }>(`select public.${name}(${params.map((_, i) => `$${i + 1}`).join(',')}) as value`, params);
  return result.rows[0].value;
}
const read = (agent: string) => rpc('agent_team_read', [owner, agent]);
const commit = (agent: string, value: object) => rpc('agent_team_commit', [owner, agent, JSON.stringify(value)]);
const change = (version: number, extra: object = {}) => ({ version, run_id: randomUUID(), memory: {}, brief: '', result: null, messages: [], handled: [], ...extra });

test('private memories stay scoped; commits are versioned and idempotent', async () => {
  const update = change(0, { memory: { private_note: 'only awareness' }, brief: 'A small experiment may help.' });
  assert.deepEqual(await commit('awareness', update), { version: 1, created: true });
  assert.deepEqual(await commit('awareness', update), { version: 1, created: false });
  await assert.rejects(() => commit('awareness', { ...update, brief: 'changed' }), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(() => commit('awareness', change(0)), /VERSION_CONFLICT/);
  assert.deepEqual((await read('tracking')).memory, {});
  assert.equal((await read('awareness')).memory.private_note, 'only awareness');
  const briefs = await rpc('agent_team_briefs', [owner]);
  assert.equal(JSON.stringify(briefs).includes('private_note'), false);
  assert.equal(JSON.stringify(briefs).includes('small experiment'), true);
  await assert.rejects(() => rpc('agent_team_read', [other, 'awareness']), /OWNER_REQUIRED/);
});

test('a specialist can request another specialist and receive an addressed reply', async () => {
  const requestId = randomUUID(); const replyId = randomUUID();
  await commit('strategy', change(0, { messages: [{ id: requestId, recipient: 'tracking', kind: 'request', body: 'Which maths mistakes recur?' }] }));
  assert.equal((await read('tracking')).inbox[0].id, requestId);
  assert.equal((await read('daily')).inbox.length, 0);
  await assert.rejects(() => commit('daily', change(0, { handled: [requestId] })), /INVALID_ACK/);
  assert.equal((await read('daily')).version, 0);
  await assert.rejects(() => commit('daily', change(0, { messages: [{ id: replyId, recipient: 'strategy', kind: 'answer', body: 'Pretend', parent_id: requestId }] })), /INVALID_PARENT/);
  await commit('tracking', change(0, { brief: 'Time pressure needs verification.', messages: [{ id: replyId, recipient: 'strategy', kind: 'answer', body: 'Too few recorded causes to infer a pattern.', parent_id: requestId }] }));
  assert.equal((await read('tracking')).inbox.length, 0);
  assert.equal((await read('strategy')).inbox[0].parent_id, requestId);
  await commit('strategy', change(1, { handled: [replyId] }));
  assert.equal((await read('strategy')).inbox.length, 0);
});

test('leader chat is a real inbox, retries do not duplicate, and peers cannot answer the user', async () => {
  const id = randomUUID();
  assert.equal((await rpc('agent_team_chat_send', [owner, id, 'Nasıl çalışıyorsunuz?'])).created, true);
  assert.equal((await rpc('agent_team_chat_send', [owner, id, 'Nasıl çalışıyorsunuz?'])).created, false);
  await assert.rejects(() => rpc('agent_team_chat_send', [owner, id, 'Different']), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(() => commit('tracking', change(1, { messages: [{ id: randomUUID(), recipient: 'user', kind: 'answer', body: 'No', parent_id: id }] })), /INVALID_PARENT/);
  await commit('leader', change(0, { messages: [{ id: randomUUID(), recipient: 'user', kind: 'answer', body: 'İlgili uzmana sorup planı birleştiriyorum.', parent_id: id }] }));
  const chat = await rpc<{ author: string; status: string; reply_to: string }[]>('agent_team_chat_read', [owner]);
  assert.equal(chat.length, 2);
  assert.equal(chat[0].author, 'user'); assert.equal(chat[0].status, 'done');
  assert.equal(chat[1].reply_to, id); assert.equal(chat[1].author, 'leader');
  assert.equal((await read('leader')).inbox.length, 0);
});

test('background stages without publishing; startup promotes exactly the validated draft', async () => {
  const report = { schema_version: 1, run_id: 'cloud-prepared', mode: 'live', generated_at: '2026-01-01T10:00:00Z',
    week_start: '2025-12-29', title: 'Plan', agents: [{ id: 'leader', status: 'ready', summary: 'One step', recommendations: [], sources: [], tables: [], schedule: [] }] };
  const stage = (value: object) => rpc('agent_house_stage_for_owner', [owner, JSON.stringify(value)]);
  assert.equal((await stage(report)).staged, true);
  assert.equal((await stage(report)).staged, false);
  await db.exec('reset role');
  assert.equal((await db.query('select * from public.agent_house_reports')).rows.length, 0);
  await db.exec('set role service_role');
  assert.deepEqual(await rpc('agent_house_read_draft', [owner]), report);
  await assert.rejects(() => stage({ ...report, title: 'Changed' }), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(() => stage({ ...report, run_id: 'old', generated_at: '2025-01-01T10:00:00Z' }), /STALE_REPORT/);
  await assert.rejects(() => rpc('agent_house_publish_draft', [owner, 'wrong-id']), /DRAFT_CHANGED/);
  assert.equal((await rpc('agent_house_publish_draft', [owner, report.run_id])).published, true);
  assert.equal(await rpc('agent_house_read_draft', [owner]), null);
  assert.equal((await rpc('agent_house_publish_draft', [owner, report.run_id])).published, false);
  await assert.rejects(() => stage({ ...report, run_id: 'late-old' }), /STALE_REPORT/);
});

test('browser and OAuth callers cannot read memories or run privileged actions', async () => {
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`reset role; set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await assert.rejects(() => read('awareness'), /permission denied/);
    await assert.rejects(() => rpc('agent_team_chat_send', [owner, randomUUID(), 'No']), /permission denied/);
    await assert.rejects(() => rpc('agent_house_publish_draft', [owner, 'x']), /permission denied/);
    await assert.rejects(() => db.query('select * from private.agent_team_memory'), /permission denied/);
  }
});

test('note events are transactional, owner scoped, leased, and acknowledged once', async () => {
  await db.exec('reset role; set role service_role');
  const sub = 'sub_' + 'a'.repeat(64); const messageId = randomUUID();
  const secret = 'whsec_' + Buffer.alloc(32, 5).toString('base64');
  const expires = new Date(Date.now() + 3600000).toISOString();
  await rpc('mcp_agent_event_subscribe', [owner, sub, 'client', 'https://chatgpt.com/events/test', secret, expires]);
  await rpc('mcp_agent_event_subscribe', [owner, sub, 'client', 'https://chatgpt.com/events/test', secret, expires]);
  assert.equal(await rpc('mcp_agent_event_verified', [owner, sub, 'client', secret]), true);
  assert.equal(await rpc('mcp_agent_event_verified', [owner, sub, 'different-client', secret]), false);
  await assert.rejects(() => rpc('mcp_agent_event_claim', [other]), /OWNER_REQUIRED/);
  await rpc('agent_team_chat_send', [owner, messageId, 'Automatic reply test']);
  await rpc('agent_team_chat_send', [owner, messageId, 'Automatic reply test']);
  const first = await rpc<{ id: string; message_id: string; attempt: number }[]>('mcp_agent_event_claim', [owner]);
  assert.equal(first.length, 1); assert.equal(first[0].message_id, messageId); assert.equal(first[0].attempt, 1);
  assert.deepEqual(await rpc('mcp_agent_event_claim', [owner]), []);
  await rpc('mcp_agent_event_finish', [owner, sub, messageId, 1, 'retry', 503]);
  assert.deepEqual(await rpc('mcp_agent_event_claim', [owner]), []);
  await db.exec('reset role');
  await db.query('update private.agent_event_deliveries set next_attempt_at=now() where message_id=$1', [messageId]);
  await db.exec('set role service_role');
  const second = await rpc<{ attempt: number }[]>('mcp_agent_event_claim', [owner]);
  assert.equal(second[0].attempt, 2);
  // A stale worker cannot acknowledge a newer attempt.
  await rpc('mcp_agent_event_finish', [owner, sub, messageId, 1, 'delivered', 202]);
  await rpc('mcp_agent_event_finish', [owner, sub, messageId, 2, 'delivered', 202]);
  assert.deepEqual(await rpc('mcp_agent_event_claim', [owner]), []);
  await rpc('mcp_agent_event_unsubscribe', [owner, sub, 'different-client']);
  assert.equal(await rpc('mcp_agent_event_verified', [owner, sub, 'client', secret]), true);
  await rpc('mcp_agent_event_unsubscribe', [owner, sub, 'client']);
  assert.equal(await rpc('mcp_agent_event_verified', [owner, sub, 'client', secret]), false);
  for (const role of ['anon','authenticated']) {
    await db.exec(`reset role; set role ${role}`);
    await assert.rejects(() => rpc('mcp_agent_event_claim', [owner]), /permission denied/);
    await assert.rejects(() => db.query('select secret from private.agent_event_subscriptions'), /permission denied/);
  }
});
