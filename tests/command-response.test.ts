import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {authorizeStudyCommand, executeCommand} from '../src/lib/server/service';

const requestId = '00000000-0000-4000-8000-000000000001';
const taskId = '00000000-0000-4000-8000-000000000002';
const command = {request_id: requestId, type: 'task.delete', payload: {id: taskId, expected_revision: 1}};

function fakeClient() {
  const calls: string[] = [];
  const client = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === 'yks_command') return {data: {id: taskId, request_id: requestId, replayed: false}, error: null};
      if (name === 'yks_state') return {data: {server_now: '2026-10-03T12:00:00Z'}, error: null};
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
  assert.deepEqual(calls, ['yks_command', 'yks_state']);
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
