import type {AppState} from './domain/types';

/** Replace a preview's temporary ID before another command can refer to it. */
export function acknowledgeCommandReceipt(state: AppState, type: string, provisionalId: string, id: string): AppState {
  if (provisionalId === id) return state;
  const collections = {
    'task.create': 'tasks', 'topic.create': 'topics', 'practice.create': 'practice_entries',
    'exam.create': 'exams', 'journal.create': 'journal_entries', 'day.mark': 'day_marks',
    'manual_study.create': 'manual_study_entries',
    'timer.start': 'sessions',
  } as const;
  const key = collections[type as keyof typeof collections];
  if (!key) return state;
  const rows = state[key];
  if (!rows?.some(row => row.id === provisionalId)) return state;
  // A replay may refer to a row already obtained by a recovery read. Keep that
  // authoritative row instead of showing a second copy of the same record.
  const exists = rows.some(row => row.id === id);
  return {...state, [key]: exists ? rows.filter(row => row.id !== provisionalId)
    : rows.map(row => row.id === provisionalId ? {...row, id} : row),
    ...(type === 'timer.start' ? {intervals: state.intervals.map(interval => interval.session_id === provisionalId
      ? {...interval, session_id: id} : interval)} : {})};
}
