import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationEventFacts } from '../src/lib/nova/conversation-facts';
import { buildBaseline, createDay, projectDay } from '../src/lib/nova/core';
import type { AppState } from '../src/lib/domain/types';

const state: AppState = { configured: true, authenticated: true, server_now: '2026-10-13T12:00:00Z', settings: null, tasks: [], topics: [], sessions: [], intervals: [], manual_study_entries: [], day_plans: [], topic_history: [], practice_entries: [], exam_formats: [], exams: [], journal_entries: [], day_marks: [] };

test('conversation facts remain concrete and never reveal active or future outcomes', () => {
  const baseline = buildBaseline(state, '2026-10-13', 'Europe/Istanbul');
  const day = createDay({ localDate: '2026-10-13', timezone: 'Europe/Istanbul', seed: 'conversation', baseline });
  const projection = projectDay(day, '2026-10-13T10:20:00Z');
  const facts = conversationEventFacts(projection, 'Bugün neler yaptın?');
  assert.ok(facts.length > 0 && facts.length <= 6);
  for (const fact of facts) assert.equal(projection.timeline.find(event => event.id === fact.id)?.status, 'completed');
  assert.ok(facts.some(fact => /dinlendim|yemeği|rutinimi/u.test(fact.text)));
  assert.ok(!facts.some(fact => /etkinliği tamamlandı/u.test(fact.text)));
  const checkin = conversationEventFacts(projection, 'Nasılsın?');
  assert.ok(checkin.length <= 1);
});
