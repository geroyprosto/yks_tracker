import type { SupabaseClient } from '@supabase/supabase-js';
import { agentHouseReportMaxBytes, agentHouseReportSchema } from '../../src/lib/agent-house';

/** No model inference: validate and atomically promote the already prepared cloud draft. */
export async function publishPreparedReport(client: Pick<SupabaseClient, 'rpc'>, owner: string) {
  const draft = await client.rpc('agent_house_read_draft', { p_user_id: owner });
  if (draft.error) throw new Error('DRAFT_READ_FAILED');
  if (draft.data === null) return { published: false };
  const report = agentHouseReportSchema.parse(draft.data);
  if (report.mode !== 'live' || Buffer.byteLength(JSON.stringify(report), 'utf8') > agentHouseReportMaxBytes) {
    throw new Error('INVALID_DRAFT');
  }
  const result = await client.rpc('agent_house_publish_draft', { p_user_id: owner, p_run_id: report.run_id });
  if (result.error) throw new Error(result.error.message === 'DRAFT_CHANGED' ? 'DRAFT_CHANGED' : 'PUBLISH_FAILED');
  if (result.data?.published === false) return { published: false };
  if (result.data?.published !== true || result.data?.run_id !== report.run_id) throw new Error('RECEIPT_INVALID');
  return { published: true, run_id: report.run_id };
}
