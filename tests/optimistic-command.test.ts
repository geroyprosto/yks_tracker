import assert from 'node:assert/strict';
import test from 'node:test';
import {emptyState, type Task, type Topic} from '../src/lib/domain/types';
import {optimisticCommand} from '../src/lib/optimistic-command';

const now = '2026-10-03T12:00:00.000Z';
const requestId = '11111111-1111-4111-8111-111111111111';

function task(): Task {
  return {
    id: '22222222-2222-4222-8222-222222222222', title: 'Polinomlar', plan_date: '2026-10-03',
    exam: 'TYT', subject: 'Matematik', topic_id: null, resource: '', completion_criteria: '',
    planned_minutes: 40, difficulty: 'medium', progress: 0, weight_override: null, priority: 'normal',
    position: 0, notes: '', study_type: 'Soru çözümü', steps: [
      {id: 'a', title: 'İlk test', completed: false}, {id: 'b', title: 'İkinci test', completed: false},
    ], revision: 3, created_at: now, updated_at: now,
  };
}

test('task progress is projected before the server reply and can be rolled back from the untouched state', () => {
  const original = {...emptyState(true), authenticated: true, tasks: [task()]};
  const next = optimisticCommand(original, 'task.update', {
    id: original.tasks[0].id, expected_revision: 3,
    steps: original.tasks[0].steps.map(step => ({...step, completed: true})),
  }, requestId, now);
  assert.equal(next?.tasks[0].progress, 1);
  assert.equal(next?.tasks[0].revision, 4);
  assert.equal(original.tasks[0].progress, 0);
  assert.equal(original.tasks[0].steps[0].completed, false);
});

test('new tasks appear with a provisional identity and the right day before reconciliation', () => {
  const original = {...emptyState(true), authenticated: true, tasks: [task()]};
  const next = optimisticCommand(original, 'task.create', {
    title: 'Tekrar', plan_date: '2026-10-03', planned_minutes: 30,
  }, requestId, now);
  assert.equal(next?.tasks.length, 2);
  assert.equal(next?.tasks[1].id, requestId);
  assert.equal(next?.tasks[1].position, 1);
  assert.equal(original.tasks.length, 1);
});

test('topic mastery is projected without changing the previous topic', () => {
  const topic: Topic = {id: requestId, exam: 'TYT', subject: 'Matematik', name: 'Problemler',
    parent_id: null, mastery: 1, notes: '', review_requested: false, source: '', next_step: '', revision: 2, updated_at: now};
  const original = {...emptyState(true), topics: [topic]};
  const next = optimisticCommand(original, 'topic.update', {id: topic.id, expected_revision: 2, mastery: 4}, requestId, now);
  assert.equal(next?.topics[0].mastery, 4);
  assert.equal(original.topics[0].mastery, 1);
});

test('moving a task changes the visible order while retaining a rollback snapshot', () => {
  const first = task();
  const second = {...task(), id: '33333333-3333-4333-8333-333333333333', title: 'Geometri', position: 1};
  const original = {...emptyState(true), tasks: [first, second]};
  const next = optimisticCommand(original, 'task.move', {id: second.id, expected_revision: 3, direction: 'up'}, requestId, now);
  assert.deepEqual(next?.tasks.map(item => [item.title, item.position]), [['Polinomlar', 1], ['Geometri', 0]]);
  assert.equal(original.tasks[0].position, 0);
});

test('a reported practice entry appears in the day totals before the receipt arrives', () => {
  const original = {...emptyState(true), practice_entries: []};
  const next = optimisticCommand(original, 'practice.create', {
    practice_date: '2026-10-03', course_id: null, question_count: 28, test_count: 2,
  }, requestId, now);
  assert.deepEqual(next?.practice_entries.map(entry => [entry.practice_date, entry.question_count, entry.test_count]),
    [['2026-10-03', 28, 2]]);
  assert.equal(original.practice_entries.length, 0);
});

test('marking a rest day replaces its previous mark immediately', () => {
  const original = {...emptyState(true), day_marks: [{id: requestId, mark_date: '2026-10-02', kind: 'zero' as const,
    revision: 2, created_at: now, updated_at: now}]};
  const next = optimisticCommand(original, 'day.mark', {mark_date: '2026-10-02', kind: 'rest'}, requestId, now);
  assert.equal(next?.day_marks[0].kind, 'rest');
  assert.equal(next?.day_marks[0].revision, 3);
  assert.equal(original.day_marks[0].kind, 'zero');
});

test('a new exam is visible with calculated net while the server confirms it', () => {
  const original = {...emptyState(true), exam_formats: [{code: 'TYT' as const, version: 1, label: 'TYT',
    total_questions: 10, wrong_divisor: 4, sections: [{key: 'mat', label: 'Matematik', question_count: 10}]}]};
  const next = optimisticCommand(original, 'exam.create', {name: 'Deneme', exam_date: '2026-10-03',
    format_code: 'TYT', format_version: 1, results: [{section_key: 'mat', correct: 7, wrong: 2}]}, requestId, now);
  assert.equal(next?.exams[0].total_net, 6.5);
  assert.equal(next?.exams[0].results[0].blank, 1);
  assert.equal(original.exams.length, 0);
});

test('an explicit unanswered count stays visible during exam reconciliation', () => {
  const original = {...emptyState(true), exam_formats: [{code: 'TYT' as const, version: 1, label: 'TYT',
    total_questions: 10, wrong_divisor: 4, sections: [{key: 'mat', label: 'Matematik', question_count: 10}]}]};
  const next = optimisticCommand(original, 'exam.create', {name: 'Deneme', exam_date: '2026-10-03',
    format_code: 'TYT', results: [{section_key: 'mat', correct: 5, wrong: 2, blank: 1}]}, requestId, now);
  assert.equal(next?.exams[0].results[0].blank, 1);
  assert.equal(next?.exams[0].results[0].net, 4.5);
});

test('a new journal appears immediately and an edit keeps its server identity', () => {
  const original = {...emptyState(true)};
  const created = optimisticCommand(original, 'journal.create', {
    journal_date: '2026-10-03', original_text: 'Bugün tekrar yaptım', structured_fields: {energy: 4},
  }, requestId, now);
  assert.equal(created?.journal_entries[0].id, requestId);
  assert.equal(created?.journal_entries[0].structured_fields.energy, 4);
  assert.equal(original.journal_entries.length, 0);
  const updated = optimisticCommand(created!, 'journal.update', {id: requestId, expected_revision: 1,
    original_text: 'Bugün çok tekrar yaptım'}, requestId, now);
  assert.equal(updated?.journal_entries[0].original_text, 'Bugün çok tekrar yaptım');
  assert.equal(updated?.journal_entries[0].revision, 2);
});

test('a journal analysis switch stays on during background reconciliation', () => {
  const original = {...emptyState(true), settings: {display_name: 'Ada', exam_year: 2027, exam_date: null,
    target_rank: null, timezone: 'Europe/Istanbul', daily_target_minutes: 360, task_share: .7,
    difficulty_factors: {easy: 1, medium: 1.25, hard: 1.5}, weekday_targets: [360, 360, 360, 360, 360, 360, 360],
    theme: 'ocean' as const, appearance: 'dark' as const, reduced_motion: false, simple_view: false,
    journal_analysis_enabled: false, revision: 2}};
  const next = optimisticCommand(original, 'settings.journal_analysis.set',
    {expected_revision: 2, enabled: true}, requestId, now);
  assert.equal(next?.settings?.journal_analysis_enabled, true);
  assert.equal(next?.settings?.revision, 3);
  assert.equal(original.settings.journal_analysis_enabled, false);
});
