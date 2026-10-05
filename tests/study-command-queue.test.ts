import assert from 'node:assert/strict';
import test from 'node:test';
import {emptyState, type AppState, type Task, type StudySession} from '../src/lib/domain/types';
import {createStudyCommandQueue, CommandRequestError, type QueuedCommand, type CommandResult} from '../src/lib/study-command-queue';

const stamp = '2026-10-05T09:00:00.987Z';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
function task(taskId = id): Task {
  return {id: taskId, title: taskId, plan_date: '2026-10-05', exam: null, subject: null, topic_id: null,
    resource: '', completion_criteria: '', planned_minutes: 30, difficulty: 'medium', progress: 0,
    weight_override: null, priority: 'normal', position: 0, notes: '', study_type: 'Tekrar', steps: [],
    revision: 1, created_at: stamp, updated_at: stamp};
}
function state(): AppState {return {...emptyState(true), authenticated: true, server_now: stamp, tasks: [task(), task(other)]};}
function active(): StudySession {return {id: sessionId, title: 'Timer', task_id: id, topic_id: null, subject: null,
  study_type: 'Tekrar', mode: 'stopwatch', target_seconds: null, status: 'running', started_at: '2026-10-05T08:00:00.000Z',
  active_since: '2026-10-05T08:00:00.000Z', accumulated_seconds: 0, finished_at: null, revision: 5};}
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(finish => {resolve = finish;});return {promise, resolve};}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const receipt = (command: QueuedCommand, canonical?: AppState, rowId = String(command.payload.id ?? command.request_id)): CommandResult =>
  ({id: rowId, request_id: command.request_id, replayed: false, ...(canonical ? {state: canonical} : {})});
function harness(initial: AppState, send: (command: QueuedCommand, minimal: boolean) => Promise<CommandResult>, recover: () => Promise<AppState | null> = async () => initial) {
  const errors: string[] = [], views: AppState[] = [], commits: AppState[] = [];
  const queue = createStudyCommandQueue(initial, {send, recover, change: view => {views.push(view);},
    error: error => {errors.push(error);}, committed: base => {commits.push(base);}, settled: () => {}});
  return {queue, errors, views, commits};
}

test('serial intents keep distinct IDs, own revisions, and overlays through stale installs', async () => {
  const first = deferred<CommandResult>(), second = deferred<CommandResult>();
  const sent: QueuedCommand[] = [];
  const {queue} = harness(state(), command => {sent.push(structuredClone(command));return sent.length === 1 ? first.promise : second.promise;});
  const one = queue.enqueue({request_id: 'one', type: 'task.update', payload: {id, expected_revision: 1, progress: 1}}, stamp)!;
  const two = queue.enqueue({request_id: 'two', type: 'task.update', payload: {id, expected_revision: 2, progress: 1}}, stamp)!;
  assert.equal(sent.length, 1); assert.equal(queue.state.tasks[0].revision, 3);
  queue.install(state()); assert.equal(queue.state.tasks[0].progress, 1);
  first.resolve(receipt(sent[0])); await one; await flush();
  assert.equal(sent[1].payload.expected_revision, 2); assert.notEqual(sent[0].request_id, sent[1].request_id);
  second.resolve(receipt(sent[1])); await two;
  assert.equal(queue.state.tasks[0].revision, 3); assert.equal(queue.count, 0);
});

