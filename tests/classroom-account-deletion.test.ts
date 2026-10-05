import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteClassroomAccount } from '../src/lib/server/classroom-account-deletion';
import { ApiError, errorResponse } from '../src/lib/server/http';

const actorId = '10000000-0000-4000-8000-000000000001';
const targetId = '20000000-0000-4000-8000-000000000002';
const otherId = '30000000-0000-4000-8000-000000000003';
const actor = { user: { id: actorId }, account: { id: actorId, role: 'admin', status: 'approved' } };
const input = { id: targetId, confirmation_email: 'student@example.test' };
const secret = 'unit-test-service-secret';
type StorageObject = { bucket_id: string; name: string };
type Reply = { data: unknown; error: { message: string; code?: string } | null };
const present = (storage: StorageObject[] = [], emails = [input.confirmation_email]): Reply => ({
  data: { exists: true, emails, storage }, error: null,
});
const missing = (): Reply => ({ data: { exists: false, emails: [], storage: [] }, error: null });
const apiError = (code: string, status: number) => (error: unknown) =>
  error instanceof ApiError && error.code === code && error.status === status;

function fakeService(replies: Reply[], options: { fileErrorAt?: number; authError?: string } = {}) {
  const rpcCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const removals: Array<{ bucket: string; paths: string[] }> = [];
  const authDeletes: Array<{ id: string; soft: boolean }> = [];
  const events: string[] = [];
  const client = {
    rpc: async (name: string, payload: Record<string, unknown>) => {
      rpcCalls.push({ name, payload });
      events.push('prepare');
      const reply = replies.shift();
      assert.ok(reply, `Unexpected RPC call ${name}`);
      return reply;
    },
    storage: { from: (bucket: string) => ({ remove: async (paths: string[]) => {
      removals.push({ bucket, paths: [...paths] });
      events.push('files');
      return { data: null, error: options.fileErrorAt === removals.length ? { message: 'Storage unavailable' } : null };
    } }) },
    auth: { admin: { deleteUser: async (id: string, soft: boolean) => {
      authDeletes.push({ id, soft });
      events.push('auth');
      return { data: { user: null }, error: options.authError ? { message: options.authError } : null };
    } } },
  } as unknown as SupabaseClient;
  return { dependencies: { service: client, secret }, rpcCalls, removals, authDeletes, events };
}

test('only an approved administrator with the verified account identity can obtain the service client', async () => {
  const dependencies = {
    get service(): SupabaseClient { throw new Error('Unauthorized actor obtained the service client'); },
    get secret(): string { throw new Error('Unauthorized actor obtained the service secret'); },
  };
  const rejected = [
    { ...actor, account: null },
    { ...actor, account: { ...actor.account, id: otherId } },
    ...['teacher', 'student', 'owner'].map(role => ({ ...actor, account: { ...actor.account, role } })),
    ...['pending', 'rejected', 'suspended'].map(status => ({ ...actor, account: { ...actor.account, status } })),
  ];
  for (const invalidActor of rejected) {
    await assert.rejects(deleteClassroomAccount(invalidActor, input, dependencies), apiError('ADMIN_REQUIRED', 403));
  }
  await assert.rejects(deleteClassroomAccount(actor, { ...input, id: actorId }, dependencies), apiError('ACCOUNT_DELETE_PROTECTED', 403));
});

test('malformed identities, missing confirmation and extra privileged fields are rejected before database access', async () => {
  for (const invalidInput of [
    null, { ...input, id: 'not-a-uuid' }, { ...input, id: 123 }, { id: targetId },
    { ...input, confirmation_email: '' }, { ...input, confirmation_email: 'a'.repeat(321) },
    { ...input, actor_id: actorId }, { ...input, role: 'admin' }, { ...input, storage: [] },
  ]) {
    const fake = fakeService([]);
    await assert.rejects(deleteClassroomAccount(actor, invalidInput, fake.dependencies), apiError('INVALID_INPUT', 400));
    assert.deepEqual(fake.events, []);
  }
});

