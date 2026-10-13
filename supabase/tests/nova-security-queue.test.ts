import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const A = randomUUID(), B = randomUUID(), NO_ACCESS = randomUUID(), PENDING = randomUUID();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
let db: PGlite;
let device: { device_id: string; owner_id: string };
const secret = hash('test-only-device-secret');

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
  for (const id of [A, B, NO_ACCESS, PENDING]) {
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id, `${id}@example.test`]);
    await db.query('insert into public.classroom_accounts(id,name,email,role,status) values($1,$2,$3,\'student\',$4)',
      [id, id, `${id}@example.test`, id === PENDING ? 'pending' : 'approved']);
  }
  await db.query('insert into public.nova_access_grants(owner_id) values($1),($2),($3)', [A, B, PENDING]);
});
after(async () => { await db?.close(); });

async function browser(id = A) {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role: 'authenticated' })]);
  await db.query("select set_config('request.jwt.claim.client_id','',false)");
}
async function service() { await db.exec("reset role; set role service_role; reset request.jwt.claim.sub; reset request.jwt.claims"); }
async function admin() { await db.exec('reset role'); }
async function rpc<T = Record<string, unknown>>(name: string, values: unknown[] = []): Promise<T> {
  return (await db.query<{ value: T }>(`select public.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) as value`,
    values.map(v => typeof v === 'object' && v !== null ? JSON.stringify(v) : v))).rows[0].value;
}
async function deviceCall<T = Record<string, unknown>>(operation: string, payload: object = {}, id = device.device_id, token = secret) {
  await service(); return rpc<T>('nova_device_call', [id, token, operation, payload]);
}
async function initialize(owner = A) {
  await service();
  return rpc<{ id: string }>('nova_engine_initialize', [owner, { baseline: { meanMinutes: 30 }, personality: { discipline: 60 }, engine_version: 'test-v1', timezone: owner === B ? 'America/New_York' : 'Europe/Istanbul' }]);
}
async function enqueue(content: string, request = randomUUID()) {
  await browser(); return rpc<{ message_id: string; job_id: string; replayed: boolean }>('nova_enqueue', [request, content]);
}
type Job = { id: string; source_message_id: string; claim_token: string; lease_expires_at: string };
async function claim() { return (await deviceCall<{ job: Job | null }>('claim')).job; }
async function complete(job: Job, reply = 'Birlikte adım adım ilerleyebiliriz.', extras: object = {}) {
  // Replays do not rebind a completed job; every initial result uses a bound context.
  try { await deviceCall('bind_context', { job_id: job.id, claim_token: job.claim_token, context: { facts: [] }, context_version: 'test-context' }); }
  catch (error) { if (!(error instanceof Error && error.message.includes('NOVA_LEASE_INVALID'))) throw error; }
  return deviceCall('complete', { job_id: job.id, claim_token: job.claim_token, context_version: 'test-context', result: {
    reply, intent: 'NONE', expressedEmotion: 'CALM', referencedFactIds: [], memoryCandidates: [], proposedAction: null, ...extras,
  } });
}

test('Nova grants are explicit, approved browser owner only; RLS on every table', async () => {
  await initialize(); await initialize(B);
  await browser(B);
  assert.equal((await rpc<{ settings: { timezone: string } }>('nova_state')).settings.timezone, 'America/New_York');
  for (const id of [NO_ACCESS, PENDING]) {
    await browser(id);
    assert.equal(await rpc('nova_access'), false);
    await assert.rejects(() => rpc('nova_state'), /NOVA_ACCESS_REQUIRED/);
    await assert.rejects(() => rpc('nova_enqueue', [randomUUID(), 'Merhaba']), /NOVA_ACCESS_REQUIRED/);
  }
  await browser();
  assert.equal(await rpc('nova_access'), true);
  const rows = await db.query<{ owner_id: string }>('select owner_id from public.nova_profiles');
  assert.deepEqual(rows.rows.map(row => row.owner_id), [A]);
  await db.query("select set_config('request.jwt.claim.client_id','oauth-client',false)");
  assert.equal(await rpc('nova_access'), false);
  await assert.rejects(() => rpc('nova_state'), /NOVA_ACCESS_REQUIRED/);
  await db.exec('reset role; set role anon');
  await assert.rejects(() => rpc('nova_state'), /permission denied/);
  await admin();
  const tables = await db.query<{ relname: string; relrowsecurity: boolean }>(`select relname,relrowsecurity from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'nova_%'`);
  assert.ok(tables.rows.length >= 11);
  assert.ok(tables.rows.every(row => row.relrowsecurity));
});

