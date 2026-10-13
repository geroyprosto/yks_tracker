import { z } from 'zod';
import { agentContextSchema, AgentValidationError, generateAgentReply } from '../../src/lib/nova/agent';
import { ModelError, type ModelAdapter } from '../../src/lib/nova/model';
import type {NovaMetrics} from '../../src/lib/nova/telemetry';
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
const jobSchema = z.object({ id: z.string().uuid(), claim_token: z.string().min(1).max(200), lease_expires_at: z.string().datetime({ offset: true }), created_at:z.string().datetime({offset:true}).optional(), started_at:z.string().datetime({offset:true}).optional() }).passthrough();
export type WorkerStatus = 'ready' | 'model_missing' | 'completed' | 'retry' | 'revoked' | 'stopped';
export type WorkerOptions = { pollMs?: number; activePollMs?:number; heartbeatMs?: number; renewMs?: number; onStatus?: (status: WorkerStatus) => void; modelName?: string; onMetrics?:(metrics:NovaMetrics&{deliveryMs:number;pipelineMs:number})=>void; now?:()=>number };
/** Short polling is limited to a recent conversation. Idle polling never runs every second. */
export function nextBridgePollMs(now:number,lastCompleted:number,options:Pick<WorkerOptions,'pollMs'|'activePollMs'>={}){
  return now-lastCompleted<60_000 ? options.activePollMs??2000 : options.pollMs??10_000;
}
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
  private lastModelCheck = -Infinity;
  private lastHeartbeat = -Infinity;
  private previousStatus:WorkerStatus|undefined;
  constructor(private readonly api: BridgeApi, private readonly adapter: ModelAdapter, private readonly options: WorkerOptions = {}) {}
  stop() { this.stopController.abort(new BridgeError('SHUTDOWN')); }
  private now(){return this.options.now?.()??performance.now();}
  private status(status: WorkerStatus) { if(status!==this.previousStatus){this.previousStatus=status;this.options.onStatus?.(status);} }
  private async heartbeat(signal: AbortSignal) {
    const result = await this.api.call('heartbeat', { version: '1.1.0', model_available: this.modelReady, model: this.options.modelName ?? 'qwen3:8b' }, signal) as { revoked?: boolean } | null;
    if (result?.revoked) throw new BridgeError('DEVICE_REVOKED');
    this.lastHeartbeat=this.now();
  }
  private revoke(error: unknown) {
    if (error instanceof BridgeError && error.code === 'DEVICE_REVOKED') { this.status('revoked'); this.stopController.abort(error); return true; }
    return false;
  }
  /** One bounded job; availability is checked BEFORE claiming/consuming an attempt. */
  async runOne(externalSignal?: AbortSignal): Promise<boolean> {
    const signal = externalSignal ? AbortSignal.any([externalSignal, this.stopController.signal]) : this.stopController.signal;
    signal.throwIfAborted();
    const pipelineStarted=this.now(), availabilityStarted=this.now();
    const wasReady=this.modelReady;
    if(this.now()-this.lastModelCheck>=30_000){this.modelReady=await this.adapter.available(signal);this.lastModelCheck=this.now();}
    const availabilityMs=Math.round(this.now()-availabilityStarted);
    if(wasReady!==this.modelReady||this.now()-this.lastHeartbeat>=(this.options.heartbeatMs??60_000))await this.heartbeat(signal);
    if (!this.modelReady) { this.status('model_missing'); return false; }
    const claimStarted=this.now();
    const claimed = z.object({ job: jobSchema.nullable() }).parse(await this.api.call('claim', {}, signal));
    const claimMs=Math.round(this.now()-claimStarted);
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
      const contextStarted=this.now();
      const received = z.object({ context: agentContextSchema }).parse(await this.api.call('context', claimPayload, jobSignal));
      const contextMs=Math.round(this.now()-contextStarted);
      // The existing lease endpoint marks GENERATING; do so when inference actually begins.
      const generationLease=await this.api.call('renew',claimPayload,jobSignal) as {renewed?:boolean;ok?:boolean}|null;
      if(generationLease?.renewed===false||generationLease?.ok===false)throw new BridgeError('LEASE_LOST');
      const { result, metrics } = await generateAgentReply(this.adapter, received.context, jobSignal);
      jobSignal.throwIfAborted();
      // Recheck lease/device after inference and before writing. Server fences stale claims too.
      const leaseStarted=this.now();
      const renewed = await this.api.call('renew', claimPayload, jobSignal) as { renewed?: boolean; ok?: boolean } | null;
      if (renewed?.renewed === false || renewed?.ok === false) throw new BridgeError('LEASE_LOST');
      const queueWaitMs=job.created_at&&job.started_at?Math.max(0,Date.parse(job.started_at)-Date.parse(job.created_at)):undefined;
      const measured:NovaMetrics={...metrics,availabilityMs,claimMs,contextMs,leaseCheckMs:Math.round(this.now()-leaseStarted),...(queueWaitMs!==undefined?{queueWaitMs:Math.min(queueWaitMs,31_536_000_000)}:{})};
      const deliveryStarted=this.now();
      await this.api.call('complete', { ...claimPayload, result, metrics:measured }, jobSignal);
      // A diagnostic sink failing after commit must not mark an already delivered reply failed.
      try{this.options.onMetrics?.({...measured,deliveryMs:Math.round(this.now()-deliveryStarted),pipelineMs:Math.round(this.now()-pipelineStarted)});}catch{}
      this.status('completed'); return true;
    } catch (error) {
      if (this.revoke(error) || lostLease || signal.aborted || (error instanceof BridgeError && error.code === 'LEASE_LOST')) return false;
      const code = error instanceof AgentValidationError ? 'MODEL_OUTPUT_REJECTED' : error instanceof ModelError ? error.code : 'BRIDGE_JOB_FAILED';
      if(error instanceof ModelError&&['OLLAMA_MODEL_MISSING','OLLAMA_UNAVAILABLE'].includes(error.code)){
        this.modelReady=false;this.lastModelCheck=-Infinity;
        await this.heartbeat(signal);
      }
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
    let failures = 0,lastCompleted=-Infinity;
    try {
      while (!combined.aborted) {
        let delay = nextBridgePollMs(this.now(),lastCompleted,this.options);
        try {
          const completed=await this.runOne(combined);failures=0;
          // Drain already queued turns immediately; no artificial post-reply wait.
          if(completed){lastCompleted=this.now();continue;}
          delay=nextBridgePollMs(this.now(),lastCompleted,this.options);
        }
        catch (error) { if (this.revoke(error) || combined.aborted) break; delay = Math.min(60000, 1000 * 2 ** Math.min(++failures, 6)); this.status('retry'); }
        await wait(delay, combined);
      }
    } catch (error) { if (!combined.aborted) throw error; }
    finally { clearInterval(heartbeat); this.stop(); this.status('stopped'); }
  }
}
