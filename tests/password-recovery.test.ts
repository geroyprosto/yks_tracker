import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../src/lib/server/http';
import { authOrigin, createRecoveryLimiter, recoveryEmailSchema, recoveryPasswordSchema, recoveryNotice, recoveryUser, requestPasswordRecovery, updateRecoveredPassword, verifyAuthCallback } from '../src/lib/server/password-recovery';
import { POST as forgotPassword } from '../src/app/api/forgot-password/route';
import { POST as resetPassword } from '../src/app/api/reset-password/route';

const confirmedUser = { id: 'user-id', email_confirmed_at: '2026-09-26T00:00:00Z', user_metadata: { status: 'approved', requested_role: 'admin' } };
function fakeClient(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; input?: unknown }> = [];
  const auth = {
    getUser: async () => { calls.push({ method: 'getUser' }); return { data: { user: confirmedUser }, error: null }; },
    resetPasswordForEmail: async (email: string, options: unknown) => { calls.push({ method: 'resetPasswordForEmail', input: { email, options } }); return { data: {}, error: null }; },
    updateUser: async (input: unknown) => { calls.push({ method: 'updateUser', input }); return { data: { user: confirmedUser }, error: null }; },
    signOut: async (input: unknown) => { calls.push({ method: 'signOut', input }); return { error: null }; },
    exchangeCodeForSession: async (input: unknown) => { calls.push({ method: 'exchangeCodeForSession', input }); return { data: { user: confirmedUser, redirectType: null }, error: null }; },
    verifyOtp: async (input: unknown) => { calls.push({ method: 'verifyOtp', input }); return { data: { user: confirmedUser }, error: null }; },
    ...overrides,
  };
  return { client: { auth } as unknown as Pick<SupabaseClient, 'auth'>, calls };
}

test('recovery validates password boundaries and normalizes only the email', () => {
  assert.equal(recoveryEmailSchema.parse({ email: ' Name@Example.com ' }).email, 'name@example.com');
  assert.equal(recoveryPasswordSchema.safeParse({ password: 'a'.repeat(9) }).success, false);
  assert.equal(recoveryPasswordSchema.safeParse({ password: 'a'.repeat(129) }).success, false);
  assert.equal(recoveryPasswordSchema.safeParse({ password: 'a'.repeat(10) }).success, true);
  assert.equal(recoveryPasswordSchema.safeParse({ password: 'a'.repeat(128) }).success, true);
  assert.equal(recoveryPasswordSchema.safeParse({ password: 'valid-password', user_id: 'other-user' }).success, false);
  assert.equal(recoveryPasswordSchema.parse({ password: '  valid-password  ' }).password, '  valid-password  ');
});

test('recovery email responses do not disclose unknown accounts, throttling or provider outages', async () => {
  const expected = { ok: true, message: recoveryNotice };
  const valid = fakeClient();
  assert.deepEqual(await requestPasswordRecovery(valid.client, 'name@example.com', 'https://study.example.com'), expected);
  assert.deepEqual(valid.calls, [{ method: 'resetPasswordForEmail', input: { email: 'name@example.com', options: { redirectTo: 'https://study.example.com/auth/callback?type=recovery' } } }]);
  for (const error of [{ code: 'user_not_found' }, { code: 'over_email_send_rate_limit' }]) {
    const { client } = fakeClient({ resetPasswordForEmail: async () => ({ data: null, error }) });
    assert.deepEqual(await requestPasswordRecovery(client, 'missing@example.com', 'https://study.example.com'), expected);
  }
  const { client } = fakeClient({ resetPasswordForEmail: async () => { throw new Error('sensitive provider detail'); } });
  assert.deepEqual(await requestPasswordRecovery(client, 'missing@example.com', 'https://study.example.com'), expected);
});

test('supplemental recovery throttling normalizes addresses, expires and bounds memory', () => {
  const allow = createRecoveryLimiter();
  assert.equal(allow('Name@example.com', 1), true);
  assert.equal(allow('name@example.com', 2), true);
  assert.equal(allow(' NAME@example.com ', 3), true);
  assert.equal(allow('name@example.com', 4), false);
  assert.equal(allow('other@example.com', 4), true);
  assert.equal(allow('name@example.com', 900001), true);
  const bounded = createRecoveryLimiter();
  for (let i = 0; i < 1000; i++) assert.equal(bounded(`user${i}@example.com`, 1), true);
  assert.equal(bounded('overflow@example.com', 2), false);
  assert.equal(bounded('overflow@example.com', 900001), true);
});

