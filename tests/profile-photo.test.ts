import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../src/lib/server/http';
import { deleteProfilePhoto, getFriendProfilePhoto, getProfilePhoto, normalizeProfilePhoto, putProfilePhoto, readProfilePhoto, type PhotoContext } from '../src/lib/server/profile-photo';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const failure = (code: string, status: number) => (error: unknown) => error instanceof ApiError && error.code === code && error.status === status;
function request(body: Uint8Array | string, type = 'image/png', extra: Record<string, string> = {}) {
  return new Request('https://study.example/api/profile/photo?user_id=' + OTHER, {
    method: 'PUT', headers: { 'content-type': type, ...extra }, body: typeof body === 'string' ? body : new Uint8Array(body),
  });
}
function storage() {
  const files = new Map<string, Uint8Array>();
  const friends = new Set<string>();
  const downloads: string[] = [];
  const client = { rpc: async (name: string, args: { p_user_id: string }) => {
    assert.equal(name, 'profile_photo_can_read');
    return { data: args.p_user_id === USER || friends.has(args.p_user_id), error: null };
  }, storage: { from(bucket: string) {
    assert.equal(bucket, 'profile-photos');
    return {
      upload: async (path: string, bytes: Uint8Array) => { files.set(path, bytes); return { error: null }; },
      download: async (path: string) => {
        downloads.push(path);
        return files.has(path)
          ? { data: new Blob([new Uint8Array(files.get(path)!)]), error: null }
          : { data: null, error: { code: 'NoSuchKey', status: 400 } };
      },
      remove: async (paths: string[]) => { paths.forEach(path => files.delete(path)); return { error: null }; },
    };
  } } } as unknown as SupabaseClient;
  const context: PhotoContext = { client, user: { id: USER }, account: { id: USER, role: 'student', status: 'approved' }, demo: false };
  return { files, friends, downloads, context };
}

test('normalization produces a 512px square WebP with metadata removed', async () => {
  const original = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#d5aaff' } })
    .jpeg().withExif({ IFD0: { Artist: 'Private author', Copyright: 'Private information' } }).toBuffer();
  const photo = await normalizeProfilePhoto(original);
  const metadata = await sharp(photo).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
});

test('SVG, GIF and corrupt files cannot masquerade as accepted photos', async () => {
  const gif = await sharp({ create: { width: 5, height: 5, channels: 3, background: 'red' } }).gif().toBuffer();
  for (const content of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="5" height="5"/>'), gif, Buffer.from('not an image')]) {
    await assert.rejects(normalizeProfilePhoto(content), failure('INVALID_PHOTO', 400));
  }
});

test('overlarge image dimensions are rejected even with a tiny compressed body', async () => {
  const png = await sharp({ create: { width: 5, height: 5, channels: 3, background: 'red' } }).png().toBuffer();
  png.writeUInt32BE(100_000, 16);
  png.writeUInt32BE(100_000, 20);
  await assert.rejects(normalizeProfilePhoto(png), failure('INVALID_PHOTO', 400));
});

test('raw upload reading rejects unsupported MIME, empty bodies and both announced and actual oversize bodies', async () => {
  await assert.rejects(readProfilePhoto(request('hello', 'image/svg+xml')), failure('PHOTO_TYPE_UNSUPPORTED', 415));
  await assert.rejects(readProfilePhoto(request('')), failure('INVALID_PHOTO', 400));
  await assert.rejects(readProfilePhoto(request('small', 'image/png', { 'content-length': String(4 * 1024 * 1024 + 1) })), failure('PHOTO_TOO_LARGE', 413));
  await assert.rejects(readProfilePhoto(request(new Uint8Array(4 * 1024 * 1024 + 1))), failure('PHOTO_TOO_LARGE', 413));
});

test('upload, replacement, read and deletion affect only the authenticated account', async () => {
  const { files, context } = storage();
  const otherPhoto = new Uint8Array([1, 2, 3]);
  files.set(`${OTHER}/avatar.webp`, otherPhoto);
  const image = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'blue' } }).png().toBuffer();
  await assert.rejects(getProfilePhoto(context), failure('PHOTO_NOT_FOUND', 404));
  await putProfilePhoto(context, request(image));
  assert.equal(files.size, 2);
  assert.equal((await sharp(await getProfilePhoto(context)).metadata()).format, 'webp');
  await putProfilePhoto(context, request(image));
  assert.equal(files.size, 2);
  await deleteProfilePhoto(context);
  await deleteProfilePhoto(context);
  assert.deepEqual(files.get(`${OTHER}/avatar.webp`), otherPhoto);
  await assert.rejects(getProfilePhoto(context), failure('PHOTO_NOT_FOUND', 404));
});

