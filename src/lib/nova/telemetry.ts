import { z } from 'zod';

const duration = z.number().finite().min(0).max(3_600_000);
/** Only bounded timings and provenance; never prompts, tokens or credentials. */
export const novaMetricsSchema = z.object({
  durationMs: duration,
  inputTokens: z.number().int().min(0).max(1_000_000),
  outputTokens: z.number().int().min(0).max(1_000_000),
  provider: z.enum(['ollama', 'fake-test']).optional(),
  model: z.string().max(120).optional(),
  firstTokenMs: duration.optional(),
  loadMs: duration.optional(),
  promptEvalMs: duration.optional(),
  decodeMs: duration.optional(),
  totalModelMs: duration.optional(),
  repairMs: duration.optional(),
  generationAttempts: z.number().int().min(1).max(2).optional(),
  contextChars: z.number().int().min(0).max(56_000).optional(),
  availabilityMs: duration.optional(),
  claimMs: duration.optional(),
  contextMs: duration.optional(),
  leaseCheckMs: duration.optional(),
  // Queue residence can include a computer being offline for days.
  queueWaitMs: z.number().finite().min(0).max(31_536_000_000).optional(),
}).strict();

export type NovaMetrics = z.infer<typeof novaMetricsSchema>;
