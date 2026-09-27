import assert from 'node:assert/strict';
import {test} from 'node:test';
import {emptyState, type AppState, type Task} from '../src/lib/domain/types';
import {defaultModules, emptyEducation, type EducationCourse} from '../src/lib/education';
import {filterStudyState, unassignedCourse} from '../src/lib/study-course-filter';
import {buildStudyReport} from '../src/lib/study-report';
import {buildStudyStatisticsSummary} from '../src/lib/study-statistics-summary';

const stamp = '2026-09-27T09:00:00.000Z';
function fixture(): AppState {
  const state = {...emptyState(true), authenticated: true, server_now: stamp};
  state.education = {...emptyEducation(), profile: {education_level: 'university', yks_goal: true, grade: null, department: '', university_year: '', yks_track: 'undecided', modules: defaultModules, active_term_id: 'fall', onboarding_completed_at: stamp, revision: 1},
    terms: ['fall', 'spring'].map(id => ({id, name: id === 'fall' ? 'Güz' : 'Bahar', academic_year: '2026–2027', starts_on: null, ends_on: null, archived: id === 'spring', revision: 1, created_at: stamp})),
    courses: [
      {id: 'math-fall', name: 'Matematik', context: 'school', term_id: 'fall', archived: false, exam: null},
      {id: 'math-spring', name: 'Matematik', context: 'school', term_id: 'spring', archived: true, exam: null},
      {id: 'tyt-math', name: 'Matematik', context: 'yks', term_id: null, archived: false, exam: 'TYT'},
    ] as EducationCourse[],
  };
  state.sessions = ['math-fall', 'math-spring', 'tyt-math', null].map((course_id, index) => ({id: `session-${index}`, course_id, subject: 'Matematik', title: `Oturum ${index}`, status: 'finished', started_at: '2026-09-26T09:00:00Z', finished_at: '2026-09-26T09:10:00Z', accumulated_seconds: 600, active_since: null, mode: 'stopwatch', target_seconds: null, study_type: 'Tekrar', task_id: null, topic_id: null, revision: 1}));
  state.intervals = state.sessions.map(session => ({id: `interval-${session.id}`, session_id: session.id, started_at: session.started_at, ended_at: session.finished_at}));
  state.tasks = state.sessions.map((session, index) => ({id: `task-${index}`, course_id: session.course_id, title: `Görev ${index}`, plan_date: '2026-09-26', progress: 1})) as Task[];
  state.manual_study_entries = state.sessions.map((session, index) => ({id: `manual-${index}`, course_id: session.course_id, study_date: '2026-09-26', subject: 'Matematik', duration_seconds: 300, created_at: stamp}));
  state.day_plans = [{id: 'plan', plan_date: '2026-09-26', version: 1, target_minutes: 120, task_share: .7, difficulty_factors: {easy: 1, medium: 1.25, hard: 1.5}, snapshot: state.tasks, changed_at: stamp}];
  state.day_marks = [{id: 'mark', mark_date: '2026-09-25', kind: 'rest', revision: 1, created_at: stamp, updated_at: stamp}];
  return state;
}

test('course IDs isolate identical school/YKS labels and preserve immutable duration and complete interval context', () => {
  const state = fixture(), before = structuredClone(state);
  const scoped = filterStudyState(state, {termId: '', courseId: 'math-fall'});
  assert.deepEqual(scoped.tasks.map(task => task.id), ['task-0']);
  assert.deepEqual(scoped.sessions.map(session => session.id), ['session-0']);
  assert.deepEqual(scoped.intervals.map(interval => interval.session_id), ['session-0']);
  assert.deepEqual(scoped.manual_study_entries!.map(entry => entry.id), ['manual-0']);
  assert.equal(buildStudyStatisticsSummary(scoped).totalSeconds, 900);
  assert.equal(buildStudyStatisticsSummary(scoped).completedTasks, 1);
  assert.deepEqual(state, before);
  assert.strictEqual(scoped.sessions[0], state.sessions[0]);
});

test('term scope retains archive records, omits unmatched legacy rather than guessing, and excludes whole-day goals/marks', () => {
  const state = fixture();
  const scoped = filterStudyState(state, {termId: 'spring', courseId: ''});
  assert.deepEqual(scoped.sessions.map(session => session.course_id), ['math-spring']);
  assert.equal(scoped.day_plans.length, 0);
  assert.equal(scoped.day_marks.length, 0);
  assert.equal(buildStudyReport(scoped, {start: '2026-09-26', end: '2026-09-26'}).days[0].targetMinutes, null);
  assert.equal(filterStudyState(state, {termId: 'fall', courseId: 'math-spring'}).sessions.length, 0);
  assert.deepEqual(filterStudyState(state, {termId: '', courseId: unassignedCourse}).sessions.map(session => session.id), ['session-3']);
});

test('all-record and existing YKS views keep original state and legacy unmatched data', () => {
  const state = fixture();
  assert.strictEqual(filterStudyState(state, {termId: '', courseId: ''}), state);
  const legacy = {...state, education: undefined};
  assert.strictEqual(filterStudyState(legacy, {termId: 'fall', courseId: 'math-fall'}), legacy);
});

test('all-course distributions keep separate persistent IDs across equal names and term labels', () => {
  const state = fixture();
  const report = buildStudyReport(state, {start: '2026-09-26', end: '2026-09-26'});
  assert.equal(report.subjects.length, 4);
  assert.deepEqual(report.subjects.map(facet => facet.seconds), [900, 900, 900, 900]);
  assert.ok(report.subjects.some(facet => facet.label === 'Matematik · 2026–2027 / Güz' && facet.key === 'course:math-fall'));
  assert.ok(report.subjects.some(facet => facet.label === 'Matematik · 2026–2027 / Bahar' && facet.key === 'course:math-spring'));
  assert.ok(report.subjects.some(facet => facet.label === 'TYT · Matematik' && facet.key === 'course:tyt-math'));
  assert.ok(report.subjects.some(facet => facet.label === 'Matematik' && !facet.key));
  assert.equal(report.totalSeconds, 3600);
});
