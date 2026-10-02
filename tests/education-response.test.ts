import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {executeEducationCommand} from '../src/lib/server/education';
import {emptyEducation} from '../src/lib/education';

const requestId = '00000000-0000-4000-8000-000000000011';
const courseId = '00000000-0000-4000-8000-000000000012';
const command = {request_id: requestId, type: 'course.update', payload: {id: courseId, expected_revision: 1, name: 'Matematik'}};

function fakeClient() {
  const calls: string[] = [];
  const client = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === 'education_command') return {data: {id: courseId, request_id: requestId, replayed: false}, error: null};
      if (name === 'education_state') return {data: emptyEducation(), error: null};
      throw new Error(`Unexpected RPC ${name}`);
    },
  } as unknown as SupabaseClient;
  return {client, calls};
}

test('minimal education response skips full education state RPC', async () => {
  const {client, calls} = fakeClient();

  const response = await executeEducationCommand(client, command, {minimal: true});

  assert.deepEqual(response, {ok: true, result: {id: courseId, request_id: requestId, replayed: false}});
  assert.deepEqual(calls, ['education_command']);
});

test('default education response retains full state for existing callers', async () => {
  const {client, calls} = fakeClient();

  const response = await executeEducationCommand(client, command);

  assert.deepEqual(response.state, emptyEducation());
  assert.deepEqual(calls, ['education_command', 'education_state']);
});
