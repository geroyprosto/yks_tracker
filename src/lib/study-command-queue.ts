import type {AppState} from './domain/types';
import {optimisticCommand} from './optimistic-command';
import {optimisticTimerCommand} from './optimistic-timer';
import {acknowledgeCommandReceipt} from './command-receipt';
import {optimisticEducationCommand} from './optimistic-education';
import type {SaveMeasurement} from './save-metrics';

export type QueuedCommand = {request_id: string; type: string; payload: Record<string, unknown>};
export type CommandResult = {id: string; request_id: string; replayed: boolean; state?: AppState; receivedAt?: number; partialState?: boolean};
export class CommandRequestError extends Error {
  constructor(message: string, public status: number | null) {super(message);}
}
type Job = QueuedCommand & {at: string; measurement?: SaveMeasurement; dependencies: Set<string>;
  sent?: QueuedCommand; retrying: boolean; optimistic: boolean; effectKeys: Set<string>; resolve: (ok: boolean) => void};
type Options = {
  send(command: QueuedCommand, minimal: boolean, measurement?: SaveMeasurement): Promise<CommandResult>;
  recover(): Promise<AppState | null>;
  change(state: AppState, count: number, paused: boolean): void;
  error(message: string): void;
  committed(state: AppState, partial?: boolean): void;
  settled(measurement: SaveMeasurement | undefined, needsRefresh: boolean): void;
};

export function previewStudyCommand(state: AppState, command: QueuedCommand, at: string): AppState | null {
  if (command.type.startsWith('education.')) {
    // These forms create several canonical IDs. Their inputs are accepted into
    // the queue, while their existing durable flow waits for those rows.
    if (command.type === 'education.profile.save' || command.type === 'education.results.batch') return null;
    const education = state.education && optimisticEducationCommand(state.education, command.type.slice(10), command.payload, command.request_id, at);
    return education ? {...state, education} : null;
  }
  return command.type.startsWith('timer.')
    ? optimisticTimerCommand(state, command.type, command.payload, command.request_id, at)
    : optimisticCommand(state, command.type, command.payload, command.request_id, at);
}

function currentRevision(state: AppState, type: string, id: unknown): number | undefined {
  if (type.startsWith('education.')) return state.education?.courses.find(row => row.id === id)?.revision
    ?? state.education?.results.find(row => row.id === id)?.revision
    ?? (type === 'education.draft.save' || type === 'education.draft.discard' ? state.education?.draft?.revision ?? 0 : state.education?.profile?.revision);
  const collection = type.startsWith('task.') ? state.tasks : type.startsWith('timer.') ? state.sessions
    : type.startsWith('topic.') ? state.topics : type.startsWith('practice.') ? state.practice_entries
    : type.startsWith('exam.') ? state.exams : type.startsWith('journal.') ? state.journal_entries
    : type.startsWith('day.') ? state.day_marks : undefined;
  return collection?.find(row => row.id === id)?.revision ?? (type.startsWith('settings.') ? state.settings?.revision : undefined);
}

