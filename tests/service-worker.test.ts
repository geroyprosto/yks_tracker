import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const workerSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const origin = 'https://yks.example';
const offlineHtml = '<h1>Connection unavailable</h1>';

type WorkerEvent = {
  request?: Request;
  respondWith?: (response: Promise<Response>) => void;
  waitUntil?: (work: Promise<unknown>) => void;
};

function worker(replies: Array<Response | Error>, online = true) {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const requests: Array<{ request: Request; init?: RequestInit }> = [];
  const cacheNames = new Set(['yksim-shell-v0', 'yksim-shell-v1', 'another-app-cache']);
  const cachedAssets: string[] = [];
  const cacheReads: string[] = [];
  let claimed = false;
  const cache = {
    addAll: async (assets: string[]) => { cachedAssets.push(...assets); },
    match: async (path: string) => {
      cacheReads.push(path);
      return path === '/offline.html' ? new Response(offlineHtml) : undefined;
    },
    put: async () => { assert.fail('Navigation and private responses must not be cached'); },
  };
  const navigator = { onLine: online };
  runInNewContext(workerSource, {
    self: {
      location: { origin }, navigator,
      addEventListener: (name: string, listener: (event: WorkerEvent) => void) => listeners.set(name, listener),
      skipWaiting: async () => {},
      clients: { claim: async () => { claimed = true; } },
    },
    navigator,
    URL, Request, Response, Headers,
    setTimeout: (callback: () => void) => { queueMicrotask(callback); return 1; },
    clearTimeout: () => {},
    fetch: async (request: Request, init?: RequestInit) => {
      requests.push({ request, init });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      if (!reply) throw new TypeError('Connection unavailable');
      return reply;
    },
    caches: {
      open: async (name: string) => { cacheNames.add(name); return cache; },
      keys: async () => [...cacheNames],
      delete: async (name: string) => cacheNames.delete(name),
      match: cache.match,
    },
  });
  return {
    requests, cacheNames, cachedAssets, cacheReads,
    get claimed() { return claimed; },
    navigate(path = '/?page=friends', method = 'GET', mode = 'navigate'): Promise<Response> | undefined {
      const request = new Request(new URL(path, origin), { method });
      Object.defineProperty(request, 'mode', { value: mode });
      let response: Promise<Response> | undefined;
      listeners.get('fetch')!({ request, respondWith: result => { response = result; } });
      return response;
    },
    async lifecycle(name: 'install' | 'activate') {
      let work: Promise<unknown> | undefined;
      listeners.get(name)!({ waitUntil: result => { work = result; } });
      await work;
    },
  };
}

for (const failures of [1, 2]) {
  test(`navigation recovers after ${failures} temporary connection failure(s) without showing offline HTML`, async () => {
    const dashboard = new Response('<h1>Workspace</h1>');
    const subject = worker([
      ...Array.from({ length: failures }, () => new TypeError('Temporary connection failure')),
      dashboard,
    ]);

    const response = await subject.navigate();
    assert.equal(await response?.text(), '<h1>Workspace</h1>');
    assert.equal(subject.requests.length, failures + 1);
    assert.ok(subject.requests.every(({ request }) => request.url === `${origin}/?page=friends`));
    assert.deepEqual(subject.cacheReads, []);
    assert.deepEqual(subject.cachedAssets, []);
  });
}

test('repeated connection failures stop retrying and return the offline page', async () => {
  const subject = worker([]);
  const response = await subject.navigate();

  assert.equal(await response?.text(), offlineHtml);
  assert.equal(subject.requests.length, 3);
  assert.deepEqual(subject.cacheReads, ['/offline.html']);
});

test('a browser known to be offline receives the fallback without repeated network attempts', async () => {
  const subject = worker([], false);
  const response = await subject.navigate();

  assert.equal(await response?.text(), offlineHtml);
  assert.equal(subject.requests.length, 1);
});

test('an HTTP server error stays a server error and is neither retried nor called offline', async () => {
  const unavailable = new Response('Temporarily unavailable', { status: 503 });
  const subject = worker([unavailable]);

  const response = await subject.navigate();
  assert.equal(response?.status, 503);
  assert.equal(await response?.text(), 'Temporarily unavailable');
  assert.equal(subject.requests.length, 1);
  assert.deepEqual(subject.cacheReads, []);
});

for (const request of [
  { name: 'POST navigation', path: '/', method: 'POST', mode: 'navigate' },
  { name: 'ordinary fetch', path: '/', method: 'GET', mode: 'cors' },
  { name: 'API navigation', path: '/api/state', method: 'GET', mode: 'navigate' },
  { name: 'authentication navigation', path: '/auth/callback?code=one-time-code', method: 'GET', mode: 'navigate' },
  { name: 'another origin', path: 'https://another.example/', method: 'GET', mode: 'navigate' },
]) {
  test(`${request.name} bypasses navigation retry and offline substitution`, () => {
    const subject = worker([]);

    assert.equal(subject.navigate(request.path, request.method, request.mode), undefined);
    assert.deepEqual(subject.requests, []);
    assert.deepEqual(subject.cacheReads, []);
  });
}

test('activation removes obsolete YKSim shells while preserving unrelated caches', async () => {
  const subject = worker([]);
  await subject.lifecycle('install');
  await subject.lifecycle('activate');

  assert.ok(subject.cacheNames.has('another-app-cache'));
  assert.ok(!subject.cacheNames.has('yksim-shell-v0'));
  assert.ok(!subject.cacheNames.has('yksim-shell-v1'));
  assert.equal([...subject.cacheNames].filter(name => name.startsWith('yksim-shell-')).length, 1);
  assert.ok(subject.cachedAssets.includes('/offline.html'));
  assert.ok(subject.cachedAssets.every(path => path === '/offline.html' || /^\/icon-\d+\.png$/.test(path)));
  assert.equal(subject.claimed, true);
});
