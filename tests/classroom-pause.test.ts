import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GET as classroomEvents } from '../src/app/api/classroom/events/route';
import { POST as classroomCommand } from '../src/app/api/classroom/route';
import { classroomState, type AccountIdentity } from '../src/lib/server/classroom';
import { requireClassroomCommandAvailable } from '../src/lib/server/classroom-availability';
import { ApiError } from '../src/lib/server/http';

const account: AccountIdentity = { id: '11111111-1111-4111-8111-111111111111', name: 'Teacher', email: 'teacher@example.test', role: 'teacher', status: 'approved', teacher_id: null };

test('paused teacher reads never request classroom or student snapshots', async () => {
  const calls: string[] = [];
  const client = { rpc: async (name: string) => {
    calls.push(name);
    assert.equal(name, 'classroom_identity');
    return { data: account, error: null };
  } } as unknown as SupabaseClient;
  for (const identity of [account, undefined]) {
    const state = await classroomState(client, identity);
    assert.equal(state.account.id, account.id);
    assert.equal(state.teacher_features_paused, true);
    for (const field of ['accounts', 'applications', 'students', 'messages', 'alerts', 'feedback', 'invites']) assert.deepEqual(state[field], []);
  }
  assert.deepEqual(calls, ['classroom_identity']);
});

test('student and administrator reads retain the authorized database state', async () => {
  for (const role of ['student', 'admin'] as const) {
    const expected = { account: { ...account, role }, applications: [{ id: 'pending-application' }] };
    const client = { rpc: async (name: string) => {
      assert.equal(name, 'classroom_state');
      return { data: expected, error: null };
    } } as unknown as SupabaseClient;
    assert.equal(await classroomState(client, expected.account), expected);
  }
});

test('pause rejects all teacher and messaging actions but preserves admin management and student leave', () => {
  const paused = (error: unknown) => error instanceof ApiError && error.code === 'TEACHER_FEATURES_PAUSED';
  for (const type of ['application.review', 'account.delete', 'student.remove', 'invite.create', 'message.send', 'alert.send']) {
    assert.throws(() => requireClassroomCommandAvailable(account, type), paused);
  }
  for (const type of ['message.reply', 'message.read', 'alert.respond']) {
    assert.throws(() => requireClassroomCommandAvailable({ ...account, role: 'student' }, type), paused);
  }
  for (const type of ['application.review', 'account.suspend', 'account.delete', 'student.remove']) {
    assert.doesNotThrow(() => requireClassroomCommandAvailable({ ...account, role: 'admin' }, type));
  }
  assert.doesNotThrow(() => requireClassroomCommandAvailable({ ...account, role: 'student' }, 'student.remove'));
});

test('legacy presence requests are a minimal no-op without an auth session', async () => {
  const origin = process.env.APP_ORIGIN ?? 'https://study.example.test';
  for (const type of ['presence.heartbeat', 'presence.leave']) {
    const response = await classroomCommand(new Request(`${origin}/api/classroom`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ request_id: crypto.randomUUID(), type, payload: { device_id: crypto.randomUUID(), visible: true } }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, paused: true });
    assert.match(response.headers.get('cache-control') ?? '', /private, no-store/);
  }
});

test('legacy classroom streams terminate with HTTP 204 to stop browser reconnections', async () => {
  const response = classroomEvents();
  assert.equal(response.status, 204);
  assert.equal(response.body, null);
  assert.match(response.headers.get('cache-control') ?? '', /private, no-store/);
});
