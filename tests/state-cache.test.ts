import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { emptyState, type AppState } from '../src/lib/domain/types';
import { emptyEducation } from '../src/lib/education';
import { readStateWithCache, type StateCache } from '../src/lib/server/state-cache';

const userId = '10000000-0000-4000-8000-000000000001';
const otherId = '20000000-0000-4000-8000-000000000002';
const storedAt = '2026-10-05T11:00:00.000Z';
const checkedAt = '2026-10-05T11:00:05.000Z';
type Reply = { data: unknown; error: { message: string; code?: string } | null };
type CachedState = Parameters<StateCache['set']>[1];

function state(label = 'cached'): AppState {
  return {
    ...emptyState(true), authenticated: true, server_now: storedAt,
    settings: {
      display_name: label, exam_year: 2027, exam_date: null, target_rank: 15000,
      timezone: 'Europe/Istanbul', daily_target_minutes: 120, task_share: 0.65,
      difficulty_factors: { easy: 1, medium: 1.25, hard: 1.5 },
      weekday_targets: [120, 120, 120, 120, 120, 180, 60], theme: 'ocean',
      appearance: 'system', reduced_motion: false, simple_view: true,
      journal_analysis_enabled: false, revision: 4,
    },
    manual_study_entries: [{
      id: 'manual-1', course_id: null, study_date: '2026-10-05', subject: 'Matematik',
      duration_seconds: 900, created_at: storedAt,
    }],
    education: { ...emptyEducation(), needs_onboarding: true },
  };
}

function context(version = '1', id = userId, now = checkedAt) {
  return { user_id: id, version, server_now: now };
}

function success(data: unknown): Reply { return { data, error: null }; }

function snapshot(value: AppState, version = '1', id = userId): Reply {
  return success({ ...context(version, id), state: value });
}

function rpc(replies: Array<Reply | Error>, events: string[] = []) {
  const calls: string[] = [];
  const arguments_: Array<Record<string, unknown> | undefined> = [];
  const client = { rpc: async (name: string, args?: Record<string, unknown>) => {
    calls.push(name);
    arguments_.push(args);
    events.push(name);
    const next = replies.shift();
    assert.ok(next, `Unexpected database RPC: ${name}`);
    if (next instanceof Error) throw next;
    return next;
  } } as unknown as SupabaseClient;
  return { client, calls, arguments_ };
}

function memoryCache() {
  const entries = new Map<string, CachedState>();
  const reads: string[] = [];
  const writes: Array<{ key: string; value: CachedState; ttl: number }> = [];
  const cache: StateCache = {
    get: async key => { reads.push(key); return entries.get(key) ?? null; },
    set: async (key, value, options) => {
      entries.set(key, structuredClone(value));
      writes.push({ key, value: structuredClone(value), ttl: options.ex });
    },
  };
  return { cache, entries, reads, writes };
}

function neverLoad(): Promise<AppState> { throw new Error('Full projection should not run'); }

test('a cache hit requires one live database check and refreshes server time without projecting full state', async () => {
  const events: string[] = [];
  const cached = state();
  const before = structuredClone(cached);
  const db = rpc([success({ ...context(), state: null })], events);
  const cache: StateCache = {
    get: async () => { events.push('cache.get'); return { user_id: userId, version: '1', state: cached }; },
    set: async () => { throw new Error('A hit must not repopulate the cache'); },
  };

  const result = await readStateWithCache(db.client, neverLoad, { cache, verifiedUserId: userId });

  assert.deepEqual(events, ['cache.get', 'yks_state_cache_snapshot']);
  assert.deepEqual(db.calls, ['yks_state_cache_snapshot']);
  assert.deepEqual(db.arguments_, [{ p_known_version: '1' }]);
  assert.deepEqual(result, { ...before, server_now: checkedAt });
  assert.deepEqual(cached, before, 'Refreshing response time must not mutate cached data');
});

test('a cold cache miss obtains and caches the full state in one database round trip', async () => {
  const cache = memoryCache();
  const durable = state('first state read');
  const db = rpc([snapshot(durable)]);

  assert.deepEqual(await readStateWithCache(db.client, neverLoad, { cache: cache.cache, verifiedUserId: userId }),
    { ...durable, server_now: checkedAt });
  assert.deepEqual(db.calls, ['yks_state_cache_snapshot']);
  assert.deepEqual(db.arguments_, [{ p_known_version: null }]);
  assert.equal(cache.writes.length, 1);
  assert.equal(cache.writes[0].key, cache.reads[0]);
  assert.deepEqual(cache.writes[0].value, { user_id: userId, version: '1', state: durable });
  assert.ok(cache.writes[0].ttl > 0, 'The projection must expire');
});

