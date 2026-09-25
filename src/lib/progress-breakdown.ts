import type { AppState } from './domain/types';
import { secondsByDay } from './timing';

export type RingSegment = { key: string; label: string; value: number; color: number };
export function progressSegments(value: number | null, label: string, color: number): RingSegment[] {
  return value === null ? [] : [{ key: label, label, value: Math.min(100, Math.max(0, value)), color }];
}
export function combinedSegments(task: number | null, time: number | null, taskShare = .7): RingSegment[] {
  if (!Number.isFinite(taskShare) || taskShare < 0 || taskShare > 1) return [];
  const available = [
    { key: 'tasks', label: 'Görev katkısı', value: task, weight: taskShare, color: 0 },
    { key: 'time', label: 'Süre katkısı', value: time, weight: 1 - taskShare, color: 1 },
  ].filter(part => part.value !== null && Number.isFinite(part.value) && part.weight > 0);
  const totalWeight = available.reduce((sum, part) => sum + part.weight, 0);
  return available.map(part => ({ key: part.key, label: part.label, value: Math.min(100, Math.max(0, part.value!)) * part.weight / totalWeight, color: part.color }));
}
export function studyDistribution(
  state: Pick<AppState, 'sessions' | 'intervals' | 'topics' | 'tasks'> & Partial<Pick<AppState, 'manual_study_entries'>>,
  day: string,
  timezone: string,
  now: number,
) {
  const topics = new Map(state.topics.map(topic => [topic.id, topic]));
  const tasks = new Map(state.tasks.map(task => [task.id, task]));
  const grouped = new Map<string, typeof state.sessions>();
  for (const session of state.sessions) {
    const topic = session.topic_id ? topics.get(session.topic_id) : null;
    const task = session.task_id ? tasks.get(session.task_id) : null;
    const label = topic ? topic.exam + ' ' + topic.subject : task?.subject ? [task.exam, task.subject].filter(Boolean).join(' ') : session.subject || 'Ders seçilmedi';
    const sessions = grouped.get(label) ?? [];
    sessions.push(session);
    grouped.set(label, sessions);
  }
  const totals = new Map<string, number>();
  for (const [label, sessions] of grouped) {
    const ids = new Set(sessions.map(session => session.id));
    const intervals = state.intervals.filter(interval => ids.has(interval.session_id));
    const seconds = secondsByDay({ sessions, intervals }, timezone, now)[day] ?? 0;
    if (seconds > 0) totals.set(label, seconds);
  }
  for (const entry of state.manual_study_entries ?? []) {
    if (entry.study_date === day) totals.set(entry.subject, (totals.get(entry.subject) ?? 0) + entry.duration_seconds);
  }
  const rows = [...totals].map(([label, seconds]) => ({label, seconds}))
    .sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label, 'tr'));
  const total = rows.reduce((sum, row) => sum + row.seconds, 0);
  const displayed = rows.length > 5 ? [...rows.slice(0, 4), { label: 'Diğer dersler', seconds: rows.slice(4).reduce((sum, row) => sum + row.seconds, 0) }] : rows;
  return { total, rows: displayed.map((row, color) => ({ ...row, key: row.label, value: total ? row.seconds / total * 100 : 0, color })) };
}