test('engine writes are service only, ownership immutable and composite FKs reject cross owner', async () => {
  await browser();
  await assert.rejects(() => rpc('nova_engine_initialize', [A, {}]), /permission denied/);
  for (const table of ['nova_daily_states', 'nova_events', 'nova_ai_jobs', 'nova_messages', 'nova_access_grants'])
    await assert.rejects(() => db.query(`delete from public.${table}`), /permission denied/);
  await assert.rejects(() => db.query('update public.nova_profiles set owner_id=$1', [B]), /permission denied/);
  await admin();
  await assert.rejects(() => db.query('update public.nova_profiles set owner_id=$1 where owner_id=$2', [NO_ACCESS, A]), /NOVA_OWNER_IMMUTABLE/);
  const nova = (await db.query<{ id: string }>('select id from public.nova_profiles where owner_id=$1', [A])).rows[0].id;
  await assert.rejects(() => db.query(`insert into public.nova_messages(owner_id,nova_id,sender,content,sequence)
    values($1,$2,'USER','bad owner',1)`, [B, nova]), /foreign key constraint/);
});

test('pairing requires approval, challenge and single exchange; credentials hidden', async () => {
  await service();
  const pairing = await rpc<{ pairing_id: string; code: string }>('nova_pair_begin', [hash('challenge'), 'Test bilgisayarı']);
  await assert.rejects(() => rpc('nova_pair_exchange', [pairing.pairing_id, hash('challenge'), secret]), /NOVA_PAIR_PENDING/);
  await browser(NO_ACCESS);
  await assert.rejects(() => rpc('nova_pair_approve', [pairing.code]), /NOVA_ACCESS_REQUIRED/);
  await browser(); await rpc('nova_pair_approve', [pairing.code]);
  await service();
  await assert.rejects(() => rpc('nova_pair_exchange', [pairing.pairing_id, hash('wrong'), secret]), /NOVA_PAIRING_INVALID/);
  device = await rpc('nova_pair_exchange', [pairing.pairing_id, hash('challenge'), secret]);
  assert.equal(device.owner_id, A);
  await assert.rejects(() => rpc('nova_pair_exchange', [pairing.pairing_id, hash('challenge'), secret]), /NOVA_PAIRING_INVALID/);
  await browser();
  await assert.rejects(() => db.query('select * from private.nova_device_credentials'), /permission denied/);
  await assert.rejects(() => rpc('nova_device_call', [device.device_id, secret, 'heartbeat', {}]), /permission denied/);
  const state = await rpc('nova_state');
  assert.ok(!JSON.stringify(state).includes(secret));
});

test('enqueue atomic idempotency, offline durability, serial claims and renewable lease', async () => {
  const request = randomUUID();
  const first = await enqueue('İlk mesaj', request);
  const replay = await enqueue('İlk mesaj', request);
  assert.equal(replay.message_id, first.message_id);
  assert.equal(replay.replayed, true);
  await assert.rejects(() => rpc('nova_enqueue', [request, 'Değişmiş mesaj']), /NOVA_IDEMPOTENCY_CONFLICT/);
  const second = await enqueue('İkinci mesaj');
  const job = await claim(); assert.ok(job); assert.equal(job.id, first.job_id);
  assert.equal(await claim(), null);
  const renewed = await deviceCall<{ lease_expires_at: string }>('renew', { job_id: job.id, claim_token: job.claim_token });
  assert.ok(Date.parse(renewed.lease_expires_at) >= Date.parse(job.lease_expires_at));
  await complete(job);
  const next = await claim(); assert.ok(next); assert.equal(next.id, second.job_id);
  const context = await deviceCall<{ messages: { content: string }[] }>('context', { job_id: next.id, claim_token: next.claim_token });
  assert.ok(context.messages.some(message => message.content.includes('adım adım')));
  await complete(next);
});

