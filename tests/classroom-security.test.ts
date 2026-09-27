import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { ensureClassroomApplication } from '../src/lib/server/classroom-application';
import { ApiError } from '../src/lib/server/http';
import { demoClient, demoEnabled, demoRuntime } from '../src/lib/server/classroom-demo';
import { GET as demoList, POST as demoLogin } from '../src/app/api/demo/route';
import { POST as register } from '../src/app/api/register/route';
import { deliverApplicationEmails, emailDeliveryConfigured } from '../src/lib/server/classroom-email';

const verified: Pick<User, 'email_confirmed_at' | 'user_metadata'> = {
  email_confirmed_at: '2026-09-26T00:00:00Z',
  user_metadata: { name: 'Ecrin Yılmaz', requested_role: 'student' },
};

function clientWithReplies(replies: Array<{ data: unknown; error: { message: string; code?: string } | null }>) {
  const calls: Array<{ name: string; payload?: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, payload?: Record<string, unknown>) => {
      calls.push({ name, payload });
      const reply = replies.shift();
      assert.ok(reply, `Unexpected RPC call: ${name}`);
      return reply;
    },
  } as unknown as Pick<SupabaseClient, 'rpc'>;
  return { client, calls };
}

test('auth callbacks preserve approved, pending, rejected and suspended accounts without resubmitting metadata', async () => {
  for (const status of ['approved', 'pending', 'rejected', 'suspended']) {
    const account = { id: 'account', role: 'student', status, teacher_id: 'original-teacher' };
    const { client, calls } = clientWithReplies([{ data: account, error: null }]);
    assert.deepEqual(await ensureClassroomApplication(client, {
      ...verified, user_metadata: { requested_role: 'admin', invite_token: 'a'.repeat(64) },
    }), account);
    assert.deepEqual(calls.map(call => call.name), ['classroom_identity']);
  }
});

test('first application metadata cannot grant admin privileges and identity refresh errors are surfaced', async () => {
  const { client, calls } = clientWithReplies([
    { data: null, error: null }, { data: 'application-id', error: null },
    { data: { id: 'account', role: 'student', status: 'pending' }, error: null },
  ]);
  const account = await ensureClassroomApplication(client, {
    ...verified, user_metadata: { name: 'Ecrin', requested_role: 'admin', role: 'admin', status: 'approved', teacher_id: 'forged' },
  });
  assert.equal(account?.role, 'student');
  assert.equal(account?.status, 'pending');
  assert.deepEqual(calls[1].payload, { display_name: 'Ecrin', requested_role: 'student', invite_token: null });
  const unavailable = clientWithReplies([{ data: null, error: { message: 'missing function', code: 'PGRST202' } }]);
  await assert.rejects(() => ensureClassroomApplication(unavailable.client, verified), error => error instanceof ApiError && error.code === 'DATABASE_SETUP_REQUIRED');
  assert.equal(unavailable.calls.length, 1);
  const invalidInvite = clientWithReplies([{ data: null, error: null }, { data: null, error: { message: 'INVITE_INVALID' } }]);
  await assert.rejects(() => ensureClassroomApplication(invalidInvite.client, verified), error => error instanceof ApiError && error.code === 'INVITE_INVALID');
});

test('unverified users do not submit an application from a forged callback', async () => {
  const { client, calls } = clientWithReplies([{ data: null, error: null }]);
  await assert.rejects(() => ensureClassroomApplication(client, { ...verified, email_confirmed_at: undefined }),
    error => error instanceof ApiError && error.code === 'EMAIL_VERIFICATION_REQUIRED');
  assert.equal(calls.length, 1);
});

