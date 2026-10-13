import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NovaBridgeWorker, BridgeError, HttpBridgeApi, appOrigin, nextBridgePollMs, type BridgeApi } from '../scripts/nova-bridge/worker';
import { CredentialStore, windowsDpapi } from '../scripts/nova-bridge/credentials';
import { OllamaModelAdapter, FakeModelAdapter, localOllamaUrl, type ModelAdapter } from '../src/lib/nova/model';
import type { AgentContext } from '../src/lib/nova/agent';

const context: AgentContext = { schemaVersion: 1, trustedNow: '2026-10-13T12:00:00Z', generatedAt: '2026-10-13T12:00:00Z', message: { id: 'm', content: 'Merhaba', sentAt: '2026-10-13T11:00:00Z' }, facts: [], personality: {}, currentState: {}, currentEvent: null, score: null, history: [], memories: [], forgottenSourceIds: [] };
const deviceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const job = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', claim_token: 'claim', lease_expires_at: '2099-01-01T00:00:00Z' };
const credentials = { appUrl: 'https://example.test', deviceId, token: 'f'.repeat(64) };
function apiFixture(onCall?: (operation: string, payload: Record<string, unknown>) => unknown) {
  const calls: string[] = [];
  const api: BridgeApi = { async call(operation, payload = {}) { calls.push(operation); const custom = onCall?.(operation, payload); if (custom !== undefined) return custom; return operation === 'claim' ? { job } : operation === 'context' ? { context } : { ok: true }; } };
  return { api, calls };
}
test('missing local model does not claim jobs or consume attempts', async () => {
  const { api, calls } = apiFixture();
  assert.equal(await new NovaBridgeWorker(api, new FakeModelAdapter([], false)).runOne(), false);
  assert.deepEqual(calls, ['heartbeat']);
});
test('fake bridge completes validated reply with a fresh lease', async () => {
  const { api, calls } = apiFixture((operation, payload) => { if (operation === 'complete') assert.ok(payload.result); });
  assert.equal(await new NovaBridgeWorker(api, new FakeModelAdapter()).runOne(), true);
  assert.deepEqual(calls, ['heartbeat', 'claim', 'context', 'renew', 'renew', 'complete']);
});
test('lease loss aborts inference and never posts a stale result', async () => {
  let renewals=0;
  const { api, calls } = apiFixture(operation => { if (operation === 'renew' && ++renewals > 1) throw new BridgeError('LEASE_LOST', 409); });
  let aborted = false;
  const adapter: ModelAdapter = { async available() { return true; }, async generate(_request, signal) { await new Promise<void>((_, reject) => signal?.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true })); throw new Error('unreachable'); } };
  assert.equal(await new NovaBridgeWorker(api, adapter, { renewMs: 5 }).runOne(), false);
  assert.equal(aborted, true); assert.ok(!calls.includes('complete')); assert.ok(!calls.includes('fail'));
});
test('revoked device cannot claim a job', async () => {
  const { api, calls } = apiFixture(operation => { if (operation === 'heartbeat') throw new BridgeError('DEVICE_REVOKED', 403); });
  await assert.rejects(() => new NovaBridgeWorker(api, new FakeModelAdapter()).runOne());
  assert.deepEqual(calls, ['heartbeat']);
});

test('recent chat polling is bounded and readiness/heartbeat are not repeated for every queue read', async () => {
  assert.equal(nextBridgePollMs(70_000,0),10_000);
  assert.equal(nextBridgePollMs(59_999,0),2000);
  let time=0,availableCalls=0;
  const {api,calls}=apiFixture(operation=>operation==='claim'?{job:null}:undefined);
  const adapter:ModelAdapter={async available(){availableCalls++;return true;},async generate(){throw new Error('no queued work');}};
  const worker=new NovaBridgeWorker(api,adapter,{now:()=>time});
  await worker.runOne();time=2000;await worker.runOne();time=10_000;await worker.runOne();
  assert.equal(availableCalls,1);assert.equal(calls.filter(call=>call==='heartbeat').length,1);
  assert.equal(calls.filter(call=>call==='claim').length,3);
  time=60_000;await worker.runOne();
  assert.equal(availableCalls,2);assert.equal(calls.filter(call=>call==='heartbeat').length,2);
  worker.stop();
});