test('pending, suspended, teacher and mismatched identities cannot reach photo storage', async () => {
  const { context, files } = storage();
  for (const account of [null, { id: USER, role: 'student', status: 'pending' }, { id: USER, role: 'student', status: 'suspended' }, { id: USER, role: 'teacher', status: 'approved' }, { id: OTHER, role: 'student', status: 'approved' }]) {
    const blocked = { ...context, account };
    await assert.rejects(getProfilePhoto(blocked), failure('STUDENT_REQUIRED', 403));
    await assert.rejects(putProfilePhoto(blocked, request('invalid')), failure('STUDENT_REQUIRED', 403));
    await assert.rejects(deleteProfilePhoto(blocked), failure('STUDENT_REQUIRED', 403));
  }
  assert.equal(files.size, 0);
});

test('demo photo reads fall back to initials while changes are explicitly disabled', async () => {
  const { context } = storage();
  const demo = { ...context, demo: true };
  await assert.rejects(getProfilePhoto(demo), failure('PHOTO_NOT_FOUND', 404));
  await assert.rejects(putProfilePhoto(demo, request('invalid')), failure('DEMO_INTEGRATION_DISABLED', 403));
  await assert.rejects(deleteProfilePhoto(demo), failure('DEMO_INTEGRATION_DISABLED', 403));
});

test('storage authorization or outage errors are not mistaken for a missing photo', async () => {
  const { context } = storage();
  context.client = { storage: { from: () => ({ download: async () => ({ data: null, error: { code: 'AccessDenied', status: 403, message: 'private database details' } }) }) } } as unknown as SupabaseClient;
  await assert.rejects(getProfilePhoto(context), failure('PHOTO_STORAGE_UNAVAILABLE', 503));
});

test('friend photos require a current relationship before their exact avatar is downloaded', async () => {
  const { context, files, friends, downloads } = storage();
  const photo = new Uint8Array([1, 2, 3]);
  files.set(`${OTHER}/avatar.webp`, photo);
  await assert.rejects(getFriendProfilePhoto(context, OTHER), failure('PHOTO_NOT_FOUND', 404));
  assert.deepEqual(downloads, []);
  friends.add(OTHER);
  assert.deepEqual(await getFriendProfilePhoto(context, OTHER), Buffer.from(photo));
  assert.deepEqual(downloads, [`${OTHER}/avatar.webp`]);
  friends.delete(OTHER);
  await assert.rejects(getFriendProfilePhoto(context, OTHER), failure('PHOTO_NOT_FOUND', 404));
  assert.equal(downloads.length, 1);
});

test('friend photo reads support self, reject malformed targets and keep missing images private', async () => {
  const { context, friends, files, downloads } = storage();
  files.set(`${USER}/avatar.webp`, new Uint8Array([4, 5]));
  assert.deepEqual(await getFriendProfilePhoto(context, USER), Buffer.from([4, 5]));
  for (const id of ['', '../avatar.webp', `${OTHER}/other.webp`, 'not-a-uuid']) {
    await assert.rejects(getFriendProfilePhoto(context, id), failure('INVALID_INPUT', 400));
  }
  friends.add(OTHER);
  await assert.rejects(getFriendProfilePhoto(context, OTHER), failure('PHOTO_NOT_FOUND', 404));
  assert.deepEqual(downloads, [`${USER}/avatar.webp`, `${OTHER}/avatar.webp`]);
});

test('friend photo access fails closed when authorization lookup fails', async () => {
  const { context, downloads } = storage();
  context.client.rpc = (async () => ({ data: true, error: { message: 'internal database details' } })) as unknown as SupabaseClient['rpc'];
  await assert.rejects(getFriendProfilePhoto(context, OTHER), failure('PHOTO_STORAGE_UNAVAILABLE', 503));
  assert.deepEqual(downloads, []);
});

test('blocked accounts and demos cannot read friend photos', async () => {
  const { context, downloads } = storage();
  await assert.rejects(getFriendProfilePhoto({ ...context, demo: true }, OTHER), failure('PHOTO_NOT_FOUND', 404));
  await assert.rejects(getFriendProfilePhoto({ ...context, account: null }, OTHER), failure('STUDENT_REQUIRED', 403));
  assert.deepEqual(downloads, []);
});