/** One transport request at a time; the visible state always includes all accepted intents. */
export function createStudyCommandQueue(initial: AppState, options: Options) {
  let confirmed = initial;
  const jobs: Job[] = [];
  const aliases = new Map<string, string>();
  let active = false, paused = false, recovering = false, disposed = false, needsRefresh = false;
  let lastMeasurement: SaveMeasurement | undefined;
  const resolvePayload = (payload: Record<string, unknown>) => Object.fromEntries(Object.entries(payload)
    .map(([key, value]) => [key, typeof value === 'string' && ['id', 'task_id', 'topic_id', 'parent_id', 'course_id', 'term_id'].includes(key)
      ? aliases.get(value) ?? value : value]));
  const visible = () => jobs.reduce((state, job) => {
    const payload = resolvePayload(job.payload);
    // Rebase the overlay only. Dispatch keeps the revision captured from our own
    // preceding optimistic intents, so an external edit still raises a conflict.
    if ('expected_revision' in payload) payload.expected_revision = currentRevision(state, job.type, payload.id) ?? payload.expected_revision;
    return previewStudyCommand(state, {...job, payload}, job.at) ?? state;
  }, confirmed);
  const publish = () => {if (!disposed) options.change(visible(), jobs.length, paused);};
  const settle = () => {if (!disposed) options.settled(lastMeasurement, needsRefresh);};
  function effects(job: QueuedCommand, state: AppState): Set<string> {
    if ('effectKeys' in job) return new Set([...(job as Job).effectKeys].map(key => aliases.get(key) ?? key));
    const payload = resolvePayload(job.payload), keys = new Set<string>();
    if (typeof payload.id === 'string') keys.add(payload.id);
    if (job.type.endsWith('.create') || job.type === 'timer.start') keys.add(job.request_id);
    if (job.type.startsWith('timer.')) keys.add('active-timer');
    if (job.type === 'task.delete') state.sessions.filter(session => session.task_id === payload.id).forEach(session => keys.add(session.id));
    if (job.type.startsWith('settings.')) keys.add('settings');
    return keys;
  }
  function reads(command: QueuedCommand): Set<string> {
    const payload = resolvePayload(command.payload);
    const keys = new Set(Object.entries(payload).filter(([key, value]) =>
      ['id', 'task_id', 'topic_id', 'parent_id', 'course_id', 'term_id'].includes(key) && typeof value === 'string').map(([, value]) => value as string));
    if (command.type.startsWith('timer.')) keys.add('active-timer');
    if (command.type.startsWith('settings.')) keys.add('settings');
    return keys;
  }
  function cancelDependents(failed: Job) {
    const rejected = new Set([failed.request_id]);
    for (const job of [...jobs]) if ([...job.dependencies].some(id => rejected.has(id))) {
      rejected.add(job.request_id); jobs.splice(jobs.indexOf(job), 1);
      job.measurement?.failed('state_check_failed'); job.resolve(false);
    }
    return rejected.size - 1;
  }
  function autoFinished(job: Job, latest: AppState): boolean {
    if (job.type !== 'timer.finish') return false;
    const id = resolvePayload(job.payload).id;
    const before = confirmed.sessions.find(session => session.id === id);
    const after = latest.sessions.find(session => session.id === id);
    if (before?.mode !== 'countdown' || before.status !== 'running' || !before.active_since || before.target_seconds === null) return false;
    const finishedAt = Date.parse(before.active_since) + Math.max(0, before.target_seconds - before.accumulated_seconds) * 1000;
    return after?.status === 'finished' && after.accumulated_seconds === before.target_seconds && Date.parse(after.finished_at ?? '') === finishedAt;
  }
  async function pump() {
    if (active || paused || disposed || !jobs.length) return;
    active = true;
    while (jobs.length && !paused && !disposed) {
      const job = jobs[0];
      const minimal = job.optimistic && !job.retrying && !job.type.startsWith('timer.') && !job.type.startsWith('education.') && job.type !== 'task.delete';
      job.sent ??= {request_id: job.request_id, type: job.type, payload: resolvePayload(job.payload)};
      try {
        const result = await options.send(job.sent, minimal, job.measurement);
        if (disposed) return;
        if (result.request_id !== job.request_id || typeof result.id !== 'string') throw new CommandRequestError('Kayıt yanıtı doğrulanamadı.', null);
        let canonical = result.state;
        if ((!minimal || result.replayed) && !canonical) canonical = await options.recover() ?? undefined;
        if (disposed) return;
        if ((!minimal || result.replayed) && !canonical) throw new CommandRequestError('Kaydın güncel durumu doğrulanamadı.', null);
        if (job.type.endsWith('.create') || job.type === 'timer.start' || job.type === 'day.mark') aliases.set(job.request_id, result.id);
        confirmed = canonical ?? acknowledgeCommandReceipt(previewStudyCommand(confirmed, job.sent, job.at) ?? confirmed,
          job.type, job.request_id, result.id);
        if (canonical) {needsRefresh = Boolean(result.partialState); options.committed(confirmed,result.partialState);} else needsRefresh = true;
        jobs.shift(); lastMeasurement = job.measurement;
        job.measurement?.confirmed('receipt', result.receivedAt); job.resolve(true); publish();
      } catch (error) {
        if (disposed) return;
        const status = error instanceof CommandRequestError ? error.status : null;
        if (status === null || status >= 500) {
          paused = true;
          options.error((error instanceof Error ? error.message : 'Kayıt doğrulanamadı.') + ' Bekleyen işlemler duraklatıldı; yeniden dene.');
          publish(); break;
        }
        recovering = true;
        const finishRefresh = job.measurement?.refresh();
        const latest = await options.recover().catch(() => null);
        finishRefresh?.(Boolean(latest)); recovering = false;
        if (disposed) return;
        const completed = latest ? autoFinished(job, latest) : false;
        if (latest) {confirmed = latest; needsRefresh = false; options.committed(latest);}
        jobs.shift(); job.resolve(completed);
        if (completed) job.measurement?.confirmed('state_check');
        else {
          job.measurement?.failed('http_error');
          const canceled = cancelDependents(job);
          options.error((error instanceof Error ? error.message : 'İşlem kaydedilemedi.') +
            (canceled ? ` Bağlı ${canceled} işlem gönderilmedi; yeniden dene.` : ''));
        }
        if (!latest && jobs.length) {
          paused = true; recovering = true;
          options.error('Güncel durum doğrulanamadı. Bekleyen işlemler duraklatıldı; yeniden dene.');
        }
        publish();
      }
    }
    active = false;
    if (!jobs.length && !disposed) settle();
  }
  return {
    get state() {return visible();},
    get confirmed() {return confirmed;},
    get count() {return jobs.length;},
    get hasPendingEducation() {return jobs.some(job => job.type.startsWith('education.'));},
    get paused() {return paused;},
    install(state: AppState) {if (!jobs.length) {confirmed = state; needsRefresh = false; publish();} return visible();},
    enqueue(command: QueuedCommand, at: string, measurement?: SaveMeasurement) {
      if (paused || disposed) return null;
      const before = visible();
      const payload = resolvePayload(structuredClone(command.payload));
      const baselineRevision = currentRevision(confirmed, command.type, payload.id);
      const readKeys = reads({...command, payload});
      const ownPredecessor = jobs.some(job => [...effects(job, before)].some(key => readKeys.has(key)));
      if (ownPredecessor && typeof payload.expected_revision === 'number' &&
          (baselineRevision === undefined || payload.expected_revision >= baselineRevision))
        payload.expected_revision = currentRevision(before, command.type, payload.id) ?? payload.expected_revision;
      const normalized = {...command, payload};
      const projection = previewStudyCommand(before, normalized, at);
      const optimistic = projection !== null;
      const effectKeys = effects(normalized, before);
      if (projection) for (const key of ['tasks','topics','sessions','practice_entries','exams','journal_entries','day_marks'] as const) {
        const previous = before[key], next = projection[key];
        if (previous === next) continue;
        const nextById = new Map(next.map(row => [row.id, row]));
        const previousIds = new Set(previous.map(row => row.id));
        for (const row of previous) if (nextById.get(row.id) !== row) effectKeys.add(row.id);
        for (const row of next) if (!previousIds.has(row.id)) effectKeys.add(row.id);
      }
      const keys = reads(normalized), dependencies = new Set<string>();
      for (const prior of jobs) if ([...effects(prior, before)].some(key => keys.has(key))) dependencies.add(prior.request_id);
      let resolve!: (ok: boolean) => void;
      const done = new Promise<boolean>(finish => {resolve = finish;});
      jobs.push({...normalized, at, measurement, dependencies, retrying: false, optimistic,
        effectKeys, resolve});
      publish(); void pump(); return done;
    },
    async retry() {
      if (!paused || active || disposed) return;
      if (recovering) {
        const latest = await options.recover().catch(() => null);
        if (disposed) return;
        if (!latest) {options.error('Güncel durum doğrulanamadı. Bekleyen işlemler duraklatıldı; yeniden dene.');publish();return;}
        confirmed = latest; recovering = false; options.committed(latest);
      }
      if (jobs[0]?.sent) jobs[0].retrying = true;
      paused = false; publish(); void pump();
    },
    dispose() {disposed = true; jobs.forEach(job => job.resolve(false));},
  };
}