test('pipeline timings use server timestamps for queue residence and a broken diagnostic sink cannot undo delivery', async () => {
  let time=100, saved:Record<string,unknown>|undefined;
  const {api,calls}=apiFixture((operation,payload)=>{
    time+=10;
    if(operation==='claim')return {job:{...job,created_at:'2026-10-13T12:00:00Z',started_at:'2026-10-13T12:00:26Z'}};
    if(operation==='complete')saved=payload.metrics as Record<string,unknown>;
  });
  const worker=new NovaBridgeWorker(api,new FakeModelAdapter(),{now:()=>time,onMetrics(){throw new Error('diagnostic sink down');}});
  assert.equal(await worker.runOne(),true);
  assert.equal(saved?.queueWaitMs,26_000);assert.equal(saved?.claimMs,10);assert.equal(saved?.contextMs,10);
  assert.ok(!calls.includes('fail'));assert.ok(!JSON.stringify(saved).includes(context.message.content));
});
test('credential store never writes plaintext and fails closed without DPAPI', async () => {
  const path = await mkdtemp(join(tmpdir(), 'nova-credential-test-'));
  try {
    const location = join(path, 'device.dpapi');
    const encrypted = Buffer.from('protected-by-mock-dpapi');
    const store = new CredentialStore(location, { async protect() { return encrypted; }, async unprotect() { return Buffer.from(JSON.stringify(credentials)); } });
    await store.save(credentials);
    assert.equal((await readFile(location)).toString(), encrypted.toString());
    assert.deepEqual(await store.load(), credentials);
    await assert.rejects(() => new CredentialStore(join(path, 'unsupported'), windowsDpapi('linux')).save(credentials), /WINDOWS_DPAPI_REQUIRED/);
  } finally { await rm(path, { recursive: true, force: true }); }
});
test('Ollama host allowlist and application credential transport reject unsafe URLs', async () => {
  for (const url of ['https://ollama.com', 'http://192.168.1.1:11434', 'http://localhost:11434', 'http://127.0.0.1:11434@evil.test', 'http://127.0.0.1:11434/path', 'http://127.0.0.1:1234']) assert.throws(() => localOllamaUrl(url));
  assert.equal(localOllamaUrl().hostname, '127.0.0.1');
  assert.throws(() => appOrigin('http://example.com'));
  const client = new HttpBridgeApi(credentials, async (_url, init) => { assert.equal(init?.redirect, 'error'); assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${deviceId}.${credentials.token}`); return Response.json({ ok: true }); });
  await client.call('heartbeat');
});
test('Ollama streams locally with reasoning disabled and reports separate measured phases', async () => {
  let requestBody: Record<string, unknown> = {};
  const adapter = new OllamaModelAdapter({ fetch: async (_url, init) => { requestBody = JSON.parse(String(init?.body)); assert.equal(init?.redirect, 'error'); return Response.json({ done: true, done_reason: 'stop', message: { content: '{}' }, prompt_eval_count: 20, eval_count: 4, load_duration: 10_000_000, prompt_eval_duration: 20_000_000, eval_duration: 30_000_000, total_duration: 70_000_000 }); } });
  const result = await adapter.generate({ messages: [{ role: 'user', content: 'Merhaba' }], schema: { type: 'object' } });
  assert.equal(requestBody.stream, true); assert.equal(requestBody.think, false); assert.deepEqual(requestBody.format, { type: 'object' });
  assert.equal(requestBody.keep_alive, '15m');
  assert.equal(result.metrics.inputTokens, 20); assert.equal(result.metrics.outputTokens, 4);
  assert.equal(result.metrics.loadMs, 10); assert.equal(result.metrics.promptEvalMs, 20); assert.equal(result.metrics.decodeMs, 30);
  assert.equal(result.metrics.totalModelMs, 70); assert.ok(result.metrics.firstTokenMs! >= 0);
  assert.equal(result.metrics.provider, 'ollama');
});

test('bounded NDJSON handles split UTF-8 and never returns an incomplete response', async () => {
  const content = '{"reply":"İyiyim, bugün biraz yorgunum."}';
  const bytes = new TextEncoder().encode([
    JSON.stringify({ message: { content: content.slice(0, 12) }, done: false }),
    JSON.stringify({ message: { content: content.slice(12) }, done: false }),
    JSON.stringify({ message: { content: '' }, done: true, done_reason: 'stop' }),
  ].join('\n'));
  const fetcher = async () => new Response(new ReadableStream({ start(controller) {
    for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3));
    controller.close();
  } }));
  const response = await new OllamaModelAdapter({ fetch: fetcher }).generate({ messages: [], schema: {} });
  assert.equal(response.text, content);
  for (const body of [
    JSON.stringify({ message: { content }, done: false }),
    JSON.stringify({ message: { content }, done: true, done_reason: 'length' }),
  ]) await assert.rejects(() => new OllamaModelAdapter({ fetch: async () => new Response(body) }).generate({ messages: [], schema: {} }), /OLLAMA_INCOMPLETE/);
  await assert.rejects(() => new OllamaModelAdapter({ fetch: async () => Response.json({ message: { thinking: 'reasoning', content }, done: true }) }).generate({ messages: [], schema: {} }), /OLLAMA_REASONING_UNEXPECTED/);
});

test('diagnostics distinguish absent configured model from unreachable Ollama without selecting another model', async () => {
  const adapter = new OllamaModelAdapter({ model: 'qwen3:8b', fetch: async () => Response.json({ models: [{ name: 'qwen3.5:latest' }, { name: 'cloud', remote_host: 'example.test' }] }) });
  assert.deepEqual(await adapter.inspect(), { available: false, reason: 'model_missing', models: ['qwen3.5:latest'] });
  assert.equal(adapter.model, 'qwen3:8b');
  assert.equal((await new OllamaModelAdapter({ fetch: async () => { throw new Error('offline'); } }).inspect()).reason, 'unreachable');
});
test('Ollama timeout, missing model, invalid and oversized responses fail safely', async () => {
  const timeout = new OllamaModelAdapter({ timeoutMs: 100, fetch: async (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('secret body must not leak')), { once: true })) });
  // A live timer mirrors actual sockets; AbortSignal.timeout itself is unref'ed.
  const keepAlive = setTimeout(() => undefined, 500);
  try { await assert.rejects(() => timeout.generate({ messages: [], schema: {} }), /OLLAMA_TIMEOUT/); } finally { clearTimeout(keepAlive); }
  await assert.rejects(() => new OllamaModelAdapter({ fetch: async () => new Response('', { status: 404 }) }).generate({ messages: [], schema: {} }), /OLLAMA_MODEL_MISSING/);
  await assert.rejects(() => new OllamaModelAdapter({ fetch: async () => new Response('x'.repeat(65000)) }).generate({ messages: [], schema: {} }), /OLLAMA_RESPONSE_LIMIT/);
  assert.equal(await new OllamaModelAdapter({ fetch: async () => Response.json({ models: [] }) }).available(), false);
});
