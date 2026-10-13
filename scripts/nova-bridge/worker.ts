import { z } from 'zod';
import { agentContextSchema, AgentValidationError, generateAgentReply } from '../../src/lib/nova/agent';
import { ModelError, type ModelAdapter } from '../../src/lib/nova/model';
import type { Credentials } from './credentials';

export class BridgeError extends Error { constructor(public readonly code: string, public readonly status = 0) { super(code); } }
export function appOrigin(raw: string): string {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new BridgeError('APP_URL_INVALID');
  return url.origin;
}
export type BridgeApi = { call(operation: string, payload?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> };
export class HttpBridgeApi implements BridgeApi {
  private readonly origin: string;
  constructor(private readonly credentials: Credentials, private readonly fetcher: typeof fetch = fetch) { this.origin = appOrigin(credentials.appUrl); }
  async call(operation: string, payload: Record<string, unknown> = {}, signal?: AbortSignal) {
    return postBridge(this.origin, { operation, payload }, `${this.credentials.deviceId}.${this.credentials.token}`, signal, this.fetcher);
  }
}
export async function postBridge(origin: string, body: Record<string, unknown>, token?: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<unknown> {
  const timeout = AbortSignal.timeout(15000);
  const response = await fetcher(new URL('/api/nova/bridge', appOrigin(origin)), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new BridgeError(response.status === 401 || response.status === 403 ? 'DEVICE_REVOKED' : response.status === 409 ? 'CONFLICT' : response.status === 429 ? 'RATE_LIMITED' : 'BRIDGE_API_ERROR', response.status);
  const text = await response.text();
  if (text.length > 256000) throw new BridgeError('BRIDGE_RESPONSE_LIMIT');
  try { return JSON.parse(text); } catch { throw new BridgeError('BRIDGE_RESPONSE_INVALID'); }
}
const jobSchema = z.object({ id: z.string().uuid(), claim_token: z.string().min(1).max(200), lease_expires_at: z.string().datetime({ offset: true }) }).passthrough();
export type WorkerStatus = 'ready' | 'model_missing' | 'completed' | 'retry' | 'revoked' | 'stopped';
export type WorkerOptions = { pollMs?: number; heartbeatMs?: number; renewMs?: number; onStatus?: (status: WorkerStatus) => void; modelName?: string };
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const stop = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}
export class NovaBridgeWorker {
  private readonly stopController = new AbortController();
  private modelReady = false;
  constructor(private readonly api: BridgeApi, private readonly adapter: ModelAdapter, private readonly options: WorkerOptions = {}) {}
  stop() { this.stopController.abort(new BridgeError('SHUTDOWN')); }
  private status(status: WorkerStatus) { this.options.onStatus?.(status); }
  private async heartbeat(signal: AbortSignal) {
    const result = await this.api.call('heartbeat', { version: '1.0.0', model_available: this.modelReady, model: this.options.modelName ?? 'qwen3:8b' }, signal) as { revoked?: boolean } | null;
    if (result?.revoked) throw new BridgeError('DEVICE_REVOKED');
  }
  private revoke(error: unknown) {
    if (error instanceof BridgeError && error.code === 'DEVICE_REVOKED') { this.status('revoked'); this.stopController.abort(error); return true; }
    return false;
  }
  /** One bounded job; availability is checked BEFORE claiming/consuming an attempt. */
  async runOne(externalSignal?: AbortSignal): Promise<boolean> {
    const signal = externalSignal ? AbortSignal.any([externalSignal, this.stopController.signal]) : this.stopController.signal;
    signal.throwIfAborted();
    this.modelReady = await this.adapter.available(signal);
    await this.heartbeat(signal);
    if (!this.modelReady) { this.status('model_missing'); return false; }
    const claimed = z.object({ job: jobSchema.nullable() }).parse(await this.api.call('claim', {}, signal));
    if (!claimed.job) { this.status('ready'); return false; }
    const job = claimed.job;
    const claimPayload = { job_id: job.id, claim_token: job.claim_token };
    const controller = new AbortController(); const jobSignal = AbortSignal.any([signal, controller.signal]);
    let lostLease = false; let renewing = false;
    const renewal = setInterval(() => {
      if (renewing || jobSignal.aborted) return;
      renewing = true;
      void this.api.call('renew', claimPayload, jobSignal).then(value => {
        const result = value as { renewed?: boolean; ok?: boolean } | null;
        if (result?.renewed === false || result?.ok === false) throw new BridgeError('LEASE_LOST');
      }).catch(error => { lostLease = true; this.revoke(error); controller.abort(new BridgeError('LEASE_LOST')); }).finally(() => { renewing = false; });
    }, this.options.renewMs ?? 45000);
    try {
      const received = z.object({ context: agentContextSchema }).parse(await this.api.call('context', claimPayload, jobSignal));
      const { result, metrics } = await generateAgentReply(this.adapter, received.context, jobSignal);
      jobSignal.throwIfAborted();
      // Recheck lease/device after inference and before writing. Server fences stale claims too.
      const renewed = await this.api.call('renew', claimPayload, jobSignal) as { renewed?: boolean; ok?: boolean } | null;
      if (renewed?.renewed === false || renewed?.ok === false) throw new BridgeError('LEASE_LOST');
      await this.api.call('complete', { ...claimPayload, result, metrics }, jobSignal);
      this.status('completed'); return true;
    } catch (error) {
      if (this.revoke(error) || lostLease || signal.aborted || (error instanceof BridgeError && error.code === 'LEASE_LOST')) return false;
      const code = error instanceof AgentValidationError ? 'MODEL_OUTPUT_REJECTED' : error instanceof ModelError ? error.code : 'BRIDGE_JOB_FAILED';
      await this.api.call('fail', { ...claimPayload, error: code, retryable: !(error instanceof AgentValidationError) }, signal);
      this.status('retry'); return false;
    } finally { clearInterval(renewal); controller.abort(); }
  }
  async run(signal?: AbortSignal) {
    const combined = signal ? AbortSignal.any([signal, this.stopController.signal]) : this.stopController.signal;
    let heartbeatBusy = false;
    const heartbeat = setInterval(() => {
      if (heartbeatBusy || combined.aborted) return; heartbeatBusy = true;
      void this.heartbeat(combined).catch(error => { this.revoke(error); }).finally(() => { heartbeatBusy = false; });
    }, this.options.heartbeatMs ?? 60000);
    let failures = 0;
    try {
      while (!combined.aborted) {
        let delay = this.options.pollMs ?? 30000;
        try { if (await this.runOne(combined)) delay = 1000; failures = 0; }
        catch (error) { if (this.revoke(error) || combined.aborted) break; delay = Math.min(60000, 1000 * 2 ** Math.min(++failures, 6)); this.status('retry'); }
        await wait(delay, combined);
      }
    } catch (error) { if (!combined.aborted) throw error; }
    finally { clearInterval(heartbeat); this.stop(); this.status('stopped'); }
  }
}
