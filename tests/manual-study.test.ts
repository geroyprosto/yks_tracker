import assert from 'node:assert/strict';
import test from 'node:test';
import {commandSchema} from '../src/lib/domain/commands';
import {emptyState} from '../src/lib/domain/types';
import {buildStudyReport} from '../src/lib/study-report';
import {studyDistribution} from '../src/lib/progress-breakdown';
import {buildAnalysisSnapshot} from '../src/lib/analysis-snapshot';

const now = Date.parse('2026-09-25T12:00:00Z');

test('manual study command needs a confirmed date and bounded duration', () => {
  const command = {request_id: '11111111-1111-4111-8111-111111111111', type: 'manual_study.create',
    payload: {confirmed_by_user: true, study_date: '2026-09-25', subject: 'TYT Fizik', minutes: 50}};
  assert.equal(commandSchema.safeParse(command).success, true);
  assert.equal(commandSchema.safeParse({...command, payload: {...command.payload, user_id: 'someone-else'}}).success, false);
  assert.equal(commandSchema.safeParse({...command, payload: {...command.payload, confirmed_by_user: false}}).success, false);
  assert.equal(commandSchema.safeParse({...command, payload: {...command.payload, minutes: 1441}}).success, false);
});

test('reported date-only durations contribute exactly once alongside actual timer intervals', () => {
  const state = emptyState(true);
  state.server_now = new Date(now).toISOString();
  state.sessions = [{id: 'timer-1', title: 'AYT Matematik', task_id: null, topic_id: null,
    subject: 'AYT Matematik', study_type: 'Soru çözümü', mode: 'stopwatch', target_seconds: null,
    status: 'finished', started_at: '2026-09-25T09:00:00Z', active_since: null,
    accumulated_seconds: 1800, finished_at: '2026-09-25T09:30:00Z', revision: 1}];
  state.intervals = [{id: 'interval-1', session_id: 'timer-1',
    started_at: '2026-09-25T09:00:00Z', ended_at: '2026-09-25T09:30:00Z'}];
  state.manual_study_entries = [
    {id: 'manual-1', study_date: '2026-09-25', subject: 'TYT Fizik', duration_seconds: 3000,
      created_at: '2026-09-25T11:00:00Z'},
    {id: 'manual-2', study_date: '2026-09-24', subject: 'TYT Kimya', duration_seconds: 2400,
      created_at: '2026-09-25T11:01:00Z'},
  ];
  const report = buildStudyReport(state, {start: '2026-09-24', end: '2026-09-25'}, now);
  assert.equal(report.days[0].seconds, 2400);
  assert.equal(report.days[1].seconds, 4800);
  assert.equal(report.days[1].sessions, 2);
  assert.equal(report.totalSeconds, 7200);
  assert.deepEqual(report.subjects, [
    {label: 'TYT Fizik', seconds: 3000}, {label: 'TYT Kimya', seconds: 2400},
    {label: 'AYT Matematik', seconds: 1800},
  ]);
  assert.deepEqual(report.studyTypes, [
    {label: 'Tür belirtilmedi', seconds: 5400}, {label: 'Soru çözümü', seconds: 1800},
  ]);
  const distribution = studyDistribution(state, '2026-09-25', 'Europe/Istanbul', now);
  assert.equal(distribution.total, 4800);
  assert.deepEqual(distribution.rows.map(({label, seconds}) => ({label, seconds})), [
    {label: 'TYT Fizik', seconds: 3000}, {label: 'AYT Matematik', seconds: 1800},
  ]);
  const {snapshot} = buildAnalysisSnapshot(state, '2026-09-24', '2026-09-25', now);
  assert.equal(snapshot.summary.total_seconds, 7200);
  assert.deepEqual(snapshot.days.map(day => day.seconds), [2400, 4800]);
});