test('database confirmation, current admin authority and protected target checks precede every destructive side effect', async () => {
  for (const [code, status] of [
    ['DELETE_CONFIRMATION_REQUIRED', 400], ['ACCESS_DENIED', 403],
  ] as const) {
    const fake = fakeService([{ data: null, error: { message: code } }]);
    await assert.rejects(deleteClassroomAccount(actor, input, fake.dependencies), apiError(code, status));
    assert.deepEqual(fake.events, ['prepare']);
    assert.equal(fake.rpcCalls[0].name, 'classroom_account_delete_prepare');
    assert.deepEqual(fake.rpcCalls[0].payload, {
      p_actor_id: actorId, p_target_id: targetId, p_confirmation_email: input.confirmation_email,
      p_registration_email_digests: [],
    });
  }
});

test('a revoked administrator is rejected by the next database check before any file deletion', async () => {
  const fake = fakeService([present(), { data: null, error: { message: 'ACCESS_DENIED' } }]);
  await assert.rejects(deleteClassroomAccount(actor, input, fake.dependencies), apiError('ACCESS_DENIED', 403));
  assert.deepEqual(fake.events, ['prepare', 'prepare']);
});

test('unexpected database errors are sanitized and never allow Storage or Auth deletion', async () => {
  const fake = fakeService([{ data: null, error: { message: 'Internal failure containing student@example.test' } }]);
  let failure: unknown;
  try { await deleteClassroomAccount(actor, input, fake.dependencies); } catch (error) { failure = error; }
  assert.ok(apiError('DATABASE_UNAVAILABLE', 503)(failure));
  const response = JSON.stringify(await errorResponse(failure).json());
  assert.ok(!response.includes(input.confirmation_email));
  assert.deepEqual(fake.events, ['prepare']);
});

test('malformed database plans fail closed before hashes, file operations or Auth deletion', async () => {
  for (const data of [
    null, {}, { exists: 'true', emails: [], storage: [] },
    { exists: true, emails: [null], storage: [] },
    { exists: true, emails: [], storage: [null] },
    { exists: true, emails: [], storage: [{ bucket_id: '', name: 'file.pdf' }] },
    { exists: true, emails: [], storage: [{ bucket_id: 'exam-pdfs', name: 123 }] },
  ]) {
    const fake = fakeService([{ data, error: null }]);
    await assert.rejects(deleteClassroomAccount(actor, input, fake.dependencies), apiError('DATABASE_UNAVAILABLE', 503));
    assert.deepEqual(fake.events, ['prepare']);
  }
});

test('registration cleanup hashes only normalized trusted database emails using the registration HMAC protocol', async () => {
  const emails = ['  Student@Example.Test  ', 'student@example.test', 'OLD@example.test'];
  const fake = fakeService([present([], emails), present(), present(), missing()]);
  const confirmation = 'different-confirmation@example.test';
  assert.deepEqual(await deleteClassroomAccount(actor, { ...input, confirmation_email: confirmation }, fake.dependencies), { deleted: true });
  const digests = ['student@example.test', 'old@example.test'].map(email =>
    createHmac('sha256', secret).update(`email:${email}`).digest('hex'));
  assert.deepEqual(fake.rpcCalls.map(call => call.payload.p_registration_email_digests), [[], digests, digests, []]);
  assert.ok(!digests.includes(createHmac('sha256', secret).update(`email:${confirmation}`).digest('hex')));
  assert.ok(fake.rpcCalls.every(call => call.payload.p_confirmation_email === confirmation));
});

test('PDF removal uses exact planned paths in batches of 100 per bucket before a verified hard Auth delete', async () => {
  const pdfs = Array.from({ length: 205 }, (_, index) => ({ bucket_id: 'exam-pdfs', name: `${targetId}/original ${index} ş.pdf` }));
  const secondBucket = { bucket_id: 'student-files', name: `${targetId}/homework/report.pdf` };
  const objects = [pdfs[0], secondBucket, ...pdfs.slice(1)];
  const fake = fakeService([present(objects), present(objects), present(), missing()]);
  const result = await deleteClassroomAccount(actor, input, fake.dependencies);
  assert.deepEqual(fake.removals, [
    { bucket: 'exam-pdfs', paths: pdfs.slice(0, 100).map(object => object.name) },
    { bucket: 'exam-pdfs', paths: pdfs.slice(100, 200).map(object => object.name) },
    { bucket: 'exam-pdfs', paths: pdfs.slice(200).map(object => object.name) },
    { bucket: 'student-files', paths: [secondBucket.name] },
  ]);
  assert.ok(fake.removals.every(call => call.paths.every(name => name.startsWith(`${targetId}/`))));
  assert.deepEqual(fake.authDeletes, [{ id: targetId, soft: false }]);
  assert.deepEqual(fake.events, ['prepare', 'prepare', 'files', 'files', 'files', 'files', 'prepare', 'auth', 'prepare']);
  assert.ok(fake.rpcCalls.every(call => call.name === 'classroom_account_delete_prepare' && call.payload.p_target_id === targetId));
  assert.deepEqual(result, { deleted: true });
  assert.deepEqual(Object.keys(result), ['deleted']);
  assert.ok(!JSON.stringify(result).includes(targetId));
  assert.ok(!JSON.stringify(result).includes(input.confirmation_email));
});