test('expired old claim cannot overwrite reclaimed job; only one durable reply', async () => {
  const queued = await enqueue('Uzun üretim');
  const old = await claim(); assert.ok(old);
  await admin();
  await db.query("update public.nova_ai_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [queued.job_id]);
  await assert.rejects(() => complete(old), /NOVA_LEASE_INVALID/);
  const current = await claim(); assert.ok(current); assert.notEqual(current.claim_token, old.claim_token);
  await assert.rejects(() => complete(old), /NOVA_LEASE_INVALID/);
  await complete(current);
  const afterComplete = await deviceCall<{ bound_context: object }>('context', { job_id: current.id, claim_token: current.claim_token });
  assert.deepEqual(afterComplete.bound_context, { facts: [] });
  await browser(); const relationshipBefore = (await db.query('select familiarity,warmth from public.nova_relationships')).rows[0];
  const duplicate = await complete(current);
  assert.equal(duplicate.replayed, true);
  await browser(); assert.deepEqual((await db.query('select familiarity,warmth from public.nova_relationships')).rows[0], relationshipBefore);
  await admin();
  assert.equal((await db.query('select id from public.nova_messages where source_message_id=$1', [queued.message_id])).rows.length, 1);
});

test('failed head blocks later work until explicit retry, message retained', async () => {
  const first = await enqueue('Retry ilk'); const second = await enqueue('Retry ikinci');
  const job = await claim(); assert.ok(job);
  await deviceCall('fail', { job_id: job.id, claim_token: job.claim_token, error: 'MODEL_TIMEOUT', retryable: false });
  assert.equal(await claim(), null);
  await browser(); await rpc('nova_job_retry', [first.job_id]);
  const retried = await claim(); assert.ok(retried); await complete(retried);
  const next = await claim(); assert.ok(next); assert.equal(next.id, second.job_id); await complete(next);
  await browser();
  assert.equal((await db.query('select id from public.nova_messages where id=$1', [first.message_id])).rows.length, 1);
});

test('memory needs user acceptance; forgotten source blocks re-extraction and clears candidates', async () => {
  await enqueue('Geometri çalışmayı seviyorum. Bunu hatırla.');
  const job = await claim(); assert.ok(job);
  await complete(job, 'Bunu not almamı istersen hafıza ekranından onaylayabilirsin.', {
    memoryCandidates: [{ content: 'Geometri çalışmayı seviyorum.', sourceMessageId: job.source_message_id, sourceQuote: 'Geometri çalışmayı seviyorum.', type: 'preference', sensitivity: 'ordinary' }],
  });
  await browser();
  const memory = (await db.query<{ id: string; status: string }>('select id,status from public.nova_memories where source_message_id=$1', [job.source_message_id])).rows[0];
  assert.equal(memory.status, 'candidate');
  await rpc('nova_memory_update', [memory.id, 'approve', null]);
  await rpc('nova_memory_update', [memory.id, 'pin', null]);
  await enqueue('Bana daha önce söylediklerimden bir konu öner.'); const derived = await claim(); assert.ok(derived);
  await complete(derived, 'Geometri üzerine konuşabiliriz.');
  await browser();
  await rpc('nova_memory_update', [memory.id, 'forget', null]);
  const forgotten = (await db.query<{ content: string; status: string }>('select content,status from public.nova_memories where id=$1', [memory.id])).rows[0];
  assert.equal(forgotten.status, 'forgotten'); assert.equal(forgotten.content, '');
  await assert.rejects(() => rpc('nova_memory_update', [memory.id, 'approve', null]), /NOVA_MEMORY_FORGOTTEN/);
  await enqueue('Yeni mesaj'); const next = await claim(); assert.ok(next);
  const context = await deviceCall<{ memories: unknown[]; messages: { id: string; source_message_id: string | null }[] }>('context', { job_id: next.id, claim_token: next.claim_token });
  assert.equal(context.memories.length, 0);
  assert.ok(!context.messages.some(message => message.id === job.source_message_id));
  assert.ok(!context.messages.some(message => message.source_message_id === derived.source_message_id));
  await complete(next);
});

test('transient failure backs off durably, stops after three attempts and keeps total count on manual retry', async () => {
  const queued = await enqueue('Geçici model hatası');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const job = await claim(); assert.ok(job); assert.equal(job.id, queued.job_id);
    const failed = await deviceCall<{ status: string; next_attempt_at: string | null }>('fail', {
      job_id: job.id, claim_token: job.claim_token, error: 'MODEL_TIMEOUT', retryable: true,
    });
    assert.equal(failed.status, attempt < 3 ? 'QUEUED' : 'FAILED');
    assert.equal(await claim(), null);
    if (attempt < 3) {
      assert.ok(failed.next_attempt_at);
      await admin(); await db.query("update public.nova_ai_jobs set next_attempt_at=now()-interval '1 second' where id=$1", [job.id]);
    }
  }
  await browser(); await rpc('nova_job_retry', [queued.job_id]);
  const retried = await claim(); assert.ok(retried); await complete(retried);
  await browser();
  assert.equal((await db.query<{ attempt_count: number }>('select attempt_count from public.nova_ai_jobs where id=$1', [queued.job_id])).rows[0].attempt_count, 4);
});

