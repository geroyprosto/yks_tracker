import { novaEvalCases } from '../../evals/nova/cases';
import { AgentValidationError, agentOutputJsonSchema, buildAgentMessages, validateAgentOutput } from '../../src/lib/nova/agent';
import type { ModelAdapter } from '../../src/lib/nova/model';

type Attempt = { validJson: boolean; accepted: boolean; codes: string[]; durationMs: number; inputTokens: number; outputTokens: number };
export async function evaluateModel(adapter: ModelAdapter, model: string, signal?: AbortSignal) {
  if (!await adapter.available(signal)) throw new Error('OLLAMA_MODEL_MISSING');
  const results: Array<Attempt & { id: string; category: string; finalAccepted: boolean; attempts: number; finalCodes: string[]; totalDurationMs: number; totalInputTokens: number; totalOutputTokens: number; repair?: Attempt }> = [];
  for (const fixture of novaEvalCases) {
    signal?.throwIfAborted();
    const attempts: Attempt[] = []; let repairCodes: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      let validJson = false; let accepted = false; let codes: string[] = []; let repairable = false;
      let metrics = { durationMs: 0, inputTokens: 0, outputTokens: 0 };
      const start = performance.now();
      try {
        const reply = await adapter.generate({ messages: buildAgentMessages(fixture.context, repairCodes), schema: agentOutputJsonSchema(fixture.context) }, signal);
        metrics = reply.metrics;
        let value: unknown; try { value = JSON.parse(reply.text); validJson = true; } catch { throw new AgentValidationError(['invalid_json']); }
        validateAgentOutput(value, fixture.context); accepted = true;
      } catch (error) {
        signal?.throwIfAborted();
        repairable = error instanceof AgentValidationError;
        codes = error instanceof AgentValidationError ? error.codes : ['model_error'];
        metrics.durationMs = Math.round(performance.now() - start);
      }
      attempts.push({ validJson, accepted, codes, ...metrics });
      if (accepted || !repairable) break;
      repairCodes = codes;
    }
    const first = attempts[0]; const final = attempts[attempts.length - 1];
    results.push({ id: fixture.id, category: fixture.category, ...first,
      finalAccepted: final.accepted, attempts: attempts.length, finalCodes: final.codes,
      totalDurationMs: attempts.reduce((sum, result) => sum + result.durationMs, 0),
      totalInputTokens: attempts.reduce((sum, result) => sum + result.inputTokens, 0),
      totalOutputTokens: attempts.reduce((sum, result) => sum + result.outputTokens, 0),
      ...(attempts[1] ? { repair: attempts[1] } : {}),
    });
  }
  const total = results.length; const sorted = results.map(r => r.durationMs).sort((a, b) => a - b);
  const finalSorted = results.map(r => r.totalDurationMs).sort((a, b) => a - b);
  const repaired = results.filter(r => r.attempts === 2);
  const passRate = (codes: string[]) => results.filter(r => r.validJson && !r.codes.some(c => [...codes, 'invalid_schema', 'model_error'].includes(c))).length / total;
  return {
    model, caseCount: total, jsonRate: results.filter(r => r.validJson).length / total,
    acceptedRate: results.filter(r => r.accepted).length / total,
    finalAcceptedRate: results.filter(r => r.finalAccepted).length / total,
    repairCount: repaired.length, repairAcceptedRate: repaired.length ? repaired.filter(r => r.finalAccepted).length / repaired.length : null,
    factGuardRate: passRate(['unknown_fact', 'unsupported_number', 'spelled_number', 'unsupported_event', 'numeric_claim_requires_fact']),
    safetyGuardRate: passRate(['manipulation', 'sleep_pressure', 'markup', 'secret', 'sensitive_memory', 'memory_without_consent']),
    styleGuardRate: passRate(['manipulation', 'language', 'markup']), sourceGuardRate: passRate(['unknown_fact', 'duplicate_fact', 'memory_without_consent']),
    latencyMs: { p50: sorted[Math.floor(total * 0.5)], p95: sorted[Math.min(total - 1, Math.ceil(total * 0.95) - 1)] },
    finalLatencyMs: { p50: finalSorted[Math.floor(total * 0.5)], p95: finalSorted[Math.min(total - 1, Math.ceil(total * 0.95) - 1)] },
    usage: { inputTokens: results.reduce((sum, r) => sum + r.inputTokens, 0), outputTokens: results.reduce((sum, r) => sum + r.outputTokens, 0) },
    totalUsage: { inputTokens: results.reduce((sum, r) => sum + r.totalInputTokens, 0), outputTokens: results.reduce((sum, r) => sum + r.totalOutputTokens, 0) },
    note: 'acceptedRate, koruyucu oranları, latencyMs ve usage ilk denemeyi ölçer. finalAcceptedRate, finalLatencyMs ve totalUsage üretimdeki tek onarım hakkını da içerir. repairAcceptedRate yalnızca onarım yapılan vakaların oranıdır. Otomatik kontroller anlamsal doğruluk veya doğal Türkçe kalite garantisi değildir; cevaplar ayrıca insan tarafından değerlendirilmelidir. Yanıt metinleri bu rapora kaydedilmez.',
    results,
  };
}
