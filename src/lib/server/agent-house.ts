import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { agentHouseReportMaxBytes, agentHouseReportSchema, type AgentHouseMode, type AgentHouseRuns } from '../agent-house';
import { ApiError } from './http';
import { databaseError } from './service';

const runsPerMode = 5;
const saveResultSchema = z.strictObject({ run: agentHouseReportSchema, created: z.boolean() });

export async function listAgentHouseReports(client: SupabaseClient, verifiedUserId: string): Promise<AgentHouseRuns> {
  async function list(mode: AgentHouseMode) {
    const { data, error } = await client.from('agent_house_reports').select('report')
      .eq('user_id', verifiedUserId).eq('mode', mode).order('generated_at', { ascending: false })
      .order('run_id', { ascending: false }).limit(runsPerMode);
    if (error) databaseError(error);
    return (data ?? []).flatMap(row => {
      const parsed = agentHouseReportSchema.safeParse(row.report);
      return parsed.success ? [parsed.data] : [];
    });
  }

  const [sample, live] = await Promise.all([list('sample'), list('live')]);
  return { sample, live };
}

function parseReport(input: unknown) {
  const parsed = agentHouseReportSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'INVALID_INPUT', 'Ajan evi raporu geçerli değil.');
  if (Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > agentHouseReportMaxBytes) {
    throw new ApiError(413, 'BODY_TOO_LARGE', 'Ajan evi raporu çok büyük.');
  }
  return parsed.data;
}

function parseSaveResult(data: unknown, error: Parameters<typeof databaseError>[0] | null) {
  if (error) {
    if (error.code === '42501') throw new ApiError(403, 'ACCESS_DENIED', 'Bu raporu kaydetme yetkiniz bulunmuyor.');
    databaseError(error);
  }
  const result = saveResultSchema.safeParse(data);
  if (!result.success) throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'Raporun kaydı doğrulanamadı.');
  return result.data;
}

export async function saveAgentHouseReport(client: SupabaseClient, verifiedUserId: string, input: unknown) {
  const { data, error } = await client.rpc('agent_house_save_for_user', {
    p_user_id: verifiedUserId, p_report: parseReport(input),
  });
  return parseSaveResult(data, error);
}

export async function saveAgentHouseMcpReport(client: SupabaseClient, verifiedUserId: string, input: unknown) {
  const { data, error } = await client.rpc('agent_house_publish_for_owner', {
    p_user_id: verifiedUserId, p_report: parseReport(input),
  });
  return parseSaveResult(data, error);
}
