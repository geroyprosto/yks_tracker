import { z } from 'zod';

export const agentHouseAgentIds = ['leader', 'strategy', 'tracking', 'awareness', 'daily', 'discovery'] as const;
export const agentHouseModes = ['sample', 'live'] as const;
export const agentHouseReportMaxBytes = 128 * 1024;

const title = z.string().min(1).max(180);
const date = z.iso.date();
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const sourceUrl = z.string().max(2048).regex(/^https?:\/\//i).pipe(z.url({ protocol: /^https?$/ })).refine(value => {
  const { username, password } = new URL(value);
  return !username && !password;
});
const source = z.strictObject({
  title,
  url: sourceUrl.optional(),
  note: z.string().max(1000).optional(),
});
const table = z.strictObject({
  title,
  columns: z.array(z.string().min(1).max(80)).min(1).max(10),
  rows: z.array(z.array(z.string().max(500)).max(10)).max(100),
}).refine(value => value.rows.every(row => row.length === value.columns.length), { path: ['rows'] });
const block = z.strictObject({
  date,
  start: clock,
  end: clock,
  title,
  detail: z.string().max(2000).optional(),
}).refine(value => value.start < value.end, { path: ['end'] });
const agent = z.strictObject({
  id: z.enum(agentHouseAgentIds),
  status: z.enum(['ready', 'no_data', 'skipped']),
  summary: z.string().max(2000),
  recommendations: z.array(z.string().max(700)).max(12),
  sources: z.array(source).max(16),
  tables: z.array(table).max(6),
  schedule: z.array(block).max(100),
});

export const agentHouseReportSchema = z.strictObject({
  schema_version: z.literal(1),
  run_id: z.string().min(1).max(128).regex(/^[a-z0-9._-]+$/i),
  mode: z.enum(agentHouseModes),
  generated_at: z.iso.datetime({ offset: true }),
  week_start: date,
  title,
  agents: z.array(agent).min(1).max(agentHouseAgentIds.length),
}).refine(value => new Set(value.agents.map(item => item.id)).size === value.agents.length, { path: ['agents'] });

export type AgentHouseReport = z.infer<typeof agentHouseReportSchema>;
export type AgentHouseAgent = z.infer<typeof agent>;
export type AgentHouseAgentId = typeof agentHouseAgentIds[number];
export type AgentHouseMode = typeof agentHouseModes[number];
export type AgentHouseRuns = Record<AgentHouseMode, AgentHouseReport[]>;
