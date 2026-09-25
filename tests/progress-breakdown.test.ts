import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyState, type StudySession, type Task, type Topic } from '../src/lib/domain/types';
import { combinedSegments, studyDistribution } from '../src/lib/progress-breakdown';
import { combinedProgress } from '../src/lib/progress';

const now = Date.parse('2026-09-25T09:00:00Z');
function session(id: string, overrides: Partial<StudySession> = {}): StudySession {
  return { id, title: 'Sentetik hesaplama testi', task_id: null, topic_id: null, subject: 'Matematik', study_type: 'Tekrar', mode: 'stopwatch', target_seconds: null, status: 'finished', started_at: '2026-09-24T20:50:00Z', active_since: null, accumulated_seconds: 0, finished_at: '2026-09-25T08:00:00Z', revision: 1, ...overrides };
}
function task(id: string, exam: 'TYT' | 'AYT', subject: string): Task {
  return { id, title: 'Sentetik görev', plan_date: '2026-09-25', exam, subject, topic_id: null, resource: '', completion_criteria: '', planned_minutes: 60, difficulty: 'easy', progress: 0, weight_override: null, priority: 'normal', position: 0, notes: '', study_type: 'Tekrar', steps: [], revision: 1, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() };
}

test('halka bölümleri görev ve süre puanına gerçek katkıyı verir: 49 + 15 = 64', () => {
  const parts = combinedSegments(70, 50, .7);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].value, 49);
  assert.ok(Math.abs(parts[1].value - 15) < 1e-9);
  assert.equal(parts.reduce((total, part) => total + part.value, 0), 64);
});

test('eksik hedeflerin payı yeniden dağıtılır ve sıfır puan kaybolmaz', () => {
  for (const [tasks, time, share, expected] of [[null, 50, .7, 50], [70, null, .7, 70], [0, 50, 0, 50], [70, 0, 1, 70], [null, 0, .7, 0]] as const) {
    const parts = combinedSegments(tasks, time, share);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].value, expected);
  }
  assert.deepEqual(combinedSegments(null, null), []);
  assert.deepEqual(combinedSegments(70, null, 0), []);
  assert.deepEqual(combinedSegments(null, 50, 1), []);
  for (const invalidShare of [NaN, -.1, 1.1]) assert.deepEqual(combinedSegments(70, 50, invalidShare), []);
});

test('gösterilen katkılar aşılmış hedeflerde de birleşik puanla tutarlıdır', () => {
  for (const [tasks, time, share] of [[50, 150, .7], [100, 150, .7], [null, 150, .7], [-10, 50, .5], [NaN, 50, .7]] as const) {
    const total = combinedSegments(tasks, time, share).reduce((sum, part) => sum + part.value, 0);
    assert.ok(Math.abs(total - combinedProgress(tasks, time, share)!) < 1e-9);
    assert.ok(total >= 0 && total <= 100);
  }
});

test('ders dağılımı gece yarısını böler, molayı dışlar ve aynı ders kayıtlarını toplar', () => {
  const state = emptyState();
  state.tasks = [task('synthetic-task', 'TYT', 'Matematik')];
  const topic: Topic = { id: 'synthetic-topic', exam: 'TYT', subject: 'Matematik', name: 'Sentetik konu', parent_id: null, mastery: 1, notes: '', review_requested: false, source: '', next_step: '', revision: 1, updated_at: new Date(now).toISOString() };
  state.topics = [topic];
  state.sessions = [session('topic', { topic_id: topic.id }), session('task', { task_id: state.tasks[0].id }), session('other', { subject: 'Türkçe' })];
  state.intervals = [
    { id: 'midnight', session_id: 'topic', started_at: '2026-09-24T20:50:00Z', ended_at: '2026-09-24T21:10:00Z' },
    { id: 'after-pause', session_id: 'topic', started_at: '2026-09-24T21:30:00Z', ended_at: '2026-09-24T21:40:00Z' },
    { id: 'same-subject', session_id: 'task', started_at: '2026-09-25T07:00:00Z', ended_at: '2026-09-25T07:10:00Z' },
    { id: 'other-subject', session_id: 'other', started_at: '2026-09-25T07:30:00Z', ended_at: '2026-09-25T08:00:00Z' },
  ];
  const result = studyDistribution(state, '2026-09-25', 'Europe/Istanbul', now);
  assert.equal(result.total, 3600);
  assert.deepEqual(result.rows.map(({ label, seconds, value }) => ({ label, seconds, value })).sort((a, b) => a.label.localeCompare(b.label)), [
    { label: 'Türkçe', seconds: 1800, value: 50 }, { label: 'TYT Matematik', seconds: 1800, value: 50 },
  ].sort((a, b) => a.label.localeCompare(b.label)));
  const previous = studyDistribution(state, '2026-09-24', 'Europe/Istanbul', now);
  assert.equal(previous.total, 600);
  assert.equal(previous.rows[0].value, 100);
});

test('altı ders en büyük dört ders ve Diğer dersler olarak toplam yüzde 100 korunarak gösterilir', () => {
  const state = emptyState();
  const lengths = [60, 50, 40, 30, 20, 10];
  state.sessions = lengths.map((_, index) => session('synthetic-' + index, { subject: 'Sentetik ders ' + index }));
  state.intervals = lengths.map((minutes, index) => ({ id: 'interval-' + index, session_id: state.sessions[index].id, started_at: '2026-09-25T07:00:00Z', ended_at: new Date(Date.parse('2026-09-25T07:00:00Z') + minutes * 60_000).toISOString() }));
  const result = studyDistribution(state, '2026-09-25', 'Europe/Istanbul', now);
  assert.equal(result.total, 210 * 60);
  assert.deepEqual(result.rows.map(row => row.label), ['Sentetik ders 0', 'Sentetik ders 1', 'Sentetik ders 2', 'Sentetik ders 3', 'Diğer dersler']);
  assert.equal(result.rows[4].seconds, 30 * 60);
  assert.ok(Math.abs(result.rows.reduce((sum, row) => sum + row.value, 0) - 100) < 1e-9);
  assert.equal(new Set(result.rows.map(row => row.color)).size, 5);
});

test('boş, yalnız planlanmış veya başka gün çalışılmış veri sahte dağılım üretmez', () => {
  const state = emptyState();
  state.tasks = [task('synthetic-plan', 'AYT', 'Fizik')];
  state.sessions = [session('synthetic-previous')];
  state.intervals = [{ id: 'previous', session_id: 'synthetic-previous', started_at: '2026-09-24T07:00:00Z', ended_at: '2026-09-24T08:00:00Z' }];
  assert.deepEqual(studyDistribution(emptyState(), '2026-09-25', 'Europe/Istanbul', now), { total: 0, rows: [] });
  assert.deepEqual(studyDistribution(state, '2026-09-25', 'Europe/Istanbul', now), { total: 0, rows: [] });
});

