import type { AppState, ExamRecord, StudySession } from '../domain/types';
import { secondsByDay } from '../timing';
import { localDate } from '../ui';

export const CLASSROOM_TIMEZONE = 'Europe/Istanbul';

export type ExamComparison = {
  exam: ExamRecord;
  previous: ExamRecord | null;
  delta: number | null;
  sections: Array<{
    key: string; label: string; questionCount: number;
    correct: number | null; wrong: number | null; blank: number | null;
    net: number | null; delta: number | null;
  }>;
};

export type StudentMetrics = {
  today: string; weekStart: string;
  todaySeconds: number | null; weekSeconds: number | null; todayQuestions: number | null;
  latestTYT: ExamComparison | null; latestAYT: ExamComparison | null;
  weeklyStudy: Array<{ date: string; label: string; seconds: number | null }>;
  questionSubjects: Array<{ subject: string; exam: 'TYT' | 'AYT'; questions: number }>;
  topicProgress: Array<{
    exam: 'TYT' | 'AYT'; subject: string; completed: number; total: number;
    /** Completion means mastery >= 2, "Konu anlatımı tamamlandı" in the existing model. */
    percentage: number; masteryPercentage: number;
  }>;
};

export function shiftClassroomDate(date: string, amount: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function classroomWeekStart(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return shiftClassroomDate(date, -((weekday + 6) % 7));
}

/**
 * Intervals, rather than elapsed session wall time, are the source of truth.
 * Merge overlaps before reusing the app's timezone-aware day splitter so a
 * duplicated interval or a competing device cannot count the same second twice.
 */
export function classroomStudySecondsByDay(state: AppState, now: number): Record<string, number> {
  const sessions = new Map(state.sessions.map(session => [session.id, session]));
  const spans: Array<[number, number]> = [];
  for (const interval of state.intervals) {
    const session = sessions.get(interval.session_id);
    if (!session || (!interval.ended_at && session.status !== 'running')) continue;
    let start = Math.max(Date.parse(interval.started_at), Date.parse(session.started_at));
    let end = Math.min(interval.ended_at ? Date.parse(interval.ended_at) : now, now);
    if (session.finished_at) end = Math.min(end, Date.parse(session.finished_at));
    if (!interval.ended_at && session.active_since) start = Math.max(start, Date.parse(session.active_since));
    if (!interval.ended_at && session.mode === 'countdown' && session.target_seconds !== null) {
      end = Math.min(end, start + Math.max(0, session.target_seconds - session.accumulated_seconds) * 1000);
    }
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) spans.push([start, end]);
  }
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous && span[0] <= previous[1]) previous[1] = Math.max(previous[1], span[1]);
    else merged.push([...span]);
  }
  const session: StudySession = {
    id: 'classroom-union', title: '', task_id: null, topic_id: null, subject: null,
    study_type: 'Soru çözümü', mode: 'stopwatch', target_seconds: null,
    status: 'finished', started_at: new Date(0).toISOString(), active_since: null,
    accumulated_seconds: 0, finished_at: new Date(now).toISOString(), revision: 1,
  };
  return secondsByDay({
    sessions: [session],
    intervals: merged.map(([start, end], index) => ({
      id: String(index), session_id: session.id,
      started_at: new Date(start).toISOString(), ended_at: new Date(end).toISOString(),
    })),
    manual_study_entries: state.manual_study_entries,
  }, CLASSROOM_TIMEZONE, now);
}

