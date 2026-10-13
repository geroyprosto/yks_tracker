export type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type { NovaMetrics as ModelMetrics } from './telemetry';
import type { NovaMetrics as ModelMetrics } from './telemetry';
export type ModelRequest = { messages: ModelMessage[]; schema: Record<string, unknown> };
export interface ModelAdapter {
  available(signal?: AbortSignal): Promise<boolean>;
  generate(request: ModelRequest, signal?: AbortSignal): Promise<{ text: string; metrics: ModelMetrics }>;
}
export class ModelError extends Error { constructor(public readonly code: string) { super(code); this.name = 'ModelError'; } }
export function localOllamaUrl(raw = 'http://127.0.0.1:11434'): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ModelError('OLLAMA_LOCAL_ONLY'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.port && url.port !== '11434')) throw new ModelError('OLLAMA_LOCAL_ONLY');
  return url;
}
async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) throw new ModelError('OLLAMA_RESPONSE');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) throw new ModelError('OLLAMA_RESPONSE_LIMIT'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ModelError('OLLAMA_RESPONSE'); }
}
const finiteCount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
type OllamaChunk = {
  message?: { content?: unknown; thinking?: unknown }; done?: boolean; done_reason?: string; error?: unknown;
  prompt_eval_count?: number; eval_count?: number;
  total_duration?: number; load_duration?: number; prompt_eval_duration?: number; eval_duration?: number;
};
const milliseconds = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
  ? Math.round(value / 1_000_000) : undefined;

/** Streaming stays local. Nothing is published until the complete JSON passes the Agent guards. */
async function readOllamaStream(response: Response, started: number) {
  if (!response.body) throw new ModelError('OLLAMA_RESPONSE');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', text = '', bytes = 0, firstTokenMs: number | undefined;
  let final: OllamaChunk | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    let chunk: OllamaChunk;
    try { chunk = JSON.parse(line) as OllamaChunk; } catch { throw new ModelError('OLLAMA_RESPONSE'); }
    if (!chunk || typeof chunk !== 'object' || final) throw new ModelError('OLLAMA_RESPONSE');
    if (chunk.error) throw new ModelError('OLLAMA_GENERATION_FAILED');
    if (typeof chunk.message?.thinking === 'string' && chunk.message.thinking.length) throw new ModelError('OLLAMA_REASONING_UNEXPECTED');
    if (chunk.message?.content !== undefined && typeof chunk.message.content !== 'string') throw new ModelError('OLLAMA_RESPONSE');
    if (typeof chunk.message?.content === 'string' && chunk.message.content) {
      firstTokenMs ??= Math.round(performance.now() - started);
      text += chunk.message.content;
      if (text.length > 64000) throw new ModelError('OLLAMA_RESPONSE_LIMIT');
    }
    if (chunk.done === true) final = chunk;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1_000_000) throw new ModelError('OLLAMA_RESPONSE_LIMIT');
      pending += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = pending.indexOf('\n')) >= 0) { consume(pending.slice(0, index)); pending = pending.slice(index + 1); }
      if (pending.length > 64000) throw new ModelError('OLLAMA_RESPONSE_LIMIT');
    }
    pending += decoder.decode(); consume(pending);
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  if (!final || final.done_reason === 'length' || !text) throw new ModelError('OLLAMA_INCOMPLETE');
  return { text, final, firstTokenMs };
}