test('same-second start finish and another start rebase canonical IDs without rolling back the newer timer', async () => {
  const first = deferred<CommandResult>(), finish = deferred<CommandResult>(), next = deferred<CommandResult>();
  const sent: QueuedCommand[] = [];
  const {queue} = harness(state(), (command, minimal) => {assert.equal(minimal, false);sent.push(structuredClone(command));return [first, finish, next][sent.length - 1].promise;});
  const one = queue.enqueue({request_id: 'start-one', type: 'timer.start', payload: {title: 'First', mode: 'stopwatch'}}, stamp)!;
  assert.equal(queue.state.sessions[0].active_since, '2026-10-05T09:00:00.000Z');
  const two = queue.enqueue({request_id: 'finish-one', type: 'timer.finish', payload: {id: 'start-one', expected_revision: 1}}, stamp)!;
  const three = queue.enqueue({request_id: 'start-two', type: 'timer.start', payload: {title: 'Second', mode: 'stopwatch'}}, stamp)!;
  assert.equal(queue.state.sessions.find(session => session.status === 'running')?.id, 'start-two');
  const canonical = {...state(), sessions: [{...active(), id: 'server-one', task_id: null, revision: 1,
    started_at: '2026-10-05T09:00:03.000Z', active_since: '2026-10-05T09:00:03.000Z'}],
    intervals: [{id: 'real-interval', session_id: 'server-one', started_at: '2026-10-05T09:00:03.000Z', ended_at: null}]};
  first.resolve(receipt(sent[0], canonical, 'server-one')); await one; await flush();
  assert.equal(sent[1].payload.id, 'server-one'); assert.equal(sent[1].payload.expected_revision, 1);
  assert.equal(queue.state.sessions.find(session => session.status === 'running')?.id, 'start-two');
  assert.equal(queue.state.intervals[0].session_id, 'server-one');
  const finished = {...canonical, sessions: [{...canonical.sessions[0], status: 'finished' as const, active_since: null,
    finished_at: '2026-10-05T09:00:04.000Z', revision: 2}], intervals: [{...canonical.intervals[0], ended_at: '2026-10-05T09:00:04.000Z'}]};
  finish.resolve(receipt(sent[1], finished)); await two; await flush();
  assert.equal(sent[2].type, 'timer.start'); assert.equal(queue.state.sessions.find(session => session.status === 'running')?.id, 'start-two');
  const second = {...finished, sessions: [...finished.sessions, {...canonical.sessions[0], id: 'server-two'}]};
  next.resolve(receipt(sent[2], second, 'server-two')); await three;
  assert.equal(queue.state.sessions.find(session => session.status === 'running')?.id, 'server-two');
});

test('task deletion previews linked revisions and sends a queued finish with the canonical revision', async () => {
  const initial = {...state(), sessions: [active()], intervals: [{id: 'interval', session_id: sessionId, started_at: active().started_at, ended_at: null}]};
  const deletion = deferred<CommandResult>();const sent: QueuedCommand[] = [];
  const {queue} = harness(initial, async (command, minimal) => {sent.push(command);assert.equal(minimal, false);
    return sent.length === 1 ? deletion.promise : receipt(command, {...initial, tasks: [task(other)], sessions: [{...active(), task_id: null, status: 'finished', active_since: null, revision: 7}]});});
  const one = queue.enqueue({request_id: 'delete', type: 'task.delete', payload: {id, expected_revision: 1}}, stamp)!;
  assert.equal(queue.state.sessions[0].revision, 6);assert.equal(queue.state.sessions[0].task_id, null);
  const two = queue.enqueue({request_id: 'finish', type: 'timer.finish', payload: {id: sessionId, expected_revision: 6}}, stamp)!;
  deletion.resolve(receipt(sent[0], {...initial, tasks: [task(other)], sessions: [{...active(), task_id: null, revision: 6}]}));
  await one; await two;assert.equal(sent[1].payload.expected_revision, 6);
});

test('a definite failure cancels dependent work but keeps and sends independent optimistic work', async () => {
  const initial = {...state(), sessions: [active()], intervals: [{id: 'interval', session_id: sessionId, started_at: active().started_at, ended_at: null}]};
  const failure = deferred<CommandResult>(), independent = deferred<CommandResult>();const sent: QueuedCommand[] = [];
  const {queue, errors} = harness(initial, command => {sent.push(command);return sent.length === 1 ? failure.promise : independent.promise;}, async () => initial);
  const one = queue.enqueue({request_id: 'delete', type: 'task.delete', payload: {id, expected_revision: 1}}, stamp)!;
  const two = queue.enqueue({request_id: 'finish', type: 'timer.finish', payload: {id: sessionId, expected_revision: 6}}, stamp)!;
  const three = queue.enqueue({request_id: 'independent', type: 'task.update', payload: {id: other, expected_revision: 1, progress: 1}}, stamp)!;
  assert.equal(queue.state.tasks.find(row => row.id === other)?.progress, 1);
  failure.resolve(Promise.reject(new CommandRequestError('Conflict', 409)) as never);
  assert.equal(await one, false);assert.equal(await two, false);await flush();
  assert.equal(sent[1]?.request_id, 'independent');assert.equal(queue.state.tasks.find(row => row.id === other)?.progress, 1);
  independent.resolve(receipt(sent[1]));assert.equal(await three, true);assert.match(errors[0], /Bağlı 1 işlem/);
});

