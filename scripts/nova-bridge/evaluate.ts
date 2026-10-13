import { z } from 'zod';
import { novaEvalCases } from '../../evals/nova/cases';
import { AgentValidationError, agentOutputSchema, buildAgentMessages, validateAgentOutput } from '../../src/lib/nova/agent';
import type { ModelAdapter } from '../../src/lib/nova/model';

export async function evaluateModel(adapter: ModelAdapter, model: string, signal?: AbortSignal) {
  if (!await adapter.available(signal)) throw new Error('OLLAMA_MODEL_MISSING');
  const results: Array<{ id: string; category: string; validJson: boolean; accepted: boolean; codes: string[]; durationMs: number; inputTokens: number; outputTokens: number }> = [];
  for (const fixture of novaEvalCases) {
    signal?.throwIfAborted();
    let validJson = false; let accepted = false; let codes: string[] = []; let metrics = { durationMs: 0, inputTokens: 0, outputTokens: 0 };
    const start = performance.now();
    try {
      const reply = await adapter.generate({ messages: buildAgentMessages(fixture.context), schema: z.toJSONSchema(agentOutputSchema) }, signal);
      metrics = reply.metrics;
      let value: unknown; try { value = JSON.parse(reply.text); validJson = true; } catch { codes = ['invalid_json']; }
      if (validJson) { validateAgentOutput(value, fixture.context); accepted = true; }
    } catch (error) { codes = error instanceof AgentValidationError ? error.codes : ['model_error']; metrics.durationMs = Math.round(performance.now() - start); }
    results.push({ id: fixture.id, category: fixture.category, validJson, accepted, codes, ...metrics });
  }
  const total = results.length; const sorted = results.map(r => r.durationMs).sort((a, b) => a - b);
  const passRate = (codes: string[]) => results.filter(r => r.validJson && !r.codes.some(c => [...codes, 'invalid_schema', 'model_error'].includes(c))).length / total;
  return {
    model, caseCount: total, jsonRate: results.filter(r => r.validJson).length / total,
    acceptedRate: results.filter(r => r.accepted).length / total,
    factGuardRate: passRate(['unknown_fact', 'unsupported_number', 'spelled_number', 'unsupported_event', 'numeric_claim_requires_fact']),
    safetyGuardRate: passRate(['manipulation', 'sleep_pressure', 'markup', 'secret', 'sensitive_memory', 'memory_without_consent']),
    styleGuardRate: passRate(['manipulation', 'language', 'markup']), sourceGuardRate: passRate(['unknown_fact', 'duplicate_fact', 'memory_without_consent']),
    latencyMs: { p50: sorted[Math.floor(total * 0.5)], p95: sorted[Math.min(total - 1, Math.ceil(total * 0.95) - 1)] },
    usage: { inputTokens: results.reduce((sum, r) => sum + r.inputTokens, 0), outputTokens: results.reduce((sum, r) => sum + r.outputTokens, 0) },
    note: 'Otomatik koruyucu ölçümleri anlamsal doğruluk veya doğal Türkçe kalite garantisi değildir. Türkçe cevaplar ayrıca insan tarafından değerlendirilmelidir. Yanıt metinleri bu rapora kaydedilmez.',
    results,
  };
}
