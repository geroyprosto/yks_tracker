import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSaveMetrics } from '../src/lib/save-metrics';

test('save metrics distinguish the first DOM commit, parsed receipt and independent refresh', () => {
  let now = 100;
  const metrics = createSaveMetrics(() => now);
  const save = metrics.start('task.update');
  now = 112.36;
  save.visible('optimistic');
  now = 850;
  save.response(200, 'auth_db;dur=110.5, command;dur=91, app;dur=220.2');
  save.confirmed();
  const finishRefresh = save.refresh();
  now = 990;
  finishRefresh(true);
  now = 1000;
  save.visible('authoritative');
  save.confirmed();

  assert.deepEqual(JSON.parse(metrics.serialize()), [{
    command_type: 'task.update', outcome: 'confirmed', visible_ms: 12.4,
    visible_source: 'optimistic', confirmed_ms: 750, confirmation_source: 'receipt',
    failed_ms: null, failure: null, http_status: 200,
    server_timing: { auth_db: 110.5, command: 91, app: 220.2 },
    refresh_ms: 140, refresh_outcome: 'applied',
  }]);
});

test('metrics emit only known operation names and numeric server stages without descriptions or identifiers', () => {
  const metrics = createSaveMetrics(() => 0);
  const save = metrics.start('student@example.test private journal text');
  save.response(503,
    'auth_db;desc="private user@example.test";dur=15.2, private_user_id;dur=5, command;dur=-1, app;dur=Infinity');
  save.failed('http_error');

  const serialized = metrics.serialize();
  const record = JSON.parse(serialized)[0];
  assert.equal(record.command_type, 'unknown');
  assert.deepEqual(record.server_timing, { auth_db: 15.2 });
  assert.equal(record.outcome, 'failed');
  assert.equal(record.failure, 'http_error');
  assert.equal(record.confirmed_ms, null);
  assert.equal(record.http_status, 503);
  assert.equal(serialized.includes('private'), false);
  assert.equal(serialized.includes('@'), false);
});

test('transport failures and unsuccessful refreshes retain timings without claiming persistence', () => {
  let now = 0;
  const metrics = createSaveMetrics(() => now);
  const save = metrics.start('journal.create');
  now = 8;
  save.visible('optimistic');
  now = 300;
  save.failed('request_error');
  const finishRefresh = save.refresh();
  now = 480;
  finishRefresh(false);

  const record = JSON.parse(metrics.serialize())[0];
  assert.equal(record.visible_ms, 8);
  assert.equal(record.confirmed_ms, null);
  assert.equal(record.failed_ms, 300);
  assert.equal(record.failure, 'request_error');
  assert.equal(record.refresh_ms, 180);
  assert.equal(record.refresh_outcome, 'not_applied');
});

test('late callbacks cannot restore records evicted from the last ten saves', () => {
  let now = 0;
  const metrics = createSaveMetrics(() => now);
  const first = metrics.start('task.create');
  for (let index = 0; index < 10; index++) {
    now++;
    metrics.start('task.update').confirmed();
  }
  now = 100;
  first.confirmed();
  first.visible('optimistic');

  const records = JSON.parse(metrics.serialize());
  assert.equal(records.length, 10);
  assert.ok(records.every((record: { command_type: string }) => record.command_type === 'task.update'));
});

test('database verification of an already finished countdown is identified separately from a POST receipt', () => {
  let now = 20;
  const metrics = createSaveMetrics(() => now);
  const save = metrics.start('timer.finish');
  now = 420;
  save.confirmed('state_check');

  const record = JSON.parse(metrics.serialize())[0];
  assert.equal(record.confirmed_ms, 400);
  assert.equal(record.confirmation_source, 'state_check');
  assert.equal(record.http_status, null);
  assert.deepEqual(record.server_timing, {});
});
