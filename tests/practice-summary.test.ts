import assert from 'node:assert/strict';
import test from 'node:test';
import type { PracticeEntry } from '../src/lib/domain/types';
import { dailyPracticeTrend, practicePeriod, practiceTrend, summarizePractice } from '../src/lib/practice-summary';

function entry(id: string, practice_date: string, exam: 'TYT' | 'AYT', subject: string, question_count: number, test_count: number): PracticeEntry {
  return { id, practice_date, exam, subject, question_count, test_count, revision: 1, created_at: practice_date + 'T10:00:00.000Z', updated_at: practice_date + 'T10:00:00.000Z' };
}

const entries = [
  entry('aug', '2026-08-31', 'TYT', 'Matematik', 30, 1),
  entry('sun-before', '2026-09-20', 'AYT', 'Biyoloji', 20, 1),
  entry('monday', '2026-09-21', 'TYT', 'Matematik', 40, 2),
  entry('thursday-a', '2026-09-24', 'TYT', 'Matematik', 45, 3),
  entry('thursday-b', '2026-09-24', 'AYT', 'Biyoloji', 25, 1),
  entry('sunday', '2026-09-27', 'TYT', 'Türkçe', 10, 1),
  entry('next-monday', '2026-09-28', 'AYT', 'Fizik', 10, 1),
  entry('oct', '2026-10-01', 'TYT', 'Türkçe', 5, 1),
];

test('hafta pazartesi başlar ve pazar biter; önceki pazar ile sonraki pazartesi dışarıda kalır', () => {
  const range = practicePeriod('2026-09-24', 'week');
  assert.equal(range.start, '2026-09-21');
  assert.equal(range.end, '2026-09-27');
  assert.equal(range.previousAnchor, '2026-09-17');
  assert.equal(range.nextAnchor, '2026-10-01');
  const summary = summarizePractice(entries, '2026-09-24', 'week');
  assert.equal(summary.totalQuestions, 120);
  assert.equal(summary.totalTests, 7);
  assert.equal(summary.activeDays, 3);
  assert.equal(summary.entryCount, 4);
  assert.deepEqual(summary.subjectRows.map(row => [row.exam, row.subject, row.questionCount, row.testCount]), [
    ['TYT', 'Matematik', 85, 5], ['AYT', 'Biyoloji', 25, 1], ['TYT', 'Türkçe', 10, 1],
  ]);
});

test('günlük ve aylık görünüm aynı kayıtları tekrarsız sayar', () => {
  const day = summarizePractice(entries, '2026-09-24', 'day');
  assert.equal(day.totalQuestions, 70);
  assert.equal(day.totalTests, 4);
  assert.equal(day.activeDays, 1);
  assert.deepEqual(day.examRows.map(row => [row.exam, row.questionCount, row.testCount]), [['TYT', 45, 3], ['AYT', 25, 1]]);
  const month = summarizePractice(entries, '2026-09-24', 'month');
  assert.equal(month.start, '2026-09-01');
  assert.equal(month.end, '2026-09-30');
  assert.equal(month.totalQuestions, 150);
  assert.equal(month.totalTests, 9);
  assert.equal(month.activeDays, 5);
});

test('gün eğilimi yedi günü, hafta eğilimi yedi günü, ay eğilimi ayın tüm günlerini gösterir', () => {
  const day = dailyPracticeTrend(entries, '2026-09-24', 'day');
  assert.equal(day.length, 7);
  assert.equal(day[0].date, '2026-09-18');
  assert.deepEqual(day.at(-1), { date: '2026-09-24', questionCount: 70, testCount: 4 });
  const week = dailyPracticeTrend(entries, '2026-09-24', 'week');
  assert.equal(week.length, 7);
  assert.equal(week[0].date, '2026-09-21');
  assert.equal(week.at(-1)?.date, '2026-09-27');
  const month = dailyPracticeTrend(entries, '2026-09-24', 'month');
  assert.equal(month.length, 30);
  assert.equal(month[0].date, '2026-09-01');
  assert.equal(month.at(-1)?.date, '2026-09-30');
  assert.equal(month.reduce((sum, row) => sum + row.questionCount, 0), 150);
});

test('ay değiştirme ve artık yıl sınırları doğru hesaplanır', () => {
  const range = practicePeriod('2028-02-29', 'month');
  assert.equal(range.start, '2028-02-01');
  assert.equal(range.end, '2028-02-29');
  assert.equal(range.previousAnchor, '2028-01-01');
  assert.equal(range.nextAnchor, '2028-03-01');
  assert.equal(dailyPracticeTrend([], '2028-02-29', 'month').length, 29);
});

test('aylık eğilim takvim haftalarını ay sınırında kırpar', () => {
  const weeks = practiceTrend(entries, '2026-09-24', 'month');
  assert.deepEqual(weeks.map(row => [row.date, row.end, row.questionCount, row.testCount]), [
    ['2026-09-01', '2026-09-06', 0, 0],
    ['2026-09-07', '2026-09-13', 0, 0],
    ['2026-09-14', '2026-09-20', 20, 1],
    ['2026-09-21', '2026-09-27', 120, 7],
    ['2026-09-28', '2026-09-30', 10, 1],
  ]);
});

test('ders kimlikleri ayrı kalır; derssiz soru ve test kayıtları birlikte özetlenir', () => {
  const rows = [
    { ...entry('course-a', '2026-09-24', 'TYT', 'Matematik', 20, 0), course_id: 'course-a' },
    { ...entry('course-b', '2026-09-24', 'TYT', 'Matematik', 0, 2), course_id: 'course-b' },
    { ...entry('unassigned', '2026-09-24', 'TYT', 'Matematik', 0, 3), course_id: null, exam: null, subject: null },
  ] as PracticeEntry[];
  const summary = summarizePractice(rows, '2026-09-24', 'day');
  assert.equal(summary.totalQuestions, 20);
  assert.equal(summary.totalTests, 5);
  assert.deepEqual(summary.subjectRows.map(row => [row.subject, row.questionCount, row.testCount]), [
    ['Matematik', 20, 0], ['Ders seçilmedi', 0, 3], ['Matematik', 0, 2],
  ]);
  assert.equal(new Set(summary.subjectRows.map(row => row.key)).size, 3);
  assert.deepEqual(summary.examRows.map(row => [row.exam, row.questionCount, row.testCount]), [
    ['TYT', 20, 2], ['AYT', 0, 0], ['Diğer', 0, 3],
  ]);
});
