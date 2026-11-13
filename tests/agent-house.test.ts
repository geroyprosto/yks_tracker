import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentHouseReportSchema, type AgentHouseReport } from '../src/lib/agent-house';

const report = {
  schema_version: 1,
  run_id: 'sample-2026-11-16',
  mode: 'sample',
  generated_at: '2026-11-13T22:00:00+03:00',
  week_start: '2026-11-16',
  title: 'Örnek haftalık plan',
  agents: [{
    id: 'leader', status: 'ready', summary: 'Plan hazır.', recommendations: [],
    sources: [{ title: 'Kaynak', url: 'https://example.org/rapor' }],
    tables: [{ title: 'Oturumlar', columns: ['Ders', 'Süre'], rows: [['Matematik', '20 dk']] }],
    schedule: [{ date: '2026-11-16', start: '16:00', end: '16:20', title: 'Matematik' }],
  }],
} satisfies AgentHouseReport;

test('agent house accepts a projected display report', () => {
  assert.deepEqual(agentHouseReportSchema.parse(report), report);
});

test('agent house rejects owner fields, private journal fields, and duplicate agent cards', () => {
  assert.equal(agentHouseReportSchema.safeParse({ ...report, user_id: 'forged' }).success, false);
  const card = report.agents[0];
  assert.equal(agentHouseReportSchema.safeParse({ ...report, agents: [{ ...card, raw_journal: 'private' }] }).success, false);
  assert.equal(agentHouseReportSchema.safeParse({ ...report, agents: [card, card] }).success, false);
});

test('agent house rejects unsafe links and malformed table or schedule data', () => {
  const card = report.agents[0];
  for (const url of ['javascript:alert(1)', 'data:text/html,<script></script>', '//example.org/', 'https://name:secret@example.org/']) {
    assert.equal(agentHouseReportSchema.safeParse({ ...report, agents: [{ ...card, sources: [{ title: 'Kaynak', url }] }] }).success, false);
  }
  assert.equal(agentHouseReportSchema.safeParse({
    ...report, agents: [{ ...card, tables: [{ ...card.tables[0], rows: [['Matematik']] }] }],
  }).success, false);
  assert.equal(agentHouseReportSchema.safeParse({
    ...report, agents: [{ ...card, schedule: [{ ...card.schedule[0], end: '15:59' }] }],
  }).success, false);
});
