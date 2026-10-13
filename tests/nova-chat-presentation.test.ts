import test from 'node:test';
import assert from 'node:assert/strict';
import {hasPendingNovaReply, novaConnection, novaPollInterval, novaReplyProgress} from '../src/lib/nova/chat-presentation';
import type {NovaDevice, NovaJob} from '../src/lib/nova/web-types';

const now = '2026-10-13T12:00:00.000Z';
const device: NovaDevice = {id: 'device', name: 'PC', version: '1', model: 'qwen3:8b', model_available: true, last_seen_at: now, revoked_at: null};
const job = (status: string): NovaJob => ({id: status, status, kind: 'chat', source_message_id: 'message', attempt_count: 0, error: null, created_at: now, completed_at: null});
test('connection distinguishes browser offline, missing model, stale heartbeat and revoked devices', () => {
  const state = {serverNow: now, devices: [device]};
  assert.equal(novaConnection(state, true).kind, 'ready');
  assert.equal(novaConnection(state, false).kind, 'offline');
  assert.equal(novaConnection({...state, devices: [{...device, model_available: false}]}, true).kind, 'model-missing');
  assert.equal(novaConnection({...state, devices: [{...device, last_seen_at: '2026-10-13T11:57:30Z'}]}, true).kind, 'disconnected');
  assert.equal(novaConnection({...state, devices: [{...device, last_seen_at: 'invalid'}]}, true).kind, 'disconnected');
  assert.equal(novaConnection({...state, devices: [{...device, revoked_at: now}]}, true).kind, 'unpaired');
});
test('typing is only claimed for a generating job on a live connection', () => {
  assert.equal(novaReplyProgress({jobs: [job('QUEUED')]}, true)?.kind, 'waiting');
  assert.equal(novaReplyProgress({jobs: [job('CLAIMED')]}, true)?.kind, 'preparing');
  assert.equal(novaReplyProgress({jobs: [job('GENERATING')]}, true)?.kind, 'generating');
  assert.equal(novaReplyProgress({jobs: [job('GENERATING')]}, false)?.kind, 'waiting');
  assert.equal(novaReplyProgress({jobs: [job('FAILED'), job('COMPLETED')]}, true), null);
});
test('fake model heartbeat is explicitly identified as a test adapter, while a live real model takes precedence', () => {
  const fake = {...device, model: 'fake-test'};
  const testConnection = novaConnection({serverNow: now, devices: [fake]}, true);
  assert.equal(testConnection.kind, 'ready');
  assert.equal(testConnection.label, 'Test bağdaştırıcısı bağlı');
  assert.match(testConnection.detail, /gerçek yerel model çalışmıyor/);
  assert.equal(novaConnection({serverNow: now, devices: [fake, device]}, true).label, 'Yerel model bağlı');
});
test('polling speeds up only for unfinished replies and returns to idle after terminal states', () => {
  for (const status of ['QUEUED', 'CLAIMED', 'GENERATING', 'RETRY_WAIT']) {
    assert.equal(hasPendingNovaReply({jobs: [job(status)]}), true);
    assert.equal(novaPollInterval({jobs: [job(status)]}), 2000);
  }
  for (const status of ['FAILED', 'CANCELLED', 'COMPLETED']) assert.equal(novaPollInterval({jobs: [job(status)]}), 30000);
  assert.equal(novaPollInterval(null), 30000);
});