test('a stale modal revision is never replaced with an externally updated confirmed revision', async () => {
  const initial = state();initial.tasks[0].revision = 2;
  let sent!: QueuedCommand;
  const {queue} = harness(initial, async command => {sent = command;throw new CommandRequestError('Conflict', 409);});
  const done = queue.enqueue({request_id: 'stale', type: 'task.update', payload: {id, expected_revision: 1, title: 'Stale title'}}, stamp)!;
  assert.equal(await done, false);assert.equal(sent.payload.expected_revision, 1);assert.equal(queue.state.tasks[0].title, id);
});

test('unknown commit pauses all work and retries the exact ID and payload before resolving dependent timer IDs', async () => {
  const sent: {command: QueuedCommand; minimal: boolean}[] = [];
  const canonical = {...state(), sessions: [{...active(), id: 'server-id', task_id: null, revision: 1}],
    intervals: [{id: 'real', session_id: 'server-id', started_at: active().started_at, ended_at: null}]};
  const {queue} = harness(state(), async (command, minimal) => {
    sent.push({command: structuredClone(command), minimal});
    if (sent.length === 1) throw new CommandRequestError('Lost response', null);
    if (sent.length === 2) return {...receipt(command, canonical, 'server-id'), replayed: true};
    return receipt(command, {...canonical, sessions: [{...canonical.sessions[0], status: 'finished', active_since: null, revision: 2}]});
  });
  const one = queue.enqueue({request_id: 'start', type: 'timer.start', payload: {title: 'A', mode: 'stopwatch'}}, stamp)!;
  const two = queue.enqueue({request_id: 'finish', type: 'timer.finish', payload: {id: 'start', expected_revision: 1}}, stamp)!;
  await flush();assert.equal(queue.paused, true);assert.equal(sent.length, 1);
  await queue.retry();await one;await two;
  assert.deepEqual(sent[1].command, sent[0].command);assert.equal(sent[1].minimal, false);
  assert.equal(sent[2].command.payload.id, 'server-id');assert.equal(sent[2].command.payload.expected_revision, 1);
});

test('failed recovery keeps the retry action and disposed recovery never publishes late commits', async () => {
  const recovery = deferred<AppState | null>();let attempt = 0;
  const {queue, errors, commits} = harness(state(), async () => {throw new CommandRequestError('Rejected', 409);}, async () => ++attempt === 1 ? null : recovery.promise);
  queue.enqueue({request_id: 'bad', type: 'task.update', payload: {id, expected_revision: 1, progress: 1}}, stamp);
  queue.enqueue({request_id: 'next', type: 'task.update', payload: {id: other, expected_revision: 1, progress: 1}}, stamp);
  await flush();assert.equal(queue.paused, true);
  const retry = queue.retry();queue.dispose();recovery.resolve(state());await retry;assert.equal(commits.length, 0);
  assert.match(errors.at(-1)!, /yeniden dene/);
});