test('one official day survives new engine versions; finalized results immutable; future results hidden', async () => {
  const makeDay = (localDate: string) => ({ localDate, timezone: 'Europe/Istanbul', seed: 'stable-seed', engineVersion: 'v1',
    startsAt: `${localDate}T00:00:00+03:00`, endsAt: `${localDate}T23:59:59+03:00`,
    inputSnapshot: { user: 'snapshot never exposed through browser RPC' }, startState: { energy: 50 },
    events: [{ id: `${localDate}:0`, kind: 'distraction', label: 'Dikkat dağıldı; toparlanma arası', startsAt: `${localDate}T12:00:00+03:00`,
      endsAt: `${localDate}T13:00:00+03:00`, result: { questions: 123 }, stateDelta: { energy: -3 }, reasonCodes: ['TASK_COMPLETED'] }],
  });
  await service();
  const past = makeDay('2020-01-01');
  const created = await rpc<{ id: string; day_snapshot: object }>('nova_engine_day', [A, past]);
  const changed = await rpc<{ id: string; day_snapshot: object }>('nova_engine_day', [A, { ...past, engineVersion: 'v2', seed: 'changed' }]);
  assert.equal(created.id, changed.id); assert.deepEqual(changed.day_snapshot, past);
  const finalized = await rpc<{ finalized: boolean; nova_score: number }>('nova_engine_day', [A, { ...past, finalized: true, userScore: 70, novaScore: 65 }]);
  assert.equal(finalized.finalized, true); assert.equal(finalized.nova_score, 65);
  const unchanged = await rpc<{ nova_score: number }>('nova_engine_day', [A, { ...past, finalized: true, userScore: 90, novaScore: 95 }]);
  assert.equal(unchanged.nova_score, 65);
  const future = makeDay('2099-01-01');
  const notFinal = await rpc<{ finalized: boolean }>('nova_engine_day', [A, { ...future, finalized: true, novaScore: 100 }]);
  assert.equal(notFinal.finalized, false);
  await browser();
  await assert.rejects(() => rpc('nova_settings_update', [{ timezone: 'UTC' }]), /NOVA_TIMEZONE_LOCKED/);
  await rpc('nova_settings_update', [{ timezone: 'Europe/Istanbul' }]);
  type VisibleEvent = { id: string; kind: string; label: string; result?: unknown; stateDelta?: unknown; reasonCodes?: unknown };
  const state = await rpc<{ days: { local_date: string; day_snapshot: { inputSnapshot?: unknown; events: VisibleEvent[] } }[];
    events: { event_key: string; kind: string; event_snapshot: VisibleEvent }[] }>('nova_state');
  const safe = state.days.find(day => day.local_date === '2099-01-01')!;
  assert.equal(safe.day_snapshot.inputSnapshot, undefined);
  assert.equal(safe.day_snapshot.events[0].result, undefined);
  assert.equal(safe.day_snapshot.events[0].stateDelta, undefined);
  assert.equal(safe.day_snapshot.events[0].reasonCodes, undefined);
  assert.equal(safe.day_snapshot.events[0].kind, 'study');
  assert.equal(safe.day_snapshot.events[0].label, 'Çalışma bloğu');
  const futureEvent = state.events.find(event => event.event_key === '2099-01-01:0')!;
  assert.equal(futureEvent.kind, 'study');
  assert.equal(futureEvent.event_snapshot.kind, 'study');
  assert.equal(futureEvent.event_snapshot.label, 'Çalışma bloğu');
  const completedEvent = state.events.find(event => event.event_key === '2020-01-01:0')!;
  assert.equal(completedEvent.kind, 'distraction');
  assert.deepEqual(completedEvent.event_snapshot, past.events[0]);
  await assert.rejects(() => db.query('select day_snapshot from public.nova_daily_states'), /permission denied/);
  await assert.rejects(() => db.query('select event_snapshot from public.nova_events'), /permission denied/);
  await assert.rejects(() => db.query('select kind from public.nova_events'), /permission denied/);
  await service();
  const trusted = await rpc<typeof state>('nova_engine_state', [A]);
  assert.equal(trusted.days.find(day => day.local_date === '2099-01-01')!.day_snapshot.events[0].kind, 'distraction');
  assert.equal(trusted.events.find(event => event.event_key === '2099-01-01:0')!.kind, 'distraction');
  await admin();
  await assert.rejects(() => db.query("update public.nova_daily_states set seed='new' where id=$1", [created.id]), /NOVA_DAY_IMMUTABLE/);
  const projectEvent = async (now: string) => (await db.query<{ value: VisibleEvent }>(
    'select private.nova_safe_event($1::jsonb,$2::timestamptz) as value', [JSON.stringify(future.events[0]), now])).rows[0].value;
  assert.equal((await projectEvent('2099-01-01T08:59:59.999Z')).kind, 'study');
  const active = await projectEvent(future.events[0].startsAt);
  assert.equal(active.kind, 'distraction');
  assert.equal(active.label, future.events[0].label);
  assert.equal(active.result, undefined);
  assert.equal(active.reasonCodes, undefined);
  assert.deepEqual(await projectEvent(future.events[0].endsAt), future.events[0]);
});

