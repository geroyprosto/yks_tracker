import type {AppState, StudyInterval} from './domain/types';

/** Show a finished timer while its command receipt and authoritative state are in flight. */
export function optimisticTimerFinish(
  state: AppState, payload: Record<string, unknown>, now: string,
): AppState | null {
  const {id, expected_revision: expectedRevision, confirmed_seconds: confirmation} = payload;
  const session = typeof id === 'string' ? state.sessions.find(item => item.id === id) : undefined;
  const at = Date.parse(now);
  if (!session || (session.status !== 'running' && session.status !== 'paused') ||
      typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) ||
      session.revision !== expectedRevision || !Number.isFinite(at) ||
      (confirmation !== undefined && (typeof confirmation !== 'number' ||
        !Number.isInteger(confirmation) || confirmation < 0 || confirmation > 604800))) return null;

  // The database stamps commands to whole seconds and settles elapsed countdowns at their target.
  const atSecond = Math.floor(at / 1000) * 1000;
  let finishedAt = atSecond;
  if (session.mode === 'countdown') {
    if (session.target_seconds === null) return null;
    if (session.status === 'running') {
      const activeSince = Date.parse(session.active_since ?? '');
      if (!Number.isFinite(activeSince)) return null;
      finishedAt = Math.min(finishedAt, activeSince +
        Math.max(0, session.target_seconds - session.accumulated_seconds) * 1000);
    }
  }

  const open = state.intervals.filter(interval => interval.session_id === session.id && interval.ended_at === null);
  if (open.length > 1 || (session.status === 'paused' && open.length)) return null;
  if (session.status === 'running' && !session.active_since) return null;
  if (session.status === 'paused' && session.active_since !== null) return null;

  let intervals: StudyInterval[] = state.intervals;
  if (session.status === 'running') {
    const activeSince = Date.parse(session.active_since!);
    if (!Number.isFinite(activeSince) || finishedAt < activeSince) return null;
    if (open.length) {
      const opened = Date.parse(open[0].started_at);
      if (!Number.isFinite(opened) || finishedAt < opened) return null;
      intervals = intervals.map(interval => interval === open[0]
        ? {...interval, ended_at: new Date(finishedAt).toISOString()} : interval);
    } else {
      // A normally loaded state includes this interval. This also supports incomplete HTTP fixtures.
      intervals = [...intervals, {id: `optimistic-${session.id}`, session_id: session.id,
        started_at: session.active_since!, ended_at: new Date(finishedAt).toISOString()}];
    }
  }

  const belonging = intervals.filter(interval => interval.session_id === session.id);
  if (!belonging.length) return null;
  let totalMillis = 0;
  for (const interval of belonging) {
    const start = Date.parse(interval.started_at), end = Date.parse(interval.ended_at ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    totalMillis += end - start;
  }
  const totalSeconds = Math.round(totalMillis / 1000);
  if (session.mode === 'stopwatch' && totalSeconds > 21600 && confirmation === undefined) return null;
  if (typeof confirmation === 'number' && confirmation > totalSeconds) return null;
  const savedSeconds = typeof confirmation === 'number' ? confirmation : totalSeconds;

  if (savedSeconds < totalSeconds) {
    let remove = totalSeconds - savedSeconds;
    const replacements = new Map<string, StudyInterval>();
    const newestFirst = [...belonging].sort((left, right) =>
      Date.parse(right.started_at) - Date.parse(left.started_at));
    for (const interval of newestFirst) {
      if (!remove) break;
      const end = Date.parse(interval.ended_at!);
      const span = Math.round((end - Date.parse(interval.started_at)) / 1000);
      const seconds = Math.min(span, remove);
      remove -= seconds;
      replacements.set(interval.id, {...interval, ended_at: new Date(end - seconds * 1000).toISOString()});
    }
    intervals = intervals.map(interval => replacements.get(interval.id) ?? interval);
  }

  return {...state, server_now: new Date(atSecond).toISOString(),
    sessions: state.sessions.map(item => item.id === session.id ? {...item, status: 'finished',
      active_since: null, accumulated_seconds: savedSeconds,
      finished_at: new Date(finishedAt).toISOString(), revision: item.revision + 1} : item),
    intervals};
}
