import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET, PUT, DELETE } from '../src/app/api/profile/photo/route';
import { GET as friendPhoto } from '../src/app/api/friends/[userId]/photo/route';

const removed = {
  ok: false,
  error: { code: 'PROFILE_PHOTOS_REMOVED', message: 'Profil fotoğrafı özelliği kaldırıldı.' },
};

test('legacy photo reads, uploads and deletes terminate without auth, request parsing or network access', async t => {
  const network = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Retired photos must not contact auth or Storage');
  });
  const untouched = new Proxy({}, {
    get() { throw new Error('Retired photos must not inspect requests, user IDs or uploaded bodies'); },
  });

  for (const handler of [GET, PUT, DELETE, friendPhoto]) {
    const response = await Reflect.apply(handler, undefined, [untouched, untouched]);
    assert.equal(response.status, 410);
    assert.equal(response.ok, false);
    assert.deepEqual(await response.json(), removed);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
  }
  assert.equal(network.mock.callCount(), 0);
});

test('an old uploader receives a terminal failure without consuming its file stream', async () => {
  const request = new Request('https://example.test/api/profile/photo', {
    method: 'PUT',
    headers: { 'Content-Type': 'image/webp', 'Content-Length': '999999999' },
    body: new Uint8Array([1, 2, 3]),
  });
  const response = await Reflect.apply(PUT, undefined, [request]);
  assert.equal(response.status, 410);
  assert.equal(request.bodyUsed, false);
  assert.deepEqual([...new Uint8Array(await request.arrayBuffer())], [1, 2, 3]);
});