test('context binding is immutable per claim, checks fact IDs and completion context version', async () => {
  await enqueue('Bağlam testi'); const job = await claim(); assert.ok(job);
  const result = { reply: 'Hazırım.', intent: 'NONE', expressedEmotion: 'CALM', referencedFactIds: [], memoryCandidates: [], proposedAction: null };
  await assert.rejects(() => deviceCall('complete', { job_id: job.id, claim_token: job.claim_token, result }), /NOVA_CONTEXT_REQUIRED/);
  const payload = { job_id: job.id, claim_token: job.claim_token, context: { facts: [{ id: 'safe-fact' }] }, context_version: 'frozen-v1' };
  await deviceCall('bind_context', payload);
  await assert.rejects(() => deviceCall('bind_context', { ...payload, context: { facts: [{ id: 'changed' }] } }), /NOVA_CONTEXT_CONFLICT/);
  await assert.rejects(() => deviceCall('complete', { job_id: job.id, claim_token: job.claim_token, context_version: 'wrong', result }), /NOVA_CONTEXT_CONFLICT/);
  await assert.rejects(() => deviceCall('complete', { job_id: job.id, claim_token: job.claim_token, context_version: 'frozen-v1', result: { ...result, referencedFactIds: ['unknown'] } }), /NOVA_INVALID_FACT/);
  await deviceCall('complete', { job_id: job.id, claim_token: job.claim_token, context_version: 'frozen-v1', result: { ...result, referencedFactIds: ['safe-fact'] } });
});

