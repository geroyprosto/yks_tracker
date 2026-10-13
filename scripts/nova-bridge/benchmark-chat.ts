/** Real Ollama + actual HTTP queue, restricted to the isolated local demo. No saved device identity. */
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { DEMO_STUDENT_IDS } from '../../src/lib/classroom/demo-seed';
import { OllamaModelAdapter, type ModelAdapter } from '../../src/lib/nova/model';
import { validateAgentOutput, type AgentContext, AgentValidationError } from '../../src/lib/nova/agent';
import type { NovaChatState, NovaWebState } from '../../src/lib/nova/web-types';
import { HttpBridgeApi, NovaBridgeWorker, type BridgeApi } from './worker';

async function main() {
  const origin = process.argv[2] ?? 'http://127.0.0.1:3410';
  const model = process.argv[3];
  const output = process.argv[4];
  if (!/^http:\/\/127\.0\.0\.1:34\d{2}$/u.test(origin) || !model || !output) throw new Error('Use local preview origin, explicit installed model and output path.');
  const login = await fetch(`${origin}/api/demo`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: DEMO_STUDENT_IDS[0] }) });
  if (!login.ok) throw new Error('DEMO_LOGIN_FAILED');
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  async function browser<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${origin}${path}`, { method: body ? 'POST' : 'GET', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`LOCAL_HTTP_${response.status}`);
    return response.json() as Promise<T>;
  }
  const initial = await browser<NovaWebState>('/api/nova');
  if (!initial.demo) throw new Error('DEMO_REQUIRED');
  if (initial.jobs.length) throw new Error('FRESH_DEMO_REQUIRED');
  const challenge = randomBytes(32).toString('hex');
  const pairing = await browser<{ code: string; pairing_id: string }>('/api/nova/bridge', { operation: 'pair.begin', challenge, name: 'Yerel ölçüm cihazı' });
  await browser('/api/nova', { operation: 'pair.approve', code: pairing.code });
  const identity = await browser<{ device_id: string; token: string }>('/api/nova/bridge', { operation: 'pair.exchange', pairing_id: pairing.pairing_id, challenge });
  const client = new HttpBridgeApi({ appUrl: origin, deviceId: identity.device_id, token: identity.token });
  const metrics: Array<Record<string, unknown>> = [];
  const sources: string[] = [];
  const prompts = ['Nasılsın?', 'Bugün neler yaptın?'];
  async function send(index: number) {
    const value = await browser<{ message_id: string }>('/api/nova', { operation: 'message', requestId: randomUUID(), content: prompts[index] });
    sources.push(value.message_id);
  }
  let sent = false, completeCount = 0;
  let currentContext: AgentContext | undefined;
  const generations: Array<Record<string, unknown>> = [];
  const controller = new AbortController();
  const api: BridgeApi = {
    async call(operation, payload, signal) {
      const result = await client.call(operation, payload, signal);
      if (operation === 'context') currentContext = (result as { context: AgentContext }).context;
      // Queue immediately after an empty poll: a measured worst-phase idle wait.
      if (operation === 'claim' && !sent && !(result as { job: unknown }).job) { sent = true; await send(0); }
      if (operation === 'complete') { completeCount++; if (completeCount === 1) await send(1); }
      if (operation === 'fail') controller.abort(new Error('MODEL_REPLY_FAILED'));
      return result;
    }
  };
  const ollama = new OllamaModelAdapter({ model });
  const measuredAdapter: ModelAdapter = {
    available: signal => ollama.available(signal), async generate(request, signal) {
      const response = await ollama.generate(request, signal);
      let rejection: string[] = [];
      if (currentContext) { try { validateAgentOutput(response.text, currentContext); } catch (error) { if (error instanceof AgentValidationError) rejection = error.codes; } }
      generations.push({ text: response.text, metrics: response.metrics, rejection });
      return response;
    }
  };
  const worker = new NovaBridgeWorker(api, measuredAdapter, {
    modelName: model,
    onMetrics: value => { metrics.push(value); if (metrics.length === 2) controller.abort(); },
  });
  await worker.run(AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]));
  const final = await browser<NovaChatState>('/api/nova/chat');
  const report = {
    environment: 'isolated-local-demo', origin, model, measuredAt: new Date().toISOString(),
    queueScenario: 'Message queued immediately after an empty claim; second turn queued immediately after first completion.',
    metrics, generations, jobs: final.jobs.filter(job => sources.includes(job.source_message_id ?? '')),
    conversation: final.messages.filter(message => sources.includes(message.id) || sources.includes(message.source_message_id ?? '')).map(({ sender, content, delivery_status }) => ({ sender, content, delivery_status })),
    completeCount, uniqueReplies: sources.every(id => final.messages.filter(message => message.sender === 'nova' && message.source_message_id === id).length === 1),
  };
  await writeFile(output, JSON.stringify(report, null, 2));
  if (completeCount !== 2 || !report.uniqueReplies) process.exitCode = 1;
  console.log(JSON.stringify({ output, completeCount, uniqueReplies: report.uniqueReplies, metrics }, null, 2));
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'BENCHMARK_FAILED'); process.exitCode = 1; });
