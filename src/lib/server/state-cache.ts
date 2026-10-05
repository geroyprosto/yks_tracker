import { createHash } from 'node:crypto';
import { Redis } from '@upstash/redis';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppState } from '../domain/types';

type CacheContext = { user_id: string; version: string; server_now: string };
type CacheEntry = { user_id: string; version: string; state: AppState };
export type StateCache = {
  get(key: string): Promise<unknown>;
  set(key: string, value: CacheEntry, options: { ex: number }): Promise<unknown>;
};
type CacheOptions = {
  cache?: StateCache | null;
  defer?: (work: () => Promise<void>) => void;
  /** Supplied only by a server authentication helper, never request input. */
  verifiedUserId?: string;
};

const ttlSeconds = 60;
let redis: Redis | null = null;
let credentials = '';
let unavailableUntil = 0;

function configuredCache(): StateCache | null {
  // Local simulators must never send their generated records to a live cache.
  if (process.env.CLASSROOM_DEMO_ENABLED === 'true' || Date.now() < unavailableUntil) return null;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  try { if (new URL(url).protocol !== 'https:') return null; } catch { return null; }
  const current = url + '\n' + token;
  if (current !== credentials) {
    redis = new Redis({ url, token, retry: false, signal: () => AbortSignal.timeout(250),
      enableAutoPipelining: false, enableTelemetry: false });
    credentials = current;
  }
  return redis;
}

function context(value: unknown): value is CacheContext {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CacheContext>;
  return typeof item.user_id === 'string' && /^[0-9a-f-]{36}$/i.test(item.user_id)
    && typeof item.version === 'string' && item.version.length > 0
    && typeof item.server_now === 'string' && Number.isFinite(Date.parse(item.server_now));
}

function entry(value: unknown, userId: string): value is CacheEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CacheEntry>;
  if (item.user_id !== userId || typeof item.version !== 'string' || !item.version || !item.state) return false;
  return ['tasks', 'topics', 'sessions', 'intervals', 'day_plans', 'topic_history',
    'practice_entries', 'exam_formats', 'exams', 'journal_entries', 'day_marks']
    .every(key => Array.isArray(item.state![key as keyof AppState]));
}

function cacheKey(userId: string) {
  const scope = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.VERCEL_ENV ?? 'development'].join('\n');
  const namespace = createHash('sha256').update(scope).digest('hex');
  return `yksim:state:v2:${userId}:${namespace}`;
}

/** The live database gate must accept the cached generation before it can be returned. */
export async function readStateWithCache(client: SupabaseClient, load: () => Promise<AppState>, options: CacheOptions = {}): Promise<AppState> {
  const userId = options.verifiedUserId;
  // Command responses retain their existing single-RPC path. Read routes supply
  // the identity they already verified, avoiding another Auth network request.
  if (!userId) return load();
  const cache = options.cache === undefined ? configuredCache() : options.cache;
  if (!cache) return load();
  const fail = () => { if (options.cache === undefined) unavailableUntil = Date.now() + 30_000; };
  let cached: CacheEntry | null = null;
  try {
    const value = await cache.get(cacheKey(userId));
    if (entry(value, userId)) cached = value;
  } catch { fail(); return load(); }

  let snapshot;
  try { snapshot = await client.rpc('yks_state_cache_snapshot', { p_known_version: cached?.version ?? null }); } catch { return load(); }
  // This RPC authorizes, initializes today's plan and settles expired timers.
  // It projects full state on a miss in the same round trip as the live check.
  if (snapshot.error || !context(snapshot.data) || snapshot.data.user_id !== userId) return load();
  if (!('state' in snapshot.data)) return load();
  if (snapshot.data.state === null) {
    if (!cached || cached.version !== snapshot.data.version) return load();
    return { ...cached.state, configured: true, authenticated: true, server_now: snapshot.data.server_now };
  }
  if (!entry(snapshot.data, userId)) return load();
  const value: CacheEntry = { user_id: snapshot.data.user_id, version: snapshot.data.version, state: snapshot.data.state };
  const save = async () => {
    try { await cache.set(cacheKey(userId), value, { ex: ttlSeconds }); } catch { fail(); }
  };
  // Cache population never delays a durable save or its full-state response.
  if (options.defer) options.defer(save); else await save();
  return { ...value.state, configured: true, authenticated: true, server_now: snapshot.data.server_now };
}