export type OllamaHealth = { available: boolean; reason: 'ready' | 'model_missing' | 'unreachable'; models: string[] };
export class OllamaModelAdapter implements ModelAdapter {
  private readonly base: URL;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: { model?: string; baseUrl?: string; timeoutMs?: number; keepAlive?: string; fetch?: typeof fetch } = {}) {
    this.base = localOllamaUrl(options.baseUrl); this.fetcher = options.fetch ?? fetch;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,120}$/u.test(this.model) || /cloud/iu.test(this.model)) throw new ModelError('OLLAMA_MODEL_INVALID');
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 120000)) throw new ModelError('OLLAMA_TIMEOUT_INVALID');
    if (options.keepAlive !== undefined && !/^(?:0|[1-9]|[1-9][0-9]?[sm]|[12]h)$/u.test(options.keepAlive)) throw new ModelError('OLLAMA_KEEP_ALIVE_INVALID');
  }
  get model() { return this.options.model ?? 'qwen3:8b'; }
  private signal(signal: AbortSignal | undefined, ms: number) { return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms); }
  async inspect(signal?: AbortSignal): Promise<OllamaHealth> {
    try {
      const response = await this.fetcher(new URL('/api/tags', this.base), { signal: this.signal(signal, 5000), redirect: 'error' });
      if (!response.ok) return { available: false, reason: 'unreachable', models: [] };
      const data = await boundedJson(response, 256000) as { models?: Array<{ name?: string; model?: string; remote_host?: string; remote_model?: string }> };
      const models = Array.isArray(data.models) ? data.models.filter(m => !m.remote_host && !m.remote_model).flatMap(m => typeof m.name === 'string' ? [m.name] : typeof m.model === 'string' ? [m.model] : []) : [];
      const available = models.includes(this.model);
      return { available, reason: available ? 'ready' : 'model_missing', models };
    } catch (error) { if (signal?.aborted) throw error; return { available: false, reason: 'unreachable', models: [] }; }
  }
  async available(signal?: AbortSignal): Promise<boolean> { return (await this.inspect(signal)).available; }
  async generate(request: ModelRequest, signal?: AbortSignal): Promise<{ text: string; metrics: ModelMetrics }> {
    const started = performance.now();
    if (JSON.stringify(request.messages).length > 28000) throw new ModelError('OLLAMA_CONTEXT_LIMIT');
    const requestSignal = this.signal(signal, this.options.timeoutMs ?? 90000);
    try {
      const response = await this.fetcher(new URL('/api/chat', this.base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: requestSignal,
        body: JSON.stringify({ model: this.model, messages: request.messages, stream: true, think: false, format: request.schema, options: { num_ctx: 8192, num_predict: 768, temperature: 0 }, keep_alive: this.options.keepAlive ?? '15m' }) });
      if (!response.ok) throw new ModelError(response.status === 404 ? 'OLLAMA_MODEL_MISSING' : response.status === 503 ? 'OLLAMA_BUSY' : 'OLLAMA_UNAVAILABLE');
      const { text, final: data, firstTokenMs } = await readOllamaStream(response, started);
      return { text, metrics: { durationMs: Math.round(performance.now() - started), inputTokens: finiteCount(data.prompt_eval_count), outputTokens: finiteCount(data.eval_count),
        provider: 'ollama', model: this.model, firstTokenMs, loadMs: milliseconds(data.load_duration), promptEvalMs: milliseconds(data.prompt_eval_duration),
        decodeMs: milliseconds(data.eval_duration), totalModelMs: milliseconds(data.total_duration), contextChars: JSON.stringify(request.messages).length } };
    } catch (error) {
      if (signal?.aborted) throw new ModelError('ABORTED');
      if (requestSignal.aborted) throw new ModelError('OLLAMA_TIMEOUT');
      if (error instanceof ModelError) throw error;
      throw new ModelError('OLLAMA_UNAVAILABLE');
    }
  }
}
/** Explicit test adapter. Never selected as production failure fallback. */
export class FakeModelAdapter implements ModelAdapter {
  calls = 0;
  constructor(private readonly replies: string[] = [JSON.stringify({ reply: 'Birlikte sakin bir başlangıç yapalım.', intent: 'NONE', expressedEmotion: 'CALM', referencedFactIds: [], memoryCandidates: [], proposedAction: null })], private readonly ready = true) {}
  async available() { return this.ready; }
  async generate(_request: ModelRequest, signal?: AbortSignal) { signal?.throwIfAborted(); const text = this.replies[Math.min(this.calls++, this.replies.length - 1)]; return { text, metrics: { durationMs: 0, inputTokens: 0, outputTokens: 0, provider: 'fake-test' as const, model: 'fake-test-adapter' } }; }
}