test('a live version change replaces the stable user entry and users have separate keys', async () => {
  const cache = memoryCache();
  const initial = state('initial');
  const changed = state('changed');
  const other = state('another student');
  const db = rpc([
    snapshot(initial),
    success({ ...context(), state: null }),
    snapshot(changed, '2'),
    snapshot(other, '1', otherId),
    success({ ...context('2'), state: null }),
  ]);

  const results: AppState[] = [];
  for (const verifiedUserId of [userId, userId, userId, otherId, userId]) {
    results.push(await readStateWithCache(db.client, neverLoad, { cache: cache.cache, verifiedUserId }));
  }

  assert.deepEqual(results.map(value => value.settings?.display_name), [
    'initial', 'initial', 'changed', 'another student', 'changed',
  ]);
  assert.equal(cache.reads[0], cache.reads[1]);
  assert.equal(cache.reads[0], cache.reads[2], 'A new generation must replace the stable user entry');
  assert.notEqual(cache.reads[0], cache.reads[3], 'A different user must not reuse another student key');
  assert.equal(cache.reads[0], cache.reads[4]);
  assert.equal(cache.entries.size, 2);
  assert.deepEqual(db.calls, Array(5).fill('yks_state_cache_snapshot'));
  assert.deepEqual(db.arguments_, [
    { p_known_version: null }, { p_known_version: '1' }, { p_known_version: '1' },
    { p_known_version: null }, { p_known_version: '2' },
  ]);
  assert.ok(cache.writes.every(write => write.ttl > 0), 'Snapshots must expire');
});

test('an older deferred write cannot make later reads stale because the database verifies each generation', async () => {
  const cache = memoryCache();
  const old = state('old projection');
  const committed = state('newly committed');
  const db = rpc([
    snapshot(old), snapshot(committed, '2'), snapshot(committed, '2'),
    success({ ...context('2'), state: null }),
  ]);
  const work: Array<() => Promise<void>> = [];
  const options = { cache: cache.cache, verifiedUserId: userId, defer: (save: () => Promise<void>) => work.push(save) };

  await readStateWithCache(db.client, neverLoad, options);
  assert.deepEqual(await readStateWithCache(db.client, neverLoad, options),
    { ...committed, server_now: checkedAt });
  await work[1]();
  await work[0]();
  assert.deepEqual(cache.writes.map(write => write.value.version), ['2', '1']);
  assert.equal(cache.writes[0].key, cache.writes[1].key);

  assert.deepEqual(await readStateWithCache(db.client, neverLoad, { cache: cache.cache, verifiedUserId: userId }),
    { ...committed, server_now: checkedAt });
  assert.deepEqual(await readStateWithCache(db.client, neverLoad, { cache: cache.cache, verifiedUserId: userId }),
    { ...committed, server_now: checkedAt });
  assert.deepEqual(db.calls, Array(4).fill('yks_state_cache_snapshot'));
  assert.deepEqual(db.arguments_, [
    { p_known_version: null }, { p_known_version: null }, { p_known_version: '1' }, { p_known_version: '2' },
  ]);
});

test('denied or failed database authorization cannot serve an existing cache entry', async () => {
  for (const reply of [
    { data: context(), error: { message: 'ACCESS_DENIED', code: '42501' } },
    new Error('Database unavailable'),
  ]) {
    const db = rpc([reply]);
    let reads = 0;
    const cache: StateCache = {
      get: async () => { reads++; return { user_id: userId, version: '1', state: state() }; },
      set: async () => { throw new Error('Denied requests cannot write the cache'); },
    };
    const denied = new Error('Durable state authorization denied');

    await assert.rejects(readStateWithCache(db.client, async () => { throw denied; }, { cache, verifiedUserId: userId }),
      error => error === denied);
    assert.equal(reads, 1, 'A prior Redis read must not bypass the failed authorization check');
    assert.deepEqual(db.calls, ['yks_state_cache_snapshot']);
    assert.deepEqual(db.arguments_, [{ p_known_version: '1' }]);
  }
});

test('an absent cache migration falls back to the existing database state loader', async () => {
  const db = rpc([{ data: null, error: { code: 'PGRST202', message: 'Function not found' } }]);
  const cache = memoryCache();
  const durable = state('durable');
  let loads = 0;

  const result = await readStateWithCache(db.client, async () => { loads++; return durable; },
    { cache: cache.cache, verifiedUserId: userId });

  assert.equal(result, durable);
  assert.equal(loads, 1);
  assert.equal(cache.reads.length, 1);
  assert.deepEqual(cache.writes, []);
  assert.deepEqual(db.calls, ['yks_state_cache_snapshot']);
});

test('malformed cache context cannot bypass the durable loader', async () => {
  for (const malformed of [null, { ...context(), user_id: 'invalid' }, { ...context(), version: '' },
    { ...context(), server_now: 'not a date' }, { ...context(), user_id: otherId }]) {
    const db = rpc([success(malformed)]);
    const cache = memoryCache();
    const durable = state('durable');

    assert.equal(await readStateWithCache(db.client, async () => durable,
      { cache: cache.cache, verifiedUserId: userId }), durable);
    assert.equal(cache.reads.length, 1);
    assert.deepEqual(cache.writes, []);
  }
});

test('a Redis read failure falls back to durable state without requiring the snapshot RPC', async () => {
  const db = rpc([]);
  const durable = state('durable during outage');
  const cache: StateCache = {
    get: async () => { throw new Error('Redis timeout'); },
    set: async () => { throw new Error('An unavailable cache cannot be populated'); },
  };

  assert.equal(await readStateWithCache(db.client, async () => durable, { cache, verifiedUserId: userId }), durable);
  assert.deepEqual(db.calls, []);
});

