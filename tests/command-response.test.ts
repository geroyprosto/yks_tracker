import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {authorizeStudyCommand, executeCommand, executeStudentCommand, getState} from '../src/lib/server/service';

const requestId = '00000000-0000-4000-8000-000000000001';
const taskId = '00000000-0000-4000-8000-000000000002';
const command = {request_id: requestId, type: 'task.delete', payload: {id: taskId, expected_revision: 1}};

function fakeClient() {
  const calls: string[] = [];
  const client = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === 'yks_command') return {data: {id: taskId, request_id: requestId, replayed: false}, error: null};
      if (name === 'yks_dashboard_state') return {data: {server_now: '2026-10-03T12:00:00Z'}, error: null};
      throw new Error(`Unexpected RPC ${name}`);
    },
  } as unknown as SupabaseClient;
  return {client, calls};
}

test('minimal command response skips the full state RPC', async () => {
  const {client, calls} = fakeClient();

  const response = await executeCommand(client, command, {minimal: true});

  assert.deepEqual(response, {ok: true, id: taskId, request_id: requestId, replayed: false});
  assert.deepEqual(calls, ['yks_command']);
});

test('default command response keeps the full state for existing callers', async () => {
  const {client, calls} = fakeClient();

  const response = await executeCommand(client, command);

  assert.equal(response.state.authenticated, true);
  assert.equal(response.state.configured, true);
  assert.equal(response.state.server_now, '2026-10-03T12:00:00Z');
  assert.deepEqual(calls, ['yks_command', 'yks_dashboard_state']);
});

test('fast study authorization verifies the database identity without a separate Auth request', async () => {
  const calls: string[] = [];
  const client = {
    auth: {getUser: async () => {throw new Error('Auth request should not be needed');}},
    rpc: async (name: string) => {
      calls.push(name);
      return {data: {status: 'approved', role: 'student'}, error: null};
    },
  } as unknown as SupabaseClient;

  assert.equal(await authorizeStudyCommand(client), client);
  assert.deepEqual(calls, ['classroom_identity']);
});

test('fast study authorization rejects teachers before the command RPC', async () => {
  const calls: string[] = [];
  const client = {
    rpc: async (name: string) => {
      calls.push(name);
      return {data: {status: 'approved', role: 'teacher'}, error: null};
    },
  } as unknown as SupabaseClient;

  await assert.rejects(() => authorizeStudyCommand(client), {status: 403, code: 'STUDENT_REQUIRED'});
  assert.deepEqual(calls, ['classroom_identity']);
});

test('fast study authorization keeps a sign-in error for an invalid session', async () => {
  const calls: string[] = [];
  const client = {
    auth: {getUser: async () => {calls.push('getUser'); return {data: {user: null}, error: {message: 'Invalid token'}};}},
    rpc: async (name: string) => {
      calls.push(name);
      return {data: null, error: {message: 'JWT expired'}};
    },
  } as unknown as SupabaseClient;

  await assert.rejects(() => authorizeStudyCommand(client), {status: 401, code: 'SIGN_IN_REQUIRED'});
  assert.deepEqual(calls, ['classroom_identity', 'getUser']);
});

test('student save performs one combined RPC and no Auth or state request', async () => {
  const calls: string[] = [];
  const client = {
    auth: {getUser: async () => {throw new Error('Auth must not run on a successful save');}},
    rpc: async (name: string) => {
      calls.push(name);
      return {data: {id: taskId, request_id: requestId, replayed: true}, error: null};
    },
  } as unknown as SupabaseClient;
  assert.deepEqual(await executeStudentCommand(client, command),
    {ok: true, id: taskId, request_id: requestId, replayed: true});
  assert.deepEqual(calls, ['yks_student_command']);
});

test('student save rejects malformed input before contacting the database', async () => {
  const client = {rpc: async () => {throw new Error('Invalid input must not reach SQL');}} as unknown as SupabaseClient;
  await assert.rejects(() => executeStudentCommand(client, {...command, request_id: 'invalid'}),
    {status: 400, code: 'INVALID_INPUT'});
});

test('combined save retains sign-in errors for expired JWTs and anonymous function calls', async () => {
  for (const error of [{message: 'JWT expired', code: 'PGRST301'},
    {message: 'permission denied for function yks_student_command', code: '42501'},
    {message: 'AUTH_REQUIRED'}, {message: 'JWT expired'}]) {
    const calls: string[] = [];
    const client = {
      rpc: async (name: string) => {calls.push(name); return {data: null, error};},
      auth: {getUser: async () => {calls.push('getUser'); return {data: {user: null}, error: {message: 'Invalid session'}};}},
    } as unknown as SupabaseClient;
    await assert.rejects(() => executeStudentCommand(client, command), {status: 401, code: 'SIGN_IN_REQUIRED'});
    assert.deepEqual(calls, ['yks_student_command', 'getUser']);
  }
});

test('combined save preserves permission, conflict and rate errors without an Auth network call', async () => {
  for (const [code, status] of [['STUDENT_REQUIRED', 403], ['CONFLICT', 409], ['RATE_LIMITED', 429],
    ['IDEMPOTENCY_CONFLICT', 409], ['INVALID_INPUT', 400]] as const) {
    const client = {
      rpc: async () => ({data: null, error: {message: code}}),
      auth: {getUser: async () => {throw new Error('Domain errors must not add Auth requests');}},
    } as unknown as SupabaseClient;
    await assert.rejects(() => executeStudentCommand(client, command), {status, code});
  }
});

test('verified Auth user does not turn an internal function permission error into a false sign-in error', async () => {
  const client = {
    rpc: async () => ({data: null, error: {message: 'permission denied for function', code: '42501'}}),
    auth: {getUser: async () => ({data: {user: {id: taskId}}, error: null})},
  } as unknown as SupabaseClient;
  await assert.rejects(() => executeStudentCommand(client, command), {status: 503, code: 'DATABASE_UNAVAILABLE'});
});

test('state refresh requests the compact dashboard projection instead of projecting plan audit history', async () => {
  const calls: string[] = [];
  const client = {rpc: async (name: string) => {
    calls.push(name);
    assert.equal(name, 'yks_dashboard_state');
    return {data: {server_now: '2026-10-07T13:00:00Z'}, error: null};
  }} as unknown as SupabaseClient;
  const result = await getState(client);
  assert.equal(result.server_now, '2026-10-07T13:00:00Z');
  assert.deepEqual(calls, ['yks_dashboard_state']);
});

test('only a missing dashboard migration falls back to the legacy state RPC', async () => {
  const calls: string[] = [];
  const client = {rpc: async (name: string) => {
    calls.push(name);
    if (name === 'yks_dashboard_state') return {data: null, error: {code: 'PGRST202', message: 'Function not found'}};
    return {data: {server_now: '2026-10-07T13:00:00Z'}, error: null};
  }} as unknown as SupabaseClient;
  assert.equal((await getState(client)).authenticated, true);
  assert.deepEqual(calls, ['yks_dashboard_state', 'yks_state']);
});

test('failed dashboard authorization or timeout cannot trigger the expensive legacy projection', async () => {
  for (const error of [{message: 'ACCESS_DENIED', code: '42501'}, {message: 'canceling statement due to statement timeout', code: '57014'}]) {
    const calls: string[] = [];
    const client = {rpc: async (name: string) => {calls.push(name); return {data: null, error};}} as unknown as SupabaseClient;
    await assert.rejects(() => getState(client));
    assert.deepEqual(calls, ['yks_dashboard_state']);
  }
});