test('trusted race observation tracks leader without rewriting official day and rejects browser writes', async () => {
  await service();
  const first = await rpc<{ previousLeader: null; race: { leader: string } }>('nova_engine_race', [A, '2020-01-01', 70, 65]);
  assert.equal(first.previousLeader, null); assert.equal(first.race.leader, 'user');
  const next = await rpc<{ previousLeader: string; race: { leader: string } }>('nova_engine_race', [A, '2020-01-01', 60, 65]);
  assert.equal(next.previousLeader, 'user'); assert.equal(next.race.leader, 'nova');
  await assert.rejects(() => rpc('nova_engine_race', [A, '2020-01-01', 101, 65]), /NOVA_INVALID_SCORE/);
  await assert.rejects(() => rpc('nova_engine_race', [A, '2020-01-02', 65, 65]), /NOVA_DAY_REQUIRED/);
  await browser(); await assert.rejects(() => rpc('nova_engine_race', [A, '2020-01-01', 100, 0]), /permission denied/);
  await service();
  const state = await rpc<{ days: { local_date: string; nova_score: number }[] }>('nova_engine_state', [A]);
  assert.equal(state.days.find(day => day.local_date === '2020-01-01')!.nova_score, 65);
});

test('two devices compete for one head and cannot submit each other claims', async () => {
  await service();
  const pairing = await rpc<{ pairing_id: string; code: string }>('nova_pair_begin', [hash('second-device-challenge'), 'İkinci cihaz']);
  await browser(); await rpc('nova_pair_approve', [pairing.code]);
  await service();
  const secondSecret = hash('second-test-secret');
  const second = await rpc<{ device_id: string }>('nova_pair_exchange', [pairing.pairing_id, hash('second-device-challenge'), secondSecret]);
  await enqueue('İki cihaz aynı iş');
  await service();
  const claims = await Promise.all([
    rpc<{ job: Job | null }>('nova_device_call', [device.device_id, secret, 'claim', {}]),
    rpc<{ job: Job | null }>('nova_device_call', [second.device_id, secondSecret, 'claim', {}]),
  ]);
  assert.equal(claims.filter(value => value.job).length, 1);
  const winner = claims.find(value => value.job)!.job!;
  // PGlite has one embedded connection: this verifies competing transactions;
  // true multi-connection lock interleavings remain a local Supabase smoke test.
  assert.ok(claims[0].job);
  await assert.rejects(() => deviceCall('renew', { job_id: winner.id, claim_token: winner.claim_token }, second.device_id, secondSecret), /NOVA_LEASE_INVALID/);
  await complete(winner);
  await browser(); await rpc('nova_device_revoke', [second.device_id]);
});

test('expired pairing cannot approve or exchange; all Nova RPC grants are explicit', async () => {
  await service(); const pairing = await rpc<{ pairing_id: string; code: string }>('nova_pair_begin', [hash('expired-challenge'), 'Süreli cihaz']);
  await admin(); await db.query("update public.nova_pairings set expires_at=now()-interval '1 second' where id=$1", [pairing.pairing_id]);
  await browser(); await assert.rejects(() => rpc('nova_pair_approve', [pairing.code]), /NOVA_PAIRING_INVALID/);
  await service(); await assert.rejects(() => rpc('nova_pair_exchange', [pairing.pairing_id, hash('expired-challenge'), secret]), /NOVA_PAIRING_INVALID/);
  await admin();
  const privileges = await db.query<{ name: string; anon_execute: boolean }>(`select p.proname as name,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'nova_%'`);
  assert.ok(privileges.rows.length > 20); assert.ok(privileges.rows.every(row => !row.anon_execute));
});

