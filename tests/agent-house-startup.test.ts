import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publishPreparedReport } from '../scripts/agent-house-codex/startup-core';

const report = { schema_version: 1, run_id: 'cloud-ready', mode: 'live', generated_at: '2026-11-14T15:00:00Z',
  week_start: '2026-11-09', title: 'Hazır', agents: [{ id: 'leader', status: 'ready', summary: 'Bir adım.', recommendations: [], sources: [], tables: [], schedule: [] }] };
function fake(draft: unknown, changed = false) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === 'agent_house_read_draft') return { data: draft, error: null };
    return changed ? { data: null, error: { message: 'DRAFT_CHANGED' } }
      : { data: { published: true, run_id: report.run_id }, error: null };
  } } as unknown as Pick<SupabaseClient, 'rpc'>;
  return { client, calls };
}
test('startup only promotes a strictly valid live draft with its exact run id', async () => {
  const { client, calls } = fake(report);
  assert.deepEqual(await publishPreparedReport(client, 'owner'), { published: true, run_id: 'cloud-ready' });
  assert.deepEqual(calls.map(c => c.name), ['agent_house_read_draft', 'agent_house_publish_draft']);
  assert.deepEqual(calls[1].args, { p_user_id: 'owner', p_run_id: 'cloud-ready' });
});
test('no draft, malformed draft and a raced replacement never silently publish', async () => {
  const empty = fake(null);
  assert.deepEqual(await publishPreparedReport(empty.client, 'owner'), { published: false });
  assert.equal(empty.calls.length, 1);
  for (const bad of [{ ...report, extra: true }, { ...report, mode: 'sample' }, { ...report, agents: [{ id: 'leader' }] }]) {
    const value = fake(bad);
    await assert.rejects(() => publishPreparedReport(value.client, 'owner'));
    assert.equal(value.calls.length, 1);
  }
  await assert.rejects(() => publishPreparedReport(fake(report, true).client, 'owner'), /DRAFT_CHANGED/);
});