test('a Redis write failure preserves the successful database snapshot response', async () => {
  const durable = state('committed');
  const db = rpc([snapshot(durable)]);
  const cache: StateCache = {
    get: async () => null,
    set: async () => { throw new Error('Redis unavailable'); },
  };

  assert.deepEqual(await readStateWithCache(db.client, neverLoad, { cache, verifiedUserId: userId }),
    { ...durable, server_now: checkedAt });
});

test('deferred cache population lets the response complete before a slow Redis write', async () => {
  const durable = state('response already ready');
  const db = rpc([snapshot(durable)]);
  const work: Array<() => Promise<void>> = [];
  let writes = 0;
  let release: () => void = () => { throw new Error('Write has not started'); };
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const cache: StateCache = {
    get: async () => null,
    set: async () => { writes++; await blocked; },
  };

  const response = await readStateWithCache(db.client, neverLoad,
    { cache, verifiedUserId: userId, defer: save => work.push(save) });

  assert.deepEqual(response, { ...durable, server_now: checkedAt });
  assert.equal(writes, 0, 'Returning state must not wait for or start the deferred write');
  assert.equal(work.length, 1);
  let saved = false;
  const pending = work[0]().then(() => { saved = true; });
  await Promise.resolve();
  assert.equal(writes, 1);
  assert.equal(saved, false);
  release();
  await pending;
  assert.equal(saved, true);
});

test('corrupt or mismatched cache entries are replaced by the authorized database snapshot', async () => {
  const durable = state('fresh from database');
  const stale = state('must not escape');
  const entries: unknown[] = [
    null, 'not a state', {},
    { user_id: otherId, version: '1', state: stale },
    { user_id: userId, version: '', state: stale },
    { user_id: userId, version: 1, state: stale },
    { user_id: userId, version: '1', state: { ...stale, tasks: null } },
    { user_id: userId, version: '1', state: { ...stale, sessions: {} } },
    { user_id: userId, version: '1', state: { ...stale, journal_entries: undefined } },
  ];
  for (const cached of entries) {
    const db = rpc([snapshot(durable)]);
    const writes: CachedState[] = [];
    const cache: StateCache = {
      get: async () => cached,
      set: async (_key, value) => { writes.push(value); },
    };

    assert.deepEqual(await readStateWithCache(db.client, neverLoad, { cache, verifiedUserId: userId }),
      { ...durable, server_now: checkedAt });
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].state, durable);
    assert.deepEqual(db.calls, ['yks_state_cache_snapshot']);
    assert.deepEqual(db.arguments_, [{ p_known_version: null }]);
  }
});

test('a failed or malformed snapshot uses the durable loader and never populates Redis', async () => {
  for (const badSnapshot of [
    { data: null, error: { message: 'Snapshot unavailable' } },
    new Error('Snapshot request failed'),
    success({ ...context(), state: { ...state(), topics: null } }),
  ]) {
    const db = rpc([badSnapshot]);
    const cache = memoryCache();
    const durable = state('fallback');

    assert.equal(await readStateWithCache(db.client, async () => durable,
      { cache: cache.cache, verifiedUserId: userId }), durable);
    assert.deepEqual(cache.writes, []);
  }
});

test('a disabled cache directly uses the durable loader without additional cache RPCs', async () => {
  const db = rpc([]);
  const durable = state('no cache configured');

  assert.equal(await readStateWithCache(db.client, async () => durable, { cache: null, verifiedUserId: userId }), durable);
  assert.deepEqual(db.calls, []);
});

test('null-state responses cannot serve a missing cache or a mismatched user or generation', async () => {
  const scenarios = [
    { cached: null, reply: { ...context(), state: null } },
    { cached: { user_id: userId, version: '1', state: state('stale') }, reply: { ...context('2'), state: null } },
    { cached: { user_id: userId, version: '1', state: state('private') }, reply: { ...context('1', otherId), state: null } },
  ];
  for (const scenario of scenarios) {
    const db = rpc([success(scenario.reply)]);
    const durable = state('authorized fallback');
    let writes = 0;
    const cache: StateCache = {
      get: async () => scenario.cached,
      set: async () => { writes++; },
    };

    assert.equal(await readStateWithCache(db.client, async () => durable, { cache, verifiedUserId: userId }), durable);
    assert.equal(writes, 0);
    assert.deepEqual(db.calls, ['yks_state_cache_snapshot']);
  }
});

test('a caller without a server-verified identity uses the original loader without Redis or extra RPCs', async () => {
  const db = rpc([]);
  const durable = state('direct caller');
  const cache: StateCache = {
    get: async () => { throw new Error('Unverified callers must not touch Redis'); },
    set: async () => { throw new Error('Unverified callers must not populate Redis'); },
  };
  let loads = 0;

  assert.equal(await readStateWithCache(db.client, async () => { loads++; return durable; }, { cache }), durable);
  assert.equal(loads, 1);
  assert.deepEqual(db.calls, []);
});
