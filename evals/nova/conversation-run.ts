import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ModelAdapter } from '../../src/lib/nova/model';
import { novaConversationCases } from './conversation-cases';

// Opt-in local experiment. Runs the real production agent flow with synthetic inputs only.
async function main() {
  const output = process.argv[2];
  if (!output) throw new Error('An unused report path is required');
  const implementation = process.argv[4] ? pathToFileURL(`${resolve(process.argv[4])}/`) : new URL('../../src/lib/nova/', import.meta.url);
  const agentUrl = new URL('agent.ts', implementation), modelUrl = new URL('model.ts', implementation);
  const agentSource = await readFile(agentUrl), modelSource = await readFile(modelUrl);
  const { AgentValidationError, generateAgentReply, validateAgentOutput } = await import(agentUrl.href) as typeof import('../../src/lib/nova/agent');
  const { ModelError, OllamaModelAdapter } = await import(modelUrl.href) as typeof import('../../src/lib/nova/model');
  const rawMetrics: Array<Record<string, unknown>> = [];
  const pendingReads: Promise<void>[] = [];
  const trackedFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (init?.method === 'POST' && response.ok) {
      const clone = response.clone();
      pendingReads.push((async () => {
        const text = await clone.text();
        const chunks = text.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
        const last = chunks.at(-1)!;
        rawMetrics.push({ done: last.done, doneReason: last.done_reason, loadMs: Number(last.load_duration ?? 0) / 1e6,
          promptEvalMs: Number(last.prompt_eval_duration ?? 0) / 1e6, decodeMs: Number(last.eval_duration ?? 0) / 1e6,
          totalModelMs: Number(last.total_duration ?? 0) / 1e6, inputTokens: last.prompt_eval_count, outputTokens: last.eval_count });
      })());
    }
    return response;
  };
  const modelName = process.argv[3] ?? 'qwen3:8b';
  const native = new OllamaModelAdapter({ model: modelName, fetch: trackedFetch });
  if (!await native.available()) throw new Error('OLLAMA_MODEL_MISSING');
  const results = [];
  for (const fixture of novaConversationCases) {
    const attempts: Array<Record<string, unknown>> = [];
    const model: ModelAdapter = { available: signal => native.available(signal), generate: async (request, signal) => {
      const start = performance.now();
      try {
        const response = await native.generate(request, signal);
        let codes: string[] = []; try { validateAgentOutput(response.text, fixture.context); } catch (error) { codes = error instanceof AgentValidationError ? error.codes : ['unknown']; }
        attempts.push({ accepted: codes.length === 0, codes, rawSyntheticOutput: response.text, ...response.metrics });
        return response;
      } catch (error) { attempts.push({ accepted: false, codes: [error instanceof ModelError ? error.code : 'unknown'], durationMs: Math.round(performance.now() - start) }); throw error; }
    } };
    const started = performance.now();
    try {
      const result = await generateAgentReply(model, fixture.context);
      results.push({ id: fixture.id, expected: fixture.expected, accepted: true, ...result, wallMs: Math.round(performance.now() - started), attemptsDetail: attempts });
    } catch (error) {
      results.push({ id: fixture.id, expected: fixture.expected, accepted: false, error: error instanceof Error ? error.message : 'unknown', wallMs: Math.round(performance.now() - started), attemptsDetail: attempts });
    }
    console.log(JSON.stringify({ id: fixture.id, accepted: results.at(-1)!.accepted, attempts: attempts.length }));
  }
  await Promise.all(pendingReads);
  const wall = results.map(item => item.wallMs).sort((a, b) => a - b);
  const report = { syntheticInputsOnly: true, model: modelName, observedAt: new Date().toISOString(),
    agentSha256: createHash('sha256').update(agentSource).digest('hex'),
    modelAdapterSha256: createHash('sha256').update(modelSource).digest('hex'),
    fixturesSha256: createHash('sha256').update(JSON.stringify(novaConversationCases)).digest('hex'),
    caseCount: results.length, firstAcceptedCount: results.filter(item => item.attemptsDetail[0].accepted).length,
    finalAcceptedCount: results.filter(item => item.accepted).length, repairCount: results.filter(item => item.attemptsDetail.length > 1).length,
    wallMs: { p50: wall[Math.floor(wall.length / 2)], p95: wall[Math.ceil(wall.length * .95) - 1] },
    rawMetrics, results };
  await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ output, first: report.firstAcceptedCount, final: report.finalAcceptedCount, count: report.caseCount, wallMs: report.wallMs }));
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'EVAL_FAILED'); process.exitCode = 1; });
