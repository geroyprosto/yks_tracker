import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assemble, assertFresh, childEnvironment, inputHash, promptFor, roles, sourcesFor, validateResult, weekStart, type Input, type RoleResult, type Source} from '../scripts/agent-house-codex/core';
import {mergeMemory} from '../scripts/agent-house-codex/memory';
import {agentHouseAgentIds} from '../src/lib/agent-house';

const source: Source = {id: 'yksim:analysis', kind: 'yksim', title: 'Kayıtlar', updated_at: '2026-11-14', fetched_at: '2026-11-14T12:00:00Z', privacy: 'study', audience: [...agentHouseAgentIds], coverage: 'Sentetik test kaydı', content: '{"seconds":600}'};
const input: Input = {version: 1, as_of: '2026-11-14', captured_at: source.fetched_at, coverage: ['Test'], sources: [source, {...source, id: 'yksim:tasks'}, {...source, id: 'yksim:exams'}]};
const result: RoleResult = {status: 'ready', summary: 'Bir küçük adım.', recommendations: ['Defterini aç.'], source_ids: [source.id], tables: []};

test('only changed evidence, policy, or local day causes a new report', () => {
  assert.equal(inputHash(input), inputHash({...input, captured_at: '2026-11-14T13:00:00Z', sources: [...input.sources].reverse().map(s => ({...s, fetched_at: '2026-11-14T13:00:00Z'}))}));
  assert.notEqual(inputHash(input), inputHash({...input, sources: [{...source, content: '{"seconds":1200}'}]}));
  assert.notEqual(inputHash(input), inputHash({...input, as_of: '2026-11-15'}));
});

test('private chat and journal content is confined to awareness and excluded from colleague context', () => {
  const privateSource: Source = {...source, id: 'chatgpt:private', kind: 'chatgpt', privacy: 'private', content: 'PRIVATE_CANARY'};
  const withPrivate = {...input, sources: [...input.sources, privateSource]};
  assert(sourcesFor(withPrivate, 'awareness').some(s => s.id === privateSource.id));
  for (const role of agentHouseAgentIds.filter(id => id !== 'awareness')) {
    assert(!promptFor(withPrivate, role, {awareness: {...result, summary: 'PRIVATE_CANARY'}}).includes('PRIVATE_CANARY'));
  }
});

test('Codex children receive no model API or database keys', () => {
  const env = childEnvironment({NODE_ENV: 'test', Path: 'bin', USERPROFILE: 'profile', OPENAI_API_KEY: 'secret', SUPABASE_SECRET_KEY: 'secret', ANTHROPIC_API_KEY: 'secret', CUSTOM_ACCESS_TOKEN: 'secret'});
  assert.equal(env.Path, 'bin');
  assert.equal(env.USERPROFILE, 'profile');
  assert(!JSON.stringify(env).includes('secret'));
  assert.equal(roles.leader.model, 'gpt-6-astra');
  assert.equal(roles.tracking.model, 'gpt-6-luna');
});

test('a missing or stale live source cannot be published as current', () => {
  assert.doesNotThrow(() => assertFresh(input, new Date('2026-11-14T13:00:00Z')));
  assert.throws(() => assertFresh({...input, sources: [source]}, new Date('2026-11-14T13:00:00Z')), /kaynak eksik/);
  assert.throws(() => assertFresh(input, new Date('2026-11-14T18:00:00Z')), /eski/);
  assert.throws(() => assertFresh(input, new Date('2026-11-15T01:00:00Z')), /bugün değil/);
});

test('unknown sources, unsupported output and malformed plan rows are rejected', () => {
  assert.throws(() => validateResult({...result, source_ids: ['invented']}, 'leader', [source]), /Bilinmeyen/);
  assert.throws(() => validateResult({...result, source_ids: []}, 'leader', [source]), /Dayanak/);
  assert.throws(() => validateResult({...result, tables: [{title: 'Plan', columns: ['A', 'B'], rows: [['one']]}]}, 'daily', [source]), /sütun/);
  assert.throws(() => validateResult({...result, secret: 'no'}, 'leader', [source]));
});

test('memory preserves reviewed old chats, refreshes corrected turns and supports removal', () => {
  const chat: Source = {...source, id: 'chatgpt:one', kind: 'chatgpt', privacy: 'private', content: JSON.stringify([{id: 'a', text: 'old'}, {id: 'b', text: 'before'}])};
  const old = {...input, sources: [...input.sources, chat]};
  const incoming = {...input, sources: [{...chat, content: JSON.stringify([{id: 'b', text: 'corrected'}, {id: 'c', text: 'new'}])}]};
  const merged = mergeMemory(old, incoming);
  assert.deepEqual(JSON.parse(merged.sources.find(s => s.id === chat.id)!.content), [{id: 'a', text: 'old'}, {id: 'b', text: 'corrected'}, {id: 'c', text: 'new'}]);
  assert.equal(merged.sources.length, 4);
  assert(!mergeMemory(old, incoming, [chat.id]).sources.some(s => s.id === chat.id));
});

test('six completed role outputs form one immutable report without raw private input', () => {
  const results = Object.fromEntries(agentHouseAgentIds.map(id => [id, result])) as Record<typeof agentHouseAgentIds[number], RoleResult>;
  const report = assemble(input, results, inputHash(input), '2026-11-14T13:00:00Z');
  assert.equal(report.agents.length, 6);
  assert.equal(report.mode, 'live');
  assert.equal(report.week_start, '2026-11-09');
  assert.equal(weekStart('2026-11-16'), '2026-11-16');
  assert(!JSON.stringify(report).includes('seconds'));
});
