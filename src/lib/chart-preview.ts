import type { AppState, StudyInterval, StudySession, Task } from './domain/types';
import { localDate } from './ui';
import {previewExamFormats,previewExams} from './exam-preview';

const TIMEZONE = 'Europe/Istanbul';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function localDayStart(now: number, day: string) {
  let before = now - 36 * HOUR;
  let within = now;
  while (within - before > 1_000) {
    const middle = Math.floor((before + within) / 2);
    if (localDate(middle, TIMEZONE) === day) within = middle;
    else before = middle;
  }
  return within;
}

function priorDay(day: string, daysBack: number) {
  const date = new Date(day + 'T12:00:00.000Z');
  date.setUTCDate(date.getUTCDate() - daysBack);
  return date.toISOString().slice(0, 10);
}

/** Ephemeral display data. Call only while the clearly labelled chart preview is active. */
export function createChartPreviewState(state: AppState): AppState {
  const parsedNow = Date.parse(state.server_now);
  const sourceNow = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const today = localDate(sourceNow, TIMEZONE);
  const now = Math.max(sourceNow, localDayStart(sourceNow, today) + 3 * HOUR);
  const stamp = new Date(now).toISOString();
  const idPrefix = '__chart_preview__' + today + '__';

  const taskDetails = [
    { title: 'Örnek · TYT Matematik problemleri', exam: 'TYT', subject: 'Matematik', planned: 60, difficulty: 'medium', progress: 1, studyType: 'Soru çözümü' },
    { title: 'Örnek · TYT Türkçe paragraf', exam: 'TYT', subject: 'Türkçe', planned: 45, difficulty: 'easy', progress: 0.65, studyType: 'Soru çözümü' },
    { title: 'Örnek · AYT Biyoloji hücre tekrarı', exam: 'AYT', subject: 'Biyoloji', planned: 75, difficulty: 'medium', progress: 0.35, studyType: 'Tekrar' },
    { title: 'Örnek · AYT Fizik kuvvet konusu', exam: 'AYT', subject: 'Fizik', planned: 90, difficulty: 'hard', progress: 0, studyType: 'Konu anlatımı' },
  ] as const;
  const tasks: Task[] = taskDetails.map((detail, index) => ({
    id: idPrefix + 'task_' + index,
    title: detail.title,
    plan_date: today,
    exam: detail.exam,
    subject: detail.subject,
    topic_id: null,
    resource: '',
    completion_criteria: '',
    planned_minutes: detail.planned,
    difficulty: detail.difficulty,
    progress: detail.progress,
    weight_override: null,
    priority: 'normal',
    position: index,
    notes: '',
    study_type: detail.studyType,
    steps: [],
    revision: 1,
    created_at: stamp,
    updated_at: stamp,
  }));

  const sessions: StudySession[] = [];
  const intervals: StudyInterval[] = [];
  const addSession = (key: string, title: string, subject: string, taskId: string | null, started: number, durationSeconds: number) => {
    if (durationSeconds <= 0) return;
    const ended = started + durationSeconds * 1_000;
    const id = idPrefix + 'session_' + key;
    sessions.push({
      id,
      title,
      task_id: taskId,
      topic_id: null,
      subject,
      study_type: 'Soru çözümü',
      mode: 'stopwatch',
      target_seconds: null,
      status: 'finished',
      started_at: new Date(started).toISOString(),
      active_since: null,
      accumulated_seconds: durationSeconds,
      finished_at: new Date(ended).toISOString(),
      revision: 1,
    });
    intervals.push({ id: idPrefix + 'interval_' + key, session_id: id, started_at: new Date(started).toISOString(), ended_at: new Date(ended).toISOString() });
  };

  // Leave room before the current time; every displayed interval is already finished.
  const elapsedToday = Math.max(0, Math.floor((now - localDayStart(now, today)) / 1_000));
  const padding = Math.min(600, Math.floor(elapsedToday * 0.08));
  const breakSeconds = Math.min(900, Math.floor(elapsedToday * 0.1));
  const todaySeconds = Math.min(135 * 60, Math.max(0, elapsedToday - padding - breakSeconds));
  if (todaySeconds >= 2) {
    const mathematicsSeconds = Math.max(1, Math.round(todaySeconds * 2 / 3));
    const biologySeconds = todaySeconds - mathematicsSeconds;
    const biologyEnd = now - padding * 1_000;
    const biologyStart = biologyEnd - biologySeconds * 1_000;
    const mathematicsStart = biologyStart - (breakSeconds + mathematicsSeconds) * 1_000;
    addSession('today_math', 'Örnek · Matematik soru çözümü', 'Matematik', tasks[0].id, mathematicsStart, mathematicsSeconds);
    addSession('today_biology', 'Örnek · Biyoloji tekrarı', 'Biyoloji', tasks[2].id, biologyStart, biologySeconds);
  }

  const yesterday = priorDay(today, 1);
  const threeDaysAgo = priorDay(today, 3);
  addSession('yesterday_turkish', 'Örnek · Türkçe paragraf çalışması', 'Türkçe', null, Date.parse(yesterday + 'T09:00:00.000Z'), 70 * 60);
  addSession('earlier_physics', 'Örnek · Fizik konu çalışması', 'Fizik', null, Date.parse(threeDaysAgo + 'T09:00:00.000Z'), 105 * 60);

  const practiceSamples = [
    [today, 'TYT', 'Matematik', 70, 3],
    [today, 'AYT', 'Biyoloji', 24, 1],
    [today, 'TYT', 'Türkçe', 32, 1],
    [yesterday, 'TYT', 'Türkçe', 45, 2],
    [yesterday, 'TYT', 'Matematik', 30, 1],
    [threeDaysAgo, 'AYT', 'Fizik', 55, 2],
    [priorDay(today, 8), 'AYT', 'Matematik', 38, 2],
    [priorDay(today, 33), 'AYT', 'Biyoloji', 28, 1],
  ] as const;
  const practiceEntries = practiceSamples.map(([practice_date, exam, subject, question_count, test_count], index) => ({
    id: idPrefix + 'practice_' + index,
    practice_date, exam, subject, question_count, test_count,
    revision: 1, created_at: stamp, updated_at: stamp,
  }));

  return {
    ...state,
    server_now: stamp,
    tasks: [...state.tasks, ...tasks],
    sessions: [...state.sessions, ...sessions],
    intervals: [...state.intervals, ...intervals],
    practice_entries: [...(state.practice_entries ?? []), ...practiceEntries],
    exam_formats: state.exam_formats.length?state.exam_formats:previewExamFormats,
    exams: [...state.exams,...previewExams(today,stamp,idPrefix)],
  };
}