test('production cannot enable demo listing, login, registration or database access even with its flag set', async () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, CLASSROOM_DEMO_ENABLED: process.env.CLASSROOM_DEMO_ENABLED, APP_ORIGIN: process.env.APP_ORIGIN };
  Object.assign(process.env, { NODE_ENV: 'production', CLASSROOM_DEMO_ENABLED: 'true', APP_ORIGIN: 'https://study.example.com' });
  try {
    assert.equal(demoEnabled(), false);
    assert.throws(() => demoRuntime(), error => error instanceof ApiError && error.code === 'DEMO_DISABLED');
    assert.deepEqual(await (await demoList()).json(), { enabled: false, accounts: [] });
    const request = (url: string, body: unknown) => new Request(`https://study.example.com${url}`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://study.example.com' }, body: JSON.stringify(body),
    });
    const login = await demoLogin(request('/api/demo', { account_id: '11111111-1111-4111-8111-111111111111' }));
    assert.equal(login.status, 404);
    assert.equal((await login.json()).error.code, 'DEMO_DISABLED');
    const registration = await register(request('/api/register', { first_name: 'Ecrin', last_name: 'Yılmaz', email: 'ecrin@example.test', role: 'student', demo: true }));
    assert.equal(registration.status, 404);
    assert.equal((await registration.json()).error.code, 'DEMO_DISABLED');
    const bypass = await demoClient('11111111-1111-4111-8111-111111111111').rpc('classroom_state');
    assert.equal(bypass.data, null);
    assert.ok(bypass.error);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('public registration rejects admin role and privileged fields before contacting Auth', async () => {
  const previous = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'https://study.example.com';
  try {
    for (const fields of [{ role: 'admin' }, { role: 'student', status: 'approved' }, { role: 'teacher', teacher_id: 'forged' }]) {
      const response = await register(new Request('https://study.example.com/api/register', {
        method: 'POST', headers: { origin: 'https://study.example.com', 'content-type': 'application/json' },
        body: JSON.stringify({ first_name: 'Ecrin', last_name: 'Yılmaz', email: 'ecrin@example.test', password: 'SecurePassword123', password_confirmation: 'SecurePassword123', ...fields }),
      }));
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'INVALID_INPUT');
    }
  } finally {
    if (previous === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previous;
  }
});

test('email configuration requires all delivery credentials and a valid origin; partial setup stays a preview', async () => {
  const keys = ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','ALLOWED_USER_EMAIL','RESEND_API_KEY','CLASSROOM_EMAIL_FROM','SUPABASE_SECRET_KEY','APP_ORIGIN','CLASSROOM_EMAIL_NOTIFICATIONS_ENABLED'];
  const previous = Object.fromEntries(keys.map(key => [key,process.env[key]]));
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',
    ALLOWED_USER_EMAIL:'owner@example.test', RESEND_API_KEY:'test-key', CLASSROOM_EMAIL_FROM:'Application <application@example.test>',
    SUPABASE_SECRET_KEY:'test-secret', APP_ORIGIN:'https://study.example.com',
  });
  try {
    for (const enabled of [undefined, 'false']) {
      if(enabled===undefined)delete process.env.CLASSROOM_EMAIL_NOTIFICATIONS_ENABLED;
      else process.env.CLASSROOM_EMAIL_NOTIFICATIONS_ENABLED=enabled;
      assert.equal(emailDeliveryConfigured(), false);
      assert.deepEqual(await deliverApplicationEmails(), {configured:false,sent:0,failed:0});
    }
    process.env.CLASSROOM_EMAIL_NOTIFICATIONS_ENABLED='true';
    assert.equal(emailDeliveryConfigured(), true);
    for (const key of ['RESEND_API_KEY','CLASSROOM_EMAIL_FROM','SUPABASE_SECRET_KEY','APP_ORIGIN']) {
      const value = process.env[key]; delete process.env[key];
      assert.equal(emailDeliveryConfigured(), false, key);
      assert.deepEqual(await deliverApplicationEmails(), {configured:false,sent:0,failed:0});
      process.env[key]=value;
    }
    process.env.APP_ORIGIN='javascript:alert(1)';
    assert.equal(emailDeliveryConfigured(), false);
    assert.deepEqual(await deliverApplicationEmails(), {configured:false,sent:0,failed:0});
  } finally {
    for (const [key,value] of Object.entries(previous)) {
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});
