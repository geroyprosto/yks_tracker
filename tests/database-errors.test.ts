import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {databaseError, executeStudentCommand} from '../src/lib/server/service';
import {ApiError, errorResponse} from '../src/lib/server/http';

test('a database statement timeout has a retry message instead of a setup warning', async t => {
  const log = t.mock.method(console, 'error', () => {});
  let caught: unknown;
  try { databaseError({code: '57014', message: 'canceling statement due to statement timeout'}); }
  catch (error) { caught = error; }
  assert.ok(caught instanceof ApiError);
  assert.equal(caught.status, 503);
  assert.equal(caught.code, 'DATABASE_TIMEOUT');
  assert.match(caught.message, /yeniden deneyin/);
  assert.doesNotMatch(caught.message, /kurulum|migration|bağlantı/i);
  const response = errorResponse(caught);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'DATABASE_TIMEOUT');
  assert.equal(log.mock.callCount(), 1);
});

test('lock waits and database deadlocks are distinguished from unavailable databases', t => {
  t.mock.method(console, 'error', () => {});
  for (const code of ['55P03', '40P01']) {
    assert.throws(() => databaseError({code, message: 'database lock details'}),
      {status: 503, code: 'DATABASE_BUSY'});
  }
});

test('connection errors stay distinct from query timeouts and missing migrations', t => {
  t.mock.method(console, 'error', () => {});
  for (const code of ['08000', '08006', 'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', '504']) {
    assert.throws(() => databaseError({code, message: 'upstream connection failed'}),
      {status: 503, code: 'DATABASE_CONNECTION_FAILED'});
  }
  for (const message of ['TypeError: fetch failed', 'Failed to fetch', 'NetworkError when attempting to fetch resource.']) {
    assert.throws(() => databaseError({code: '', message}),
      {status: 503, code: 'DATABASE_CONNECTION_FAILED'});
  }
  for (const code of ['PGRST202', '42P01']) {
    assert.throws(() => databaseError({code, message: 'not found'}),
      {status: 503, code: 'DATABASE_SETUP_REQUIRED'});
  }
});

test('expected domain and input errors preserve their responses without operational logs', t => {
  const log = t.mock.method(console, 'error', () => {});
  for (const [message, code, status] of [
    ['CONFLICT', 'CONFLICT', 409], ['OWNER_REQUIRED', 'OWNER_REQUIRED', 403],
    ['RATE_LIMITED', 'RATE_LIMITED', 429], ['constraint detail', 'INVALID_INPUT', 400],
  ] as const) {
    assert.throws(() => databaseError({message, ...(message === 'constraint detail' ? {code: '23505'} : {})}),
      {status, code});
  }
  assert.equal(log.mock.callCount(), 0);
});

test('operational logs expose only a bounded error code and no database message or details', t => {
  const log = t.mock.method(console, 'error', () => {});
  const secret = 'private-owner-uuid select password from private_table access_token=secret';
  assert.throws(() => databaseError({code: '57014', message: secret}));
  assert.deepEqual(log.mock.calls[0].arguments, [
    'database_operation_failed', {category: 'timeout', code: '57014', operation: 'unknown'},
  ]);
  assert.throws(() => databaseError({code: `42P01\n${secret}`, message: secret}));
  assert.deepEqual(log.mock.calls[1].arguments, [
    'database_operation_failed', {category: 'unavailable', code: 'UNKNOWN', operation: 'unknown'},
  ]);
  assert.doesNotMatch(JSON.stringify(log.mock.calls.map(call => call.arguments)), /private-owner|password|access_token/);
});

test('only known operation names are logged, including safe labels from MCP callers', t => {
  const log = t.mock.method(console, 'error', () => {});
  assert.throws(() => databaseError({code: '57014', message: 'private query'}, 'mcp_owner_state'));
  assert.equal(log.mock.calls[0].arguments[1].operation, 'mcp_owner_state');
  assert.throws(() => databaseError({code: '57014', message: 'private query'}, 'private_user_secret' as never));
  assert.equal(log.mock.calls[1].arguments[1].operation, 'unknown');
});

test('a timed-out save surfaces the new error without automatically replaying the mutation', async t => {
  const log = t.mock.method(console, 'error', () => {});
  let calls = 0;
  const client = {rpc: async () => {
    calls++;
    return {data: null, error: {code: '57014', message: 'private SQL query context'}};
  }} as unknown as SupabaseClient;
  await assert.rejects(() => executeStudentCommand(client, {
    request_id: '00000000-0000-4000-8000-000000000001',
    type: 'task.delete', payload: {id: '00000000-0000-4000-8000-000000000002', expected_revision: 1},
  }), {status: 503, code: 'DATABASE_TIMEOUT'});
  assert.equal(calls, 1);
  assert.deepEqual(log.mock.calls[0].arguments[1], {
    category: 'timeout', code: '57014', operation: 'yks_student_command',
  });
});
