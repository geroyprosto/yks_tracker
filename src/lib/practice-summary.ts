import type { PracticeEntry } from './domain/types';

export type PracticePeriod = 'day' | 'week' | 'month';
export type PracticeCount = { questionCount: number; testCount: number };
export type PracticeExamRow = PracticeCount & { exam: 'TYT' | 'AYT' | 'Diğer' };
export type PracticeSubjectRow = PracticeCount & { key: string; exam: 'TYT' | 'AYT' | null; subject: string };
export type PracticeDayRow = PracticeCount & { date: string };
export type PracticeTrendRow = PracticeCount & { date: string; end: string; label: string };

function utcDay(day: string) {
  return new Date(day + 'T12:00:00.000Z');
}

function dayString(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function shiftPracticeDay(day: string, days: number) {
  const date = utcDay(day);
  date.setUTCDate(date.getUTCDate() + days);
  return dayString(date);
}

function monthAnchor(day: string, offset: number) {
  const date = utcDay(day);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return dayString(date);
}

const dayLabel = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthLabel = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortLabel = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function practicePeriod(anchor: string, period: PracticePeriod) {
  if (period === 'day') {
    return { start: anchor, end: anchor, label: dayLabel.format(utcDay(anchor)), previousAnchor: shiftPracticeDay(anchor, -1), nextAnchor: shiftPracticeDay(anchor, 1) };
  }
  if (period === 'week') {
    const weekday = (utcDay(anchor).getUTCDay() + 6) % 7;
    const start = shiftPracticeDay(anchor, -weekday);
    const end = shiftPracticeDay(start, 6);
    const label = shortLabel.format(utcDay(start)) + ' – ' + dayLabel.format(utcDay(end));
    return { start, end, label, previousAnchor: shiftPracticeDay(anchor, -7), nextAnchor: shiftPracticeDay(anchor, 7) };
  }
  const start = monthAnchor(anchor, 0);
  const end = shiftPracticeDay(monthAnchor(anchor, 1), -1);
  return { start, end, label: monthLabel.format(utcDay(start)), previousAnchor: monthAnchor(anchor, -1), nextAnchor: monthAnchor(anchor, 1) };
}

function cleanCount(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function subjectName(subject: string | null) {
  return subject?.trim() || 'Ders seçilmedi';
}

export function practiceCourseKey(entry: PracticeEntry) {
  return entry.course_id ? `course:${entry.course_id}` : entry.subject?.trim()
    ? `legacy:${entry.exam ?? ''}:${entry.subject.trim().toLocaleLowerCase('tr-TR')}` : 'unassigned';
}

export function practiceCourseLabel(entry: PracticeEntry) {
  const subject = subjectName(entry.subject);
  return entry.exam ? `${entry.exam} · ${subject}` : subject;
}

export function summarizePractice(entries: readonly PracticeEntry[], anchor: string, period: PracticePeriod) {
  const range = practicePeriod(anchor, period);
  const records = entries.filter(entry => entry.practice_date >= range.start && entry.practice_date <= range.end)
    .sort((a, b) => b.practice_date.localeCompare(a.practice_date) || b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
  const examRows: PracticeExamRow[] = [
    { exam: 'TYT', questionCount: 0, testCount: 0 },
    { exam: 'AYT', questionCount: 0, testCount: 0 },
  ];
  const subjects = new Map<string, PracticeSubjectRow>();
  const activeDates = new Set<string>();
  let totalQuestions = 0;
  let totalTests = 0;
  for (const entry of records) {
    const questions = cleanCount(entry.question_count);
    const tests = cleanCount(entry.test_count);
    totalQuestions += questions;
    totalTests += tests;
    activeDates.add(entry.practice_date);
    const examRow = examRows.find(row => row.exam === entry.exam);
    if (examRow) {
      examRow.questionCount += questions;
      examRow.testCount += tests;
    }
    const subject = subjectName(entry.subject);
    const key = practiceCourseKey(entry);
    const row = subjects.get(key) ?? { key, exam: entry.exam, subject, questionCount: 0, testCount: 0 };
    row.questionCount += questions;
    row.testCount += tests;
    subjects.set(key, row);
  }
  const otherQuestions = totalQuestions - examRows.reduce((sum, row) => sum + row.questionCount, 0);
  const otherTests = totalTests - examRows.reduce((sum, row) => sum + row.testCount, 0);
  if (otherQuestions || otherTests) examRows.push({ exam: 'Diğer', questionCount: otherQuestions, testCount: otherTests });
  const subjectRows = [...subjects.values()].sort((a, b) => b.questionCount - a.questionCount || b.testCount - a.testCount || a.subject.localeCompare(b.subject, 'tr-TR'));
  return { ...range, totalQuestions, totalTests, activeDays: activeDates.size, entryCount: records.length, examRows, subjectRows, records };
}

export function dailyPracticeTrend(entries: readonly PracticeEntry[], anchor: string, period: PracticePeriod): PracticeDayRow[] {
  const range = practicePeriod(anchor, period);
  const start = period === 'day' ? shiftPracticeDay(anchor, -6) : range.start;
  const days: PracticeDayRow[] = [];
  const byDay = new Map<string, PracticeDayRow>();
  for (let day = start; day <= range.end; day = shiftPracticeDay(day, 1)) {
    const row = { date: day, questionCount: 0, testCount: 0 };
    days.push(row);
    byDay.set(day, row);
  }
  for (const entry of entries) {
    const row = byDay.get(entry.practice_date);
    if (!row) continue;
    row.questionCount += cleanCount(entry.question_count);
    row.testCount += cleanCount(entry.test_count);
  }
  return days;
}

/** Month view groups calendar weeks (Monday–Sunday) and clips them to the selected month. */
export function practiceTrend(entries: readonly PracticeEntry[], anchor: string, period: PracticePeriod): PracticeTrendRow[] {
  const days = dailyPracticeTrend(entries, anchor, period);
  if (period !== 'month') return days.map(row => ({ ...row, end: row.date, label: row.date }));
  const weeks: PracticeTrendRow[] = [];
  for (let index = 0; index < days.length;) {
    const first = days[index];
    const firstWeekday = (utcDay(first.date).getUTCDay() + 6) % 7;
    const count = Math.min(7 - firstWeekday, days.length - index);
    const slice = days.slice(index, index + count);
    const last = slice.at(-1)!;
    weeks.push({
      date: first.date,
      end: last.date,
      label: utcDay(first.date).getUTCDate() + '–' + utcDay(last.date).getUTCDate(),
      questionCount: slice.reduce((total, row) => total + row.questionCount, 0),
      testCount: slice.reduce((total, row) => total + row.testCount, 0),
    });
    index += count;
  }
  return weeks;
}
