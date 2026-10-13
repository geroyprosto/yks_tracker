export type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ModelMetrics = { durationMs: number; inputTokens: number; outputTokens: number };
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
export class OllamaModelAdapter implements ModelAdapter {
  private readonly base: URL;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: { model?: string; baseUrl?: string; timeoutMs?: number; fetch?: typeof fetch } = {}) {
    this.base = localOllamaUrl(options.baseUrl); this.fetcher = options.fetch ?? fetch;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,120}$/u.test(this.model) || /cloud/iu.test(this.model)) throw new ModelError('OLLAMA_MODEL_INVALID');
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 120000)) throw new ModelError('OLLAMA_TIMEOUT_INVALID');
  }
  get model() { return this.options.model ?? 'qwen3:8b'; }
  private signal(signal: AbortSignal | undefined, ms: number) { return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms); }
  async available(signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await this.fetcher(new URL('/api/tags', this.base), { signal: this.signal(signal, 5000), redirect: 'error' });
      if (!response.ok) return false;
      const data = await boundedJson(response, 256000) as { models?: Array<{ name?: string; model?: string; remote_host?: string; remote_model?: string }> };
      return Array.isArray(data.models) && data.models.some(m => (m.name === this.model || m.model === this.model) && !m.remote_host && !m.remote_model);
    } catch (error) { if (signal?.aborted) throw error; return false; }
  }
  async generate(request: ModelRequest, signal?: AbortSignal): Promise<{ text: string; metrics: ModelMetrics }> {
    const started = performance.now();
    if (JSON.stringify(request.messages).length > 28000) throw new ModelError('OLLAMA_CONTEXT_LIMIT');
    const requestSignal = this.signal(signal, this.options.timeoutMs ?? 90000);
    try {
      const response = await this.fetcher(new URL('/api/chat', this.base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal: requestSignal,
        body: JSON.stringify({ model: this.model, messages: request.messages, stream: false, think: false, format: request.schema, options: { num_ctx: 8192, num_predict: 900, temperature: 0 }, keep_alive: '5m' }) });
      if (!response.ok) throw new ModelError(response.status === 404 ? 'OLLAMA_MODEL_MISSING' : response.status === 503 ? 'OLLAMA_BUSY' : 'OLLAMA_UNAVAILABLE');
      const data = await boundedJson(response, 64000) as { message?: { content?: unknown }; done?: boolean; done_reason?: string; prompt_eval_count?: number; eval_count?: number };
      if (data.done !== true || data.done_reason === 'length' || typeof data.message?.content !== 'string') throw new ModelError('OLLAMA_INCOMPLETE');
      return { text: data.message.content, metrics: { durationMs: Math.round(performance.now() - started), inputTokens: finiteCount(data.prompt_eval_count), outputTokens: finiteCount(data.eval_count) } };
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
  async generate(_request: ModelRequest, signal?: AbortSignal) { signal?.throwIfAborted(); const text = this.replies[Math.min(this.calls++, this.replies.length - 1)]; return { text, metrics: { durationMs: 0, inputTokens: 0, outputTokens: 0 } }; }
}