/** Existing ExamRecord has no draft status: a dated record with a total is completed. */
export function latestExamComparison(exams: ExamRecord[], format: 'TYT' | 'AYT_SAYISAL', today: string): ExamComparison | null {
  const available = exams.filter(exam => exam.format_code === format && exam.exam_date <= today &&
    exam.total_net !== null && Number.isFinite(exam.total_net))
    .sort((a, b) => b.exam_date.localeCompare(a.exam_date) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const exam = available[0];
  if (!exam) return null;
  const previous = available[1] ?? null;
  return {
    exam, previous,
    delta: previous && previous.total_net !== null ? exam.total_net! - previous.total_net : null,
    sections: exam.format_snapshot.sections.map(section => {
      const result = exam.results.find(item => item.section_key === section.key);
      const oldResult = previous?.results.find(item => item.section_key === section.key);
      // A changed format's differently-sized section is not a like-for-like comparison.
      const previousSpec = previous?.format_snapshot.sections.find(item => item.key === section.key);
      const comparable = previousSpec?.question_count === section.question_count &&
        previous?.format_snapshot.wrong_divisor === exam.format_snapshot.wrong_divisor;
      return {
        key: section.key, label: section.label, questionCount: section.question_count,
        correct: result?.correct ?? null, wrong: result?.wrong ?? null, blank: result?.blank ?? null,
        net: result?.net ?? null, delta: result && oldResult && comparable ? result.net - oldResult.net : null,
      };
    }),
  };
}

export function studentMetrics(state: AppState, now: Date | number = new Date()): StudentMetrics {
  const timestamp = typeof now === 'number' ? now : now.getTime();
  const today = localDate(timestamp, CLASSROOM_TIMEZONE);
  const weekStart = classroomWeekStart(today);
  const totals = classroomStudySecondsByDay(state, timestamp);
  const explicitZero = new Set(state.day_marks.filter(mark => mark.kind === 'zero').map(mark => mark.mark_date));
  const weeklyStudy = Array.from({ length: 7 }, (_, index) => {
    const date = shiftClassroomDate(weekStart, index);
    return {
      date,
      label: new Intl.DateTimeFormat('tr-TR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)),
      seconds: date > today ? null : totals[date] ?? (explicitZero.has(date) ? 0 : null),
    };
  });
  const observed = weeklyStudy.filter(day => day.seconds !== null);
  const questionTotals = new Map<string, StudentMetrics['questionSubjects'][number]>();
  for (const entry of state.practice_entries.filter(entry => entry.practice_date === today)) {
    const key = `${entry.exam}:${entry.subject}`;
    const row = questionTotals.get(key) ?? { exam: entry.exam, subject: entry.subject, questions: 0 };
    row.questions += entry.question_count;
    questionTotals.set(key, row);
  }
  const questionSubjects = [...questionTotals.values()].sort((a, b) => b.questions - a.questions || a.subject.localeCompare(b.subject, 'tr'));
  const topicGroups = new Map<string, { exam: 'TYT' | 'AYT'; subject: string; completed: number; total: number; mastery: number }>();
  // Parent headings do not count a second time alongside their actual child topics.
  const parentIds = new Set(state.topics.map(topic => topic.parent_id).filter(Boolean));
  for (const topic of state.topics.filter(topic => !parentIds.has(topic.id))) {
    const key = `${topic.exam}:${topic.subject}`;
    const row = topicGroups.get(key) ?? { exam: topic.exam, subject: topic.subject, completed: 0, total: 0, mastery: 0 };
    row.completed += topic.mastery >= 2 ? 1 : 0;
    row.total++;
    row.mastery += topic.mastery;
    topicGroups.set(key, row);
  }
  return {
    today, weekStart, todaySeconds: totals[today] ?? (explicitZero.has(today) ? 0 : null),
    weekSeconds: observed.length ? observed.reduce((sum, day) => sum + day.seconds!, 0) : null,
    todayQuestions: questionSubjects.length ? questionSubjects.reduce((sum, row) => sum + row.questions, 0) : null,
    latestTYT: latestExamComparison(state.exams, 'TYT', today),
    latestAYT: latestExamComparison(state.exams, 'AYT_SAYISAL', today), weeklyStudy, questionSubjects,
    topicProgress: [...topicGroups.values()].map(({ mastery, ...row }) => ({
      ...row, percentage: Math.round(row.completed / row.total * 100), masteryPercentage: Math.round(mastery / (row.total * 4) * 100),
    })).sort((a, b) => b.exam.localeCompare(a.exam) || a.subject.localeCompare(b.subject, 'tr')),
  };
}