test('an expired countdown finish is verified from state and its queued next start is preserved', async () => {
  const before = {...active(), mode: 'countdown' as const, target_seconds: 60, accumulated_seconds: 0};
  const initial = {...state(), sessions: [before], intervals: [{id: 'interval', session_id: sessionId, started_at: before.started_at, ended_at: null}]};
  const latest = {...initial, sessions: [{...before, status: 'finished' as const, accumulated_seconds: 60, active_since: null,
    finished_at: '2026-10-05T08:01:00.000Z', revision: 6}]};
  const sent: QueuedCommand[] = [];
  const {queue} = harness(initial, async command => {sent.push(command);if (sent.length === 1) throw new CommandRequestError('Conflict', 409);
    return receipt(command, latest);}, async () => latest);
  const finish = queue.enqueue({request_id: 'finish', type: 'timer.finish', payload: {id: sessionId, expected_revision: 5}}, stamp)!;
  const start = queue.enqueue({request_id: 'start', type: 'timer.start', payload: {title: 'Next', mode: 'stopwatch'}}, stamp)!;
  assert.equal(await finish, true);assert.equal(await start, true);assert.equal(sent[1].type, 'timer.start');
});

test('an intent without an optimistic projection is queued and requires a canonical response', async () => {
  let minimal: boolean | undefined;
  const {queue} = harness(state(), async (command, preference) => {minimal = preference;return receipt(command, state());});
  assert.equal(await queue.enqueue({request_id: 'plan', type: 'plan.update', payload: {plan_date: '2026-10-05', expected_revision: 1, target_minutes: 40}}, stamp), true);
  assert.equal(minimal, false);
});

test('a failed move cancels the swapped task intent and a failed day mark cancels its removal', async () => {
  const initial = state();initial.tasks[1].position = 1;
  const held = deferred<CommandResult>();let sends = 0;
  const {queue} = harness(initial, async () => {sends++;return held.promise;});
  const move = queue.enqueue({request_id: 'move', type: 'task.move', payload: {id, expected_revision: 1, direction: 'down'}}, stamp)!;
  const swap = queue.enqueue({request_id: 'swap', type: 'task.update', payload: {id: other, expected_revision: 2, progress: 1}}, stamp)!;
  held.resolve(Promise.reject(new CommandRequestError('Conflict', 409)) as never);
  assert.equal(await move, false);assert.equal(await swap, false);assert.equal(sends, 1);
  const mark = harness(state(), async () => {throw new CommandRequestError('Rejected', 400);});
  const first = mark.queue.enqueue({request_id: 'mark', type: 'day.mark', payload: {mark_date: '2026-10-05', kind: 'rest'}}, stamp)!;
  const next = mark.queue.enqueue({request_id: 'unmark', type: 'day.unmark', payload: {id: 'mark', expected_revision: 1}}, stamp)!;
  assert.equal(await first, false);assert.equal(await next, false);assert.equal(mark.queue.state.day_marks.length, 0);
});

test('partial education projections preserve the clock and still request a full reconciliation', async () => {
  const initial = state(), partials: boolean[] = [], refreshes: boolean[] = [];
  const queue = createStudyCommandQueue(initial, {send: async command => ({...receipt(command, initial), partialState: true}),
    recover: async () => initial, change: () => {}, error: () => {}, committed: (_, partial) => {partials.push(Boolean(partial));},
    settled: (_, needsRefresh) => {refreshes.push(needsRefresh);}});
  assert.equal(await queue.enqueue({request_id: 'edu', type: 'education.results.batch', payload: {rows: []}}, stamp), true);
  assert.deepEqual(partials, [true]);assert.deepEqual(refreshes, [true]);assert.equal(queue.confirmed.server_now, stamp);
});

test('a repeated failed recovery keeps the paused queue and visible retry error', async () => {
  const {queue, errors} = harness(state(), async () => {throw new CommandRequestError('Rejected', 409);}, async () => null);
  queue.enqueue({request_id: 'bad', type: 'task.update', payload: {id, expected_revision: 1, progress: 1}}, stamp);
  queue.enqueue({request_id: 'independent', type: 'task.update', payload: {id: other, expected_revision: 1, progress: 1}}, stamp);
  await flush();await queue.retry();assert.equal(queue.paused, true);assert.equal(queue.count, 1);assert.match(errors.at(-1)!, /yeniden dene/);
});
