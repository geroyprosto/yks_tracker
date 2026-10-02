import assert from 'node:assert/strict';
import {test} from 'node:test';
import {defaultSetup, emptyEducation, type EducationState} from '../src/lib/education';
import {optimisticEducationCommand} from '../src/lib/optimistic-education';

const now = '2026-10-03T10:00:00.000Z';
const provisionalId = '00000000-0000-4000-8000-000000000021';
const termId = '00000000-0000-4000-8000-000000000022';
const otherTermId = '00000000-0000-4000-8000-000000000023';
const courseId = '00000000-0000-4000-8000-000000000024';
const resultId = '00000000-0000-4000-8000-000000000025';
const explicitCourseId = '00000000-0000-4000-8000-000000000026';

function education(): EducationState {
  return {...emptyEducation(), can_commit: true,
    profile: {...defaultSetup().profile, active_term_id: termId, onboarding_completed_at: now, revision: 3},
    terms: [
      {id: termId, academic_year: '2026-2027', name: 'Güz', starts_on: null, ends_on: null, archived: false, revision: 1, created_at: now},
      {id: otherTermId, academic_year: '2025-2026', name: 'Bahar', starts_on: null, ends_on: null, archived: true, revision: 1, created_at: now},
    ],
    courses: [{id: courseId, term_id: termId, name: 'Matematik', normalized_name: 'matematik', context: 'school', exam: null,
      catalog_subject: null, archived: false, revision: 2, created_at: now, updated_at: now}],
    results: [{id: resultId, course_id: courseId, term_id: termId, course_name: 'Matematik', exam_date: '2026-10-02',
      assessment_type: 'Yazılı', assessment_name: '', score: 80, scale: 100, revision: 1, created_at: now, updated_at: now}],
  };
}

test('result update appears immediately without changing the previous state', () => {
  const previous = education();
  const next = optimisticEducationCommand(previous, 'result.update',
    {id: resultId, expected_revision: 1, score: 90, assessment_name: '  Birinci yazılı  '}, provisionalId, now);

  assert.ok(next);
  assert.equal(next.results[0].score, 90);
  assert.equal(next.results[0].assessment_name, 'Birinci yazılı');
  assert.equal(next.results[0].revision, 2);
  assert.equal(next.results[0].course_name, 'Matematik');
  assert.equal(previous.results[0].score, 80);
  assert.notEqual(next.results, previous.results);
});

test('batch results preview every new row with its school course snapshot', () => {
  const previous = education();
  const next = optimisticEducationCommand(previous, 'results.batch', {rows: [
    {course_id: courseId, exam_date: '2026-10-01', assessment_type: 'Yazılı', score: 70, scale: 100},
    {course_id: courseId, exam_date: '2026-10-03', assessment_type: '  Final  ', assessment_name: '  Dönem sonu  ', score: 85, scale: 100},
  ]}, provisionalId, now);

  assert.ok(next);
  assert.equal(next.results.length, 3);
  assert.equal(new Set(next.results.map(row => row.id)).size, 3);
  assert.ok(next.results.slice(1).every(row => /^[a-f0-9-]{36}$/.test(row.id)));
  assert.deepEqual(next.results.slice(1).map(row => [row.course_name, row.term_id, row.assessment_type, row.assessment_name, row.revision]), [
    ['Matematik', termId, 'Yazılı', '', 1], ['Matematik', termId, 'Final', 'Dönem sonu', 1],
  ]);
  assert.equal(previous.results.length, 1);
});

test('course edits update the normalized label while preserving the catalog identity', () => {
  const previous = education();
  const next = optimisticEducationCommand(previous, 'course.update',
    {id: courseId, expected_revision: 2, name: '  İleri Matematik  ', archived: true}, provisionalId, now);

  assert.ok(next);
  assert.equal(next.courses[0].name, 'İleri Matematik');
  assert.equal(next.courses[0].normalized_name, 'ileri matematik');
  assert.equal(next.courses[0].catalog_subject, null);
  assert.equal(next.courses[0].archived, true);
  assert.equal(next.courses[0].revision, 3);
  assert.equal(previous.courses[0].name, 'Matematik');
  assert.equal(previous.results[0].course_name, 'Matematik');
});

test('new courses use explicit or provisional IDs and SQL defaults', () => {
  const previous = education();
  const school = optimisticEducationCommand(previous, 'course.create',
    {name: ' Fizik ', context: 'school', term_id: termId}, provisionalId, now);
  const yks = optimisticEducationCommand(previous, 'course.create',
    {id: explicitCourseId, name: ' Kimya ', context: 'yks', exam: 'AYT', term_id: null}, provisionalId, now);

  assert.ok(school);
  assert.ok(yks);
  assert.deepEqual(school.courses.at(-1), {id: provisionalId, term_id: termId, name: 'Fizik', normalized_name: 'fizik',
    context: 'school', exam: null, catalog_subject: null, archived: false, revision: 1, created_at: now, updated_at: now});
  assert.equal(yks.courses.at(-1)?.catalog_subject, 'Kimya');
  assert.equal(yks.courses.at(-1)?.id, explicitCourseId);
  assert.equal(previous.courses.length, 1);
});

test('term activation and draft saving preview revisions without mutating old records', () => {
  const previous = education();
  const activated = optimisticEducationCommand(previous, 'term.activate', {id: otherTermId}, provisionalId, now);
  const draftData = defaultSetup(previous);
  const drafted = optimisticEducationCommand(previous, 'draft.save',
    {expected_revision: 0, step: 2, data: draftData}, provisionalId, now);

  assert.ok(activated);
  assert.ok(drafted);
  assert.equal(activated.profile?.active_term_id, otherTermId);
  assert.equal(activated.profile?.revision, 4);
  assert.deepEqual(activated.terms.map(term => term.archived), [true, false]);
  assert.equal(drafted.draft?.revision, 1);
  assert.equal(drafted.draft?.step, 2);
  assert.equal(previous.draft, null);
  assert.equal(previous.profile?.active_term_id, termId);
});

test('complex profile saves and stale revisions stay on the authoritative path', () => {
  const previous = education();
  assert.equal(optimisticEducationCommand(previous, 'profile.save', {expected_revision: 3, ...defaultSetup(previous)}, provisionalId, now), null);
  assert.equal(optimisticEducationCommand(previous, 'result.update', {id: resultId, expected_revision: 8, score: 90}, provisionalId, now), null);
});

test('draft discard clears only the matching saved revision', () => {
  const prior = education();
  const state: EducationState = {...prior, draft: {step: 1, data: defaultSetup(prior), revision: 2, updated_at: now}};

  assert.equal(optimisticEducationCommand(state, 'draft.discard', {expected_revision: 1}, provisionalId, now), null);
  const cleared = optimisticEducationCommand(state, 'draft.discard', {expected_revision: 2}, provisionalId, now);
  assert.ok(cleared);
  assert.equal(cleared.draft, null);
  assert.equal(state.draft?.revision, 2);
});