test('proactive work observes opt-in, quiet hours, duplicate trigger, unanswered cap and expiry', async () => {
  const expires = new Date(Date.now() + 60_000).toISOString();
  await service();
  assert.equal((await rpc('nova_proactive_enqueue', [A, 'morning-one', 'morning_checkin', expires, {}])).skipped, 'DISABLED');
  await browser();
  const currentHour = (await db.query<{ hour: number }>("select extract(hour from now() at time zone 'Europe/Istanbul')::int as hour")).rows[0].hour;
  await rpc('nova_settings_update', [{ proactive_enabled: true, quiet_start: currentHour, quiet_end: (currentHour + 1) % 24 }]);
  await service();
  assert.equal((await rpc('nova_proactive_enqueue', [A, 'morning-one', 'morning_checkin', expires, {}])).skipped, 'QUIET_HOURS');
  await browser(); await rpc('nova_settings_update', [{ quiet_start: 0, quiet_end: 0 }]);
  await service();
  const first = await rpc<{ job_id: string }>('nova_proactive_enqueue', [A, 'morning-one', 'morning_checkin', expires, {}]);
  const duplicate = await rpc<{ job_id: string; replayed: boolean }>('nova_proactive_enqueue', [A, 'morning-one', 'morning_checkin', expires, {}]);
  assert.equal(first.job_id, duplicate.job_id); assert.equal(duplicate.replayed, true);
  assert.equal((await rpc('nova_proactive_enqueue', [A, 'morning-two', 'morning_checkin', expires, {}])).skipped, 'AWAITING_REPLY');
  await admin(); await db.query("update public.nova_ai_jobs set expires_at=now()-interval '1 second' where id=$1", [first.job_id]);
  assert.equal(await claim(), null);
  await browser();
  const expired = (await db.query<{ status: string }>('select status from public.nova_ai_jobs where id=$1', [first.job_id])).rows[0];
  assert.equal(expired.status, 'CANCELLED');
  await service(); await rpc('nova_proactive_enqueue', [A, 'cross-quiet-window', 'morning_checkin', expires, {}]);
  const quietJob = await claim(); assert.ok(quietJob);
  await deviceCall('bind_context', { job_id: quietJob.id, claim_token: quietJob.claim_token, context: { facts: [] }, context_version: 'test-context' });
  await browser(); await rpc('nova_settings_update', [{ quiet_start: currentHour, quiet_end: (currentHour + 1) % 24 }]);
  await assert.rejects(() => complete(quietJob), /NOVA_LEASE_INVALID/);
  assert.equal(await claim(), null);
  await browser();
  await rpc('nova_settings_update', [{ proactive_enabled: false, quiet_start: 23, quiet_end: 8 }]);
});

