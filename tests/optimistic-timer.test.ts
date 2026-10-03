import assert from 'node:assert/strict';
import test from 'node:test';
import {emptyState, type AppState, type StudySession} from '../src/lib/domain/types';
import {optimisticTimerFinish} from '../src/lib/optimistic-timer';
import {secondsByDay} from '../src/lib/timing';

const started = '2026-10-03T09:00:00.000Z';
const id = '11111111-1111-4111-8111-111111111111';

function session(changes: Partial<StudySession> = {}): StudySession {
  return {id, title: 'AYT Fizik', task_id: null, topic_id: null, subject: 'AYT Fizik',
    study_type: 'Konu anlatımı', mode: 'stopwatch', target_seconds: null, status: 'running',
    started_at: started, active_since: started, accumulated_seconds: 0,
    finished_at: null, revision: 3, ...changes};
}

function state(active = session()): AppState {
  return {...emptyState(true), authenticated: true, server_now: started,
    sessions: [active], intervals: [{id: 'interval-1', session_id: id, started_at: started, ended_at: null}]};
}

test('finishing a running timer closes its interval and previews the saved study total', () => {
  const original = state();
  const preview = optimisticTimerFinish(original, {id, expected_revision: 3}, '2026-10-03T09:02:06.987Z');
  assert.equal(preview?.sessions[0].status, 'finished');
  assert.equal(preview?.sessions[0].accumulated_seconds, 126);
  assert.equal(preview?.sessions[0].finished_at, '2026-10-03T09:02:06.000Z');
  assert.equal(preview?.sessions[0].active_since, null);
  assert.equal(preview?.sessions[0].revision, 4);
  assert.equal(preview?.intervals[0].ended_at, '2026-10-03T09:02:06.000Z');
  assert.equal(secondsByDay(preview!, 'Europe/Istanbul')['2026-10-03'], 126);
  assert.equal(original.sessions[0].status, 'running');
  assert.equal(original.intervals[0].ended_at, null);
});

test('finishing a paused timer keeps its prior intervals and does not count the break', () => {
  const original = state(session({status: 'paused', active_since: null, accumulated_seconds: 60}));
  original.intervals[0].ended_at = '2026-10-03T09:01:00.000Z';
  const preview = optimisticTimerFinish(original, {id, expected_revision: 3}, '2026-10-03T09:10:00.000Z');
  assert.equal(preview?.sessions[0].status, 'finished');
  assert.equal(preview?.sessions[0].accumulated_seconds, 60);
  assert.equal(preview?.intervals[0].ended_at, '2026-10-03T09:01:00.000Z');
});

test('a countdown that passed its target stops at the target timestamp and duration', () => {
  const original = state(session({mode: 'countdown', target_seconds: 180}));
  const preview = optimisticTimerFinish(original, {id, expected_revision: 3}, '2026-10-03T09:20:00.000Z');
  assert.equal(preview?.sessions[0].finished_at, '2026-10-03T09:03:00.000Z');
  assert.equal(preview?.sessions[0].accumulated_seconds, 180);
  assert.equal(preview?.intervals[0].ended_at, '2026-10-03T09:03:00.000Z');
  assert.equal(secondsByDay(preview!, 'Europe/Istanbul')['2026-10-03'], 180);
});

test('a running session with a missing open interval still previews its active time', () => {
  const original = state();
  original.intervals = [];
  const preview = optimisticTimerFinish(original, {id, expected_revision: 3}, '2026-10-03T09:01:00.000Z');
  assert.equal(preview?.sessions[0].accumulated_seconds, 60);
  assert.equal(preview?.intervals[0].started_at, started);
  assert.equal(preview?.intervals[0].ended_at, '2026-10-03T09:01:00.000Z');
  assert.equal(secondsByDay(preview!, 'Europe/Istanbul')['2026-10-03'], 60);
  assert.equal(original.intervals.length, 0);
});

test('confirmed net seconds trim the newest intervals backward without changing old state', () => {
  const original = state(session({active_since: '2026-10-03T09:20:00.000Z', accumulated_seconds: 600}));
  original.intervals[0].ended_at = '2026-10-03T09:10:00.000Z';
  original.intervals.push({id: 'interval-2', session_id: id, started_at: '2026-10-03T09:20:00.000Z', ended_at: null});
  const preview = optimisticTimerFinish(original, {id, expected_revision: 3, confirmed_seconds: 720}, '2026-10-03T09:25:00.000Z');
  assert.equal(preview?.sessions[0].accumulated_seconds, 720);
  assert.equal(preview?.intervals[0].ended_at, '2026-10-03T09:10:00.000Z');
  assert.equal(preview?.intervals[1].ended_at, '2026-10-03T09:22:00.000Z');
  assert.equal(original.intervals[1].ended_at, null);
});

test('confirmation can trim through multiple intervals without making one negative', () => {
  const original = state(session({active_since: '2026-10-03T09:20:00.000Z', accumulated_seconds: 600}));
  original.intervals[0].ended_at = '2026-10-03T09:10:00.000Z';
  original.intervals.push({id: 'interval-2', session_id: id, started_at: '2026-10-03T09:20:00.000Z', ended_at: null});
  const preview = optimisticTimerFinish(original, {id, expected_revision: 3, confirmed_seconds: 300}, '2026-10-03T09:25:00.000Z');
  assert.equal(preview?.sessions[0].accumulated_seconds, 300);
  assert.equal(preview?.intervals[0].ended_at, '2026-10-03T09:05:00.000Z');
  assert.equal(preview?.intervals[1].ended_at, '2026-10-03T09:20:00.000Z');
});

test('stale, invalid and unreviewed long timer finishes keep the authoritative state', () => {
  const original = state();
  assert.equal(optimisticTimerFinish(original, {id, expected_revision: 2}, '2026-10-03T09:02:00.000Z'), null);
  assert.equal(optimisticTimerFinish(original, {id, expected_revision: 3, confirmed_seconds: 121}, '2026-10-03T09:02:00.000Z'), null);
  assert.equal(optimisticTimerFinish(original, {id, expected_revision: 3, confirmed_seconds: -1}, '2026-10-03T09:02:00.000Z'), null);
  assert.equal(optimisticTimerFinish(original, {id, expected_revision: 3}, 'invalid'), null);
  const long = state();
  assert.equal(optimisticTimerFinish(long, {id, expected_revision: 3}, '2026-10-03T15:00:01.000Z'), null);
});
