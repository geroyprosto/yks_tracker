import test from 'node:test';
import assert from 'node:assert/strict';
import {GET as chatState} from '../src/app/api/nova/chat/route';
import {POST as bridge} from '../src/app/api/nova/bridge/route';
import {novaCommand} from '../src/lib/server/nova';
import {ApiError} from '../src/lib/server/http';

test('retired chat and bridge return a permanent removal response without configuration or a request body', async () => {
  for (const handler of [chatState, bridge]) {
    const response = await handler();
    assert.equal(response.status, 410);
    assert.equal((await response.json()).error.code, 'NOVA_CHAT_REMOVED');
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  }
});

test('retired browser commands are rejected before account or database processing', async () => {
  for (const operation of ['message', 'retry', 'memory', 'duel', 'pair.approve', 'device.revoke', 'history', 'source']) {
    await assert.rejects(novaCommand({operation}), error => error instanceof ApiError && error.status === 410 && error.code === 'NOVA_CHAT_REMOVED');
  }
});

test('simulation settings reject retired controls and invalid adaptation limits before storage', async () => {
  for (const settings of [{proactive_enabled: true}, {memory_enabled: true}, {quiet_start: 0}, {weekly_adaptation_limit: -.01}, {weekly_adaptation_limit: .06}, {timezone: 'invalid/timezone'}]) {
    await assert.rejects(novaCommand({operation: 'settings', settings}), error => error instanceof ApiError && error.status === 400 && error.code === 'NOVA_INVALID_INPUT');
  }
});