test('forget invalidates in-flight context; duel acceptance is explicit and idempotent', async () => {
  await enqueue('Cebir çalışmayı seviyorum. Bunu hatırla.'); const sourceJob = await claim(); assert.ok(sourceJob);
  await complete(sourceJob, 'Kısa bir odak düellosu teklif ediyorum.', {
    intent: 'OFFER_FOCUS_DUEL', proposedAction: { type: 'OFFER_FOCUS_DUEL', durationMinutes: 25 },
    memoryCandidates: [{ content: 'Cebir çalışmayı seviyorum.', sourceQuote: 'Cebir çalışmayı seviyorum.', sourceMessageId: sourceJob.source_message_id, sensitivity: 'ordinary', type: 'preference' }],
  });
  await browser();
  const reply = (await db.query<{ id: string }>('select id from public.nova_messages where source_message_id=$1', [sourceJob.source_message_id])).rows[0];
  assert.equal((await db.query<{ accepted_duels: number }>('select accepted_duels from public.nova_relationships')).rows[0].accepted_duels, 0);
  await rpc('nova_duel_decide', [reply.id, true]); await rpc('nova_duel_decide', [reply.id, true]);
  assert.equal((await db.query<{ accepted_duels: number }>('select accepted_duels from public.nova_relationships')).rows[0].accepted_duels, 1);
  assert.equal((await db.query<{ rivalry: number }>('select rivalry from public.nova_relationships')).rows[0].rivalry, 51);
  const memory = (await db.query<{ id: string }>('select id from public.nova_memories where source_message_id=$1', [sourceJob.source_message_id])).rows[0];
  await rpc('nova_memory_update', [memory.id, 'approve', null]);
  await enqueue('Sonraki mesaj'); const pending = await claim(); assert.ok(pending);
  await deviceCall('bind_context', { job_id: pending.id, claim_token: pending.claim_token, context: { facts: [], memories: ['forget me'] }, context_version: 'forget-test' });
  await browser(); await rpc('nova_memory_update', [memory.id, 'forget', null]);
  await assert.rejects(() => deviceCall('context', { job_id: pending.id, claim_token: pending.claim_token }), /NOVA_LEASE_INVALID/);
  const reclaimed = await claim(); assert.ok(reclaimed); assert.notEqual(reclaimed.claim_token, pending.claim_token);
  const context = await deviceCall<{ bound_context: null; memories: unknown[] }>('context', { job_id: reclaimed.id, claim_token: reclaimed.claim_token });
  assert.equal(context.bound_context, null); assert.equal(context.memories.length, 0); await complete(reclaimed);
});

test('revoking feature grant rejects live device operations and hides owned rows', async () => {
  await admin(); await db.query('update public.nova_access_grants set revoked_at=now() where owner_id=$1', [A]);
  await browser(); assert.equal(await rpc('nova_access'), false);
  assert.equal((await db.query('select * from public.nova_profiles')).rows.length, 0);
  await assert.rejects(() => deviceCall('heartbeat'), /NOVA_DEVICE_UNAUTHORIZED/);
  await admin(); await db.query('update public.nova_access_grants set revoked_at=null where owner_id=$1', [A]);
});

test('RLS cannot expose another owner through Nova tables and a different device cannot read owner context', async () => {
  await browser(B);
  for (const table of ['nova_profiles', 'nova_access_grants', 'nova_daily_states', 'nova_events', 'nova_messages', 'nova_ai_jobs', 'nova_memories', 'nova_devices', 'nova_settings', 'nova_relationships']) {
    const rows = await db.query<{ owner_id: string }>(`select owner_id from public.${table}`);
    assert.ok(rows.rows.every(row => row.owner_id === B), table);
  }
  assert.equal((await rpc<{ messages: unknown[]; memories: unknown[] }>('nova_state')).messages.length, 0);
  await service();
  const pairing = await rpc<{ pairing_id: string; code: string }>('nova_pair_begin', [hash('owner-b-challenge'), 'Diğer kullanıcı']);
  await browser(B); await rpc('nova_pair_approve', [pairing.code]);
  await service();
  const other = await rpc<{ device_id: string }>('nova_pair_exchange', [pairing.pairing_id, hash('owner-b-challenge'), hash('owner-b-secret')]);
  await enqueue('Sahiplik son test'); const job = await claim(); assert.ok(job);
  await assert.rejects(() => deviceCall('context', { job_id: job.id, claim_token: job.claim_token }, other.device_id, hash('owner-b-secret')), /NOVA_LEASE_INVALID/);
  await complete(job);
});

test('revoked device rejects heartbeat, claim, renew, context and result despite correct secret', async () => {
  await enqueue('İptal testi'); const job = await claim(); assert.ok(job);
  await browser(); await rpc('nova_device_revoke', [device.device_id]);
  for (const operation of ['heartbeat', 'claim', 'renew', 'context', 'complete', 'fail'])
    await assert.rejects(() => deviceCall(operation, { job_id: job.id, claim_token: job.claim_token }), /NOVA_DEVICE_UNAUTHORIZED/);
  await assert.rejects(() => deviceCall('heartbeat', {}, device.device_id, hash('wrong')), /NOVA_DEVICE_UNAUTHORIZED/);
});
