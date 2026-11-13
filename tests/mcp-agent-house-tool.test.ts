import assert from 'node:assert/strict';
import test from 'node:test';
import {createMcpHandler, McpServer} from '@modelcontextprotocol/server';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {AgentHouseReport} from '../src/lib/agent-house';
import {registerAgentHouseTool} from '../src/lib/server/mcp-agent-house-tool';

const ownerId = '22222222-2222-4222-8222-222222222222';
const report: AgentHouseReport = {
  schema_version: 1, run_id: 'run-example-1', mode: 'sample',
  generated_at: '2026-11-13T20:00:00+03:00', week_start: '2026-11-16', title: 'Örnek haftalık plan',
  agents: [{
    id: 'leader', status: 'ready', summary: 'Örnek çalışma özeti', recommendations: ['İlk soruyu önceden seç.'],
    sources: [], tables: [], schedule: [],
  }],
};

type Rpc = (name: string, parameters: Record<string, unknown>) => Promise<unknown>;

async function publish(input: unknown, rpc: Rpc) {
  const client = {rpc} as unknown as SupabaseClient;
  const handler = createMcpHandler(() => {
    const server = new McpServer({name: 'agent-house-test', version: '0.1.0'});
    registerAgentHouseTool(server, client, ownerId);
    return server;
  }, {responseMode: 'json'});
  const response = await handler.fetch(new Request('https://study.example.com/api/mcp', {
    method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: {name: 'publish_agent_house_report', arguments: input}}),
  }));
  assert.equal(response.status, 200);
  const raw = await response.text();
  const payload = raw.startsWith('event:') ? raw.split(/\r?\n/).find(line => line.startsWith('data: '))?.slice(6) : raw;
  assert.ok(payload);
  return JSON.parse(payload);
}

test('agent-house MCP publication binds the verified owner and returns a compact replay receipt', async () => {
  const receipts: unknown[] = [];
  let calls = 0;
  const rpc: Rpc = async (name, parameters) => {
    assert.equal(name, 'agent_house_publish_for_owner');
    assert.deepEqual(parameters, {p_user_id: ownerId, p_report: report});
    return {data: {run: report, created: calls++ === 0}, error: null};
  };
  for (let index = 0; index < 2; index++) {
    const payload = await publish(report, rpc);
    assert.notEqual(payload.result.isError, true);
    receipts.push(JSON.parse(payload.result.content[0].text));
    assert.doesNotMatch(JSON.stringify(payload), /Örnek çalışma özeti|22222222/);
  }
  assert.equal(calls, 2);
  assert.deepEqual(receipts, [
    {run_id: report.run_id, mode: 'sample', created: true, status: 'saved'},
    {run_id: report.run_id, mode: 'sample', created: false, status: 'saved'},
  ]);
});

test('agent-house MCP rejects foreign owner fields and invalid report fields without a write', async () => {
  let calls = 0;
  const rpc: Rpc = async () => {
    calls++;
    return {data: null, error: null};
  };
  for (const input of [
    {...report, user_id: '33333333-3333-4333-8333-333333333333'},
    {...report, mode: 'invalid'},
    {...report, agents: [{...report.agents[0], sources: [{title: 'Private', url: 'file:///private.txt'}]}]},
  ]) {
    const payload = await publish(input, rpc);
    assert.ok(payload.error || payload.result?.isError === true);
  }
  assert.equal(calls, 0);
});

test('agent-house MCP keeps unexpected errors private and preserves safe permission errors', async () => {
  const unexpected = await publish(report, async () => {throw new Error('PRIVATE_DB_DETAIL token=synthetic-secret');});
  assert.equal(unexpected.result.isError, true);
  assert.equal(unexpected.result.content[0].text, 'Ajan Evi raporu kaydedilemedi.');
  assert.doesNotMatch(JSON.stringify(unexpected), /PRIVATE_DB_DETAIL|synthetic-secret/);

  const denied = await publish(report, async () => ({data: null, error: {code: '42501', message: 'PRIVATE_DB_DENIAL'}}));
  assert.equal(denied.result.isError, true);
  assert.equal(denied.result.content[0].text, 'Bu raporu kaydetme yetkiniz bulunmuyor.');
  assert.doesNotMatch(JSON.stringify(denied), /PRIVATE_DB_DENIAL/);
});