test('a failed PDF batch stops later batches and prevents any Auth delete', async () => {
  const objects = Array.from({ length: 205 }, (_, index) => ({ bucket_id: 'exam-pdfs', name: `${targetId}/${index}.pdf` }));
  const fake = fakeService([present(objects), present(objects)], { fileErrorAt: 2 });
  await assert.rejects(deleteClassroomAccount(actor, input, fake.dependencies), apiError('ACCOUNT_DELETE_FILES_FAILED', 503));
  assert.equal(fake.removals.length, 2);
  assert.deepEqual(fake.authDeletes, []);
  assert.deepEqual(fake.events, ['prepare', 'prepare', 'files', 'files']);
});

test('objects still present after a successful Storage response prevent Auth deletion', async () => {
  const objects = [{ bucket_id: 'exam-pdfs', name: `${targetId}/retained.pdf` }];
  const fake = fakeService([present(objects), present(objects), present(objects)]);
  await assert.rejects(deleteClassroomAccount(actor, input, fake.dependencies), apiError('ACCOUNT_DELETE_FILES_FAILED', 409));
  assert.deepEqual(fake.events, ['prepare', 'prepare', 'files', 'prepare']);
  assert.deepEqual(fake.authDeletes, []);
});

test('an Auth deletion error with an existing target cannot report success or leak its message', async () => {
  const fake = fakeService([present(), present(), present(), present()], { authError: 'Auth unavailable: student@example.test' });
  let failure: unknown;
  try { await deleteClassroomAccount(actor, input, fake.dependencies); } catch (error) { failure = error; }
  assert.ok(apiError('ACCOUNT_DELETE_FAILED', 503)(failure));
  assert.ok(!JSON.stringify(await errorResponse(failure).json()).includes(input.confirmation_email));
  assert.deepEqual(fake.authDeletes, [{ id: targetId, soft: false }]);
  assert.deepEqual(fake.events, ['prepare', 'prepare', 'prepare', 'auth', 'prepare']);
});

test('a lost Auth response is accepted only after the database confirms the target is absent', async () => {
  const fake = fakeService([present(), present(), present(), missing(), missing()], { authError: 'Network response lost' });
  assert.deepEqual(await deleteClassroomAccount(actor, input, fake.dependencies), { deleted: true });
  assert.deepEqual(fake.authDeletes, [{ id: targetId, soft: false }]);
  assert.deepEqual(fake.events, ['prepare', 'prepare', 'prepare', 'auth', 'prepare', 'prepare']);
});

test('an apparent successful Auth delete must still pass the final absence verification', async () => {
  const fake = fakeService([present(), present(), present(), present()]);
  await assert.rejects(deleteClassroomAccount(actor, input, fake.dependencies), apiError('ACCOUNT_DELETE_FAILED', 503));
  assert.equal(fake.authDeletes.length, 1);
  assert.deepEqual(fake.events, ['prepare', 'prepare', 'prepare', 'auth', 'prepare']);
});

test('an already missing target is a safe retry with no Storage or Auth side effects', async () => {
  for (const replies of [[missing()], [present(), missing()], [present(), present(), missing()]]) {
    const fake = fakeService(replies);
    assert.deepEqual(await deleteClassroomAccount(actor, input, fake.dependencies), { deleted: true });
    assert.deepEqual(fake.removals, []);
    assert.deepEqual(fake.authDeletes, []);
  }
});
