import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';

test('only retired photo URLs bypass session refresh in the API proxy', async t => {
  const fixture = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://photo-retirement.example.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
    ALLOWED_USER_EMAIL: 'owner@example.test',
  };
  const previous = Object.fromEntries(Object.keys(fixture).map(key => [key, process.env[key]]));
  Object.assign(process.env, fixture);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const network = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Photo retirement must not refresh a Supabase session');
  });

  for (const method of ['GET', 'PUT', 'DELETE']) {
    for (const path of ['/api/profile/photo', '/api/friends/legacy-user/photo?v=1']) {
      const request = new NextRequest(`https://example.test${path}`, { method });
      const cookies = t.mock.method(request.cookies, 'getAll', () => {
        throw new Error('Retired photo URLs must bypass session cookies');
      });
      const response = await proxy(request);
      assert.equal(response.headers.get('x-middleware-next'), '1');
      assert.equal(response.headers.get('cache-control'), null);
      assert.equal(cookies.mock.callCount(), 0);
    }
  }

  for (const path of ['/api/state', '/api/profile/photos', '/api/profile/photo/extra', '/api/friends/user/photo/extra', '/api/friends/user/other/photo']) {
    const request = new NextRequest(`https://example.test${path}`);
    const cookies = t.mock.method(request.cookies, 'getAll', () => []);
    const response = await proxy(request);
    assert.ok(cookies.mock.callCount() > 0, `${path} must retain normal session refresh`);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal(network.mock.callCount(), 0);
});
