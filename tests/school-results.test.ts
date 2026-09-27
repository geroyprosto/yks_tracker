import assert from 'node:assert/strict';
import test from 'node:test';
import type {CourseExamResult, EducationCourse} from '../src/lib/education';
import {filterSchoolResults, matchSchoolCourses, parseSchoolNumber, parseSchoolTable, schoolDate, schoolResultSummary, suggestSchoolColumns, validateResultDrafts, type ResultDraft} from '../src/lib/school-results';

const draft: ResultDraft = {course_id: 'math', score: '72', scale: '100', exam_date: '2026-09-27', assessment_type: 'Vize', assessment_name: ''};
const allowed = new Set(['math']);
const course = (id: string, name: string, context: 'school' | 'yks' = 'school') => ({id, name, context}) as EducationCourse;
const result = (id: string, score: number, scale = 100, type = 'Vize', day = '2026-09-27'): CourseExamResult => ({id, course_id: 'math', term_id: 'fall', course_name: 'Matematik', score, scale, assessment_type: type, assessment_name: '', exam_date: day, revision: 1, created_at: id, updated_at: id});

test('blank is skipped, real zero and Turkish decimal comma are preserved', () => {
  const checked = validateResultDrafts([{...draft, score: ' '}, {...draft, score: '0'}, {...draft, score: '87,5'}, {...draft, score: '16', scale: '20'}], allowed);
  assert.deepEqual(checked.rows.map(row => [row.score, row.scale]), [[0, 100], [87.5, 100], [16, 20]]);
  assert.deepEqual(checked.issues, []);
  assert.equal(parseSchoolNumber('1,2,3'), null);
  assert.equal(parseSchoolNumber('1e2'), null);
});

test('validation reports row errors for ownership selection, score bounds, scale and impossible dates', () => {
  const checked = validateResultDrafts([{...draft, scale: '0'}, {...draft, score: '101'}, {...draft, exam_date: '2026-02-30'}, {...draft, course_id: 'foreign'}, {...draft, score: '-1'}], allowed);
  assert.equal(checked.rows.length, 0);
  assert.deepEqual(checked.issues.map(issue => issue.row), [0, 1, 2, 3, 4]);
  assert.equal(schoolDate('29.02.2024'), '2024-02-29');
  assert.equal(schoolDate('29.02.2026'), null);
});

test('local CSV/TSV parser respects quoted delimiters, escaped quotes, newlines and Turkish decimals', () => {
  assert.deepEqual(parseSchoolTable('Ders;Puan\r\nMatematik;87,5').rows, [['Ders', 'Puan'], ['Matematik', '87,5']]);
  assert.deepEqual(parseSchoolTable('"İktisat, giriş","87,5"\n"Bilişim ""A""",0').rows, [['İktisat, giriş', '87,5'], ['Bilişim "A"', '0']]);
  assert.deepEqual(parseSchoolTable('\uFEFFDers\tPuan\n"Çok\nsatırlı"\t16').rows, [['Ders', 'Puan'], ['Çok\nsatırlı', '16']]);
  assert.throws(() => parseSchoolTable('Ders,Puan\nMatematik,87,5'), /Ayraç|sütun/);
  assert.throws(() => parseSchoolTable('Matematik,87,5\nİktisat,72,5'), /ondalık/);
  assert.deepEqual(parseSchoolTable('Matematik,16,20', ',').rows, [['Matematik', '16', '20']]);
  assert.throws(() => parseSchoolTable('"Ders\t87,5', '\t'), /tırnağı/);
  assert.throws(() => parseSchoolTable('"Ders"x;87,5', ';'), /tırnaktan/);
});

test('column suggestions do not consume first data row; ambiguous matching never guesses a course', () => {
  assert.equal(suggestSchoolColumns([['Matematik', '87,5']]).header, false);
  assert.deepEqual(suggestSchoolColumns([['Puan', 'Ders', 'Ölçek', 'Tarih']]).columns, {course: 1, score: 0, scale: 2, date: 3, type: -1, name: -1});
  assert.deepEqual(matchSchoolCourses(' İKTİSAT  ', [course('a', 'İktisat'), course('b', 'İKTİSAT'), course('tyt', 'İktisat', 'yks')]).map(item => item.id), ['a', 'b']);
  assert.equal(matchSchoolCourses('BILISIM', [course('a', 'Bilişim')]).length, 0);
});

test('course/term/date/type filters preserve two real same-score exams and never invent missing components', () => {
  const records = [result('a', 60, 100, 'Vize', '2026-09-01'), result('b', 75, 100, 'Vize', '2026-09-10'), result('c', 75, 100, 'Final', '2026-09-11'), {...result('d', 99), course_id: 'economics'}];
  const filtered = filterSchoolResults(records, {course: 'math', term: 'fall', start: '2026-09-02', end: '', type: ''});
  assert.deepEqual(filtered.map(item => item.id), ['b', 'c']);
  assert.equal(schoolResultSummary(filtered, false).difference, null);
  assert.equal(schoolResultSummary(records.slice(0, 2), false).difference, 15);
  assert.equal(schoolResultSummary(records.slice(0, 1), false).difference, null);
  assert.equal(filterSchoolResults([result('a', 75), result('b', 75)], {course: 'math', term: '', start: '', end: '', type: ''}).length, 2);
});

test('original scales remain distinct; optional normalization labels percentage points, not learning gains', () => {
  const records = [result('a', 16, 20), result('b', 80, 100)];
  assert.equal(schoolResultSummary(records, false).mixedScale, true);
  assert.equal(schoolResultSummary(records, false).difference, null);
  assert.equal(schoolResultSummary(records, true).difference, 0);
  assert.equal(schoolResultSummary(records, true).differenceLabel, 'yüzde puan');
  assert.deepEqual(records.map(record => [record.score, record.scale]), [[16, 20], [80, 100]]);
});
