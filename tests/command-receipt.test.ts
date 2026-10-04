import assert from 'node:assert/strict';
import {test} from 'node:test';
import {acknowledgeCommandReceipt} from '../src/lib/command-receipt';
import {emptyState} from '../src/lib/domain/types';
import {optimisticCommand} from '../src/lib/optimistic-command';

const provisionalId = '11111111-1111-4111-8111-111111111111';
const savedId = '22222222-2222-4222-8222-222222222222';
const now = '2026-10-04T12:00:00Z';

test('a confirmed journal create can be updated using its server ID and current revision', () => {
  const preview = optimisticCommand(emptyState(true), 'journal.create', {
    journal_date: '2026-10-04', original_text: 'İlk kayıt',
  }, provisionalId, now)!;
  const accepted = acknowledgeCommandReceipt(preview, 'journal.create', provisionalId, savedId);
  assert.equal(accepted.journal_entries[0].id, savedId);
  assert.equal(accepted.journal_entries[0].revision, 1);
  const next = optimisticCommand(accepted, 'journal.update', {
    id: savedId, expected_revision: 1, original_text: 'İkinci kayıt',
  }, 'next-request', now)!;
  assert.equal(next.journal_entries[0].original_text, 'İkinci kayıt');
  assert.equal(next.journal_entries[0].revision, 2);
  assert.equal(preview.journal_entries[0].id, provisionalId);
});

test('a manual study receipt retains its duration and maps only its temporary ID', () => {
  const preview = optimisticCommand(emptyState(true), 'manual_study.create', {
    study_date: '2026-10-04', minutes: 45, subject: 'Fizik',
  }, provisionalId, now)!;
  const accepted = acknowledgeCommandReceipt(preview, 'manual_study.create', provisionalId, savedId);
  assert.deepEqual(accepted.manual_study_entries, [{id: savedId, study_date: '2026-10-04',
    course_id: null, subject: 'Fizik', duration_seconds: 2700, created_at: now}]);
});

test('a replay keeps an already loaded journal instead of duplicating its preview', () => {
  const preview = optimisticCommand(emptyState(true), 'journal.create', {
    journal_date: '2026-10-04', original_text: 'Tekrar denenen kayıt',
  }, provisionalId, now)!;
  const authoritative = {...preview.journal_entries[0], id: savedId, revision: 3, original_text: 'Sunucudaki güncel kayıt'};
  const accepted = acknowledgeCommandReceipt({...preview, journal_entries: [authoritative, ...preview.journal_entries]},
    'journal.create', provisionalId, savedId);
  assert.deepEqual(accepted.journal_entries, [authoritative]);
});