test('password reset authenticates with getUser before updating only the current account and signs out globally', async () => {
  const { client, calls } = fakeClient();
  assert.deepEqual(await updateRecoveredPassword(client, 'new-password-123'), { ok: true, signedOut: true, redirect: '/' });
  assert.deepEqual(calls, [{ method: 'getUser' }, { method: 'updateUser', input: { password: 'new-password-123' } }, { method: 'signOut', input: { scope: 'global' } }]);
  for (const reply of [{ data: { user: null }, error: null }, { data: { user: confirmedUser }, error: { message: 'revoked session' } }, { data: { user: { ...confirmedUser, email_confirmed_at: undefined } }, error: null }]) {
    const denied = fakeClient({ getUser: async () => reply });
    await assert.rejects(() => updateRecoveredPassword(denied.client, 'new-password-123'), error => error instanceof ApiError && error.status === 401);
    assert.deepEqual(denied.calls, []);
  }
});

test('password update failure and logout failure communicate the correct state', async () => {
  const weak = fakeClient({ updateUser: async () => ({ error: { code: 'weak_password' } }) });
  await assert.rejects(() => updateRecoveredPassword(weak.client, 'new-password-123'), error => error instanceof ApiError && error.code === 'WEAK_PASSWORD');
  assert.equal(weak.calls.some(call => call.method === 'signOut'), false);
  const logout = fakeClient({ signOut: async () => ({ error: { message: 'network error' } }) });
  assert.deepEqual(await updateRecoveredPassword(logout.client, 'new-password-123'), { ok: true, signedOut: false, redirect: '/' });
});

test('recovery callbacks support PKCE and recovery OTP without accepting arbitrary redirect parameters', async () => {
  const code = fakeClient();
  const result = await verifyAuthCallback(code.client, new URL('https://study.example.com/auth/callback?code=one-time-code&type=recovery&next=https://evil.example'));
  assert.equal(result.recovery, true);
  assert.deepEqual(code.calls.map(call => call.method), ['exchangeCodeForSession', 'getUser']);
  const otp = fakeClient();
  assert.equal((await verifyAuthCallback(otp.client, new URL('https://study.example.com/auth/callback?token_hash=hash&type=recovery'))).recovery, true);
  assert.deepEqual(otp.calls, [{ method: 'verifyOtp', input: { token_hash: 'hash', type: 'recovery' } }, { method: 'getUser' }]);
  const defaultCode = fakeClient({ exchangeCodeForSession: async () => ({ data: { redirectType: 'recovery' }, error: null }) });
  assert.equal((await verifyAuthCallback(defaultCode.client, new URL('https://study.example.com/auth/callback?code=code'))).recovery, true);
  const signup = fakeClient();
  assert.equal((await verifyAuthCallback(signup.client, new URL('https://study.example.com/auth/callback?token_hash=hash&type=email'))).recovery, false);
});

test('callbacks reject missing, contradictory, unsupported and expired credentials despite an existing session', async () => {
  for (const query of ['', '?type=recovery', '?code=a&token_hash=b', '?code=a&type=admin', '?code=a&type=recovery&type=email', '?code=a&error=access_denied', '?code=a&code=b']) {
    const { client, calls } = fakeClient();
    await assert.rejects(() => verifyAuthCallback(client, new URL(`https://study.example.com/auth/callback${query}`)), error => error instanceof ApiError);
    assert.deepEqual(calls, []);
  }
  const expired = fakeClient({ exchangeCodeForSession: async () => ({ data: null, error: { code: 'flow_state_expired' } }) });
  await assert.rejects(() => verifyAuthCallback(expired.client, new URL('https://study.example.com/auth/callback?code=expired&type=recovery')), error => error instanceof ApiError);
  assert.deepEqual(expired.calls, []);
  const revoked = fakeClient({ getUser: async () => ({ data: { user: confirmedUser }, error: { code: 'session_not_found' } }) });
  await assert.rejects(() => recoveryUser(revoked.client), error => error instanceof ApiError);
});

test('recovery requires a configured safe origin and rejects cross-origin mutations before Auth', async () => {
  const previous = { APP_ORIGIN: process.env.APP_ORIGIN, NODE_ENV: process.env.NODE_ENV };
  try {
    Object.assign(process.env, { APP_ORIGIN: 'https://study.example.com', NODE_ENV: 'production' });
    assert.equal(authOrigin(), 'https://study.example.com');
    for (const handler of [forgotPassword, resetPassword]) {
      for (const origin of ['https://evil.example', 'null', '']) {
        const response = await handler(new Request('https://study.example.com/api/reset-password', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ password: 'new-password-123' }) }));
        assert.equal(response.status, 403);
        assert.equal((await response.json()).error.code, 'ORIGIN_REJECTED');
      }
    }
    for (const origin of ['', 'javascript:alert(1)', 'https://evil.example@study.example.com', 'https://study.example.com/path', 'https://study.example.com?next=evil', 'http://study.example.com', 'http://localhost:3000']) {
      process.env.APP_ORIGIN = origin;
      assert.throws(() => authOrigin(), error => error instanceof ApiError && error.code === 'SETUP_REQUIRED');
    }
    Object.assign(process.env, { APP_ORIGIN: 'http://localhost:3000', NODE_ENV: 'development' });
    assert.equal(authOrigin(), 'http://localhost:3000');
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
