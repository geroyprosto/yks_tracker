import type {AppState, StudyInterval, StudySession} from './domain/types';

/** Timer timestamps are provisional until an authoritative command response arrives. */
export function optimisticTimerCommand(state: AppState, type: string, payload: Record<string, unknown>, provisionalId: string, now: string): AppState | null {
  if (!Number.isFinite(Date.parse(now))) return null;
  const stamp = new Date(Math.floor(Date.parse(now) / 1000) * 1000).toISOString();
  if (type === 'timer.start') {
    if (state.sessions.some(session => session.status !== 'finished')) return null;
    const course = state.education?.courses.find(item => item.id === payload.course_id);
    const task = state.tasks.find(item => item.id === payload.task_id);
    const mode = payload.mode === 'countdown' ? 'countdown' : 'stopwatch';
    if (mode === 'countdown' && (typeof payload.target_seconds !== 'number' || payload.target_seconds < 60)) return null;
    const session: StudySession = {id: provisionalId, title: String(payload.title ?? task?.title ?? 'Çalışma'),
      course_id: (payload.course_id as string | null) ?? null, task_id: (payload.task_id as string | null) ?? null,
      topic_id: (payload.topic_id as string | null) ?? null, subject: course?.name ?? (payload.subject as string | null) ?? null,
      study_type: (payload.study_type as StudySession['study_type']) ?? 'Soru çözümü', mode,
      target_seconds: mode === 'countdown' ? payload.target_seconds as number : null, status: 'running',
      started_at: stamp, active_since: stamp, accumulated_seconds: 0, finished_at: null, revision: 1};
    return {...state, sessions: [...state.sessions, session], intervals: [...state.intervals,
      {id: `optimistic-${provisionalId}`, session_id: provisionalId, started_at: stamp, ended_at: null}]};
  }
  const session = state.sessions.find(item => item.id === payload.id);
  if (!session || session.revision !== payload.expected_revision || session.status === 'finished') return null;
  const at = new Date(Math.max(Date.parse(stamp), Date.parse(session.active_since ?? session.started_at))).toISOString();
  if (type === 'timer.finish') return optimisticTimerFinish(state, payload, at);
  if (type === 'timer.resume') {
    if (session.status !== 'paused') return null;
    return {...state, sessions: state.sessions.map(item => item === session
      ? {...item, status: 'running', active_since: at, revision: item.revision + 1} : item),
      intervals: [...state.intervals, {id: `optimistic-${provisionalId}`, session_id: session.id, started_at: at, ended_at: null}]};
  }
  if (type !== 'timer.pause' || session.status !== 'running' || !session.active_since) return null;
  const elapsed = session.accumulated_seconds + Math.max(0, Math.round((Date.parse(at) - Date.parse(session.active_since)) / 1000));
  return {...state, sessions: state.sessions.map(item => item === session
    ? {...item, status: 'paused', active_since: null, accumulated_seconds: session.mode === 'countdown'
      ? Math.min(elapsed, session.target_seconds ?? elapsed) : elapsed, revision: item.revision + 1} : item),
    intervals: state.intervals.map(interval => interval.session_id === session.id && interval.ended_at === null
      ? {...interval, ended_at: at} : interval)};
}

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
