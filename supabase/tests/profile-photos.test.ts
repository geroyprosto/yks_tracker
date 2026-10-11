import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STUDENT = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const TEACHER = '44444444-4444-4444-8444-444444444444';
const SUSPENDED = '55555555-5555-4555-8555-555555555555';
const INDIRECT = '66666666-6666-4666-8666-666666666666';
const UNKNOWN = '77777777-7777-4777-8777-777777777777';
let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id integer generated always as identity primary key,bucket_id text not null,name text not null,metadata jsonb default '{}');
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to authenticated;
    grant usage,select on sequence storage.objects_id_seq to authenticated;`);
  for (const id of [OWNER, STUDENT, OTHER, TEACHER, SUSPENDED, INDIRECT]) {
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id, `${id}@example.test`]);
  }
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, migrations), 'utf8'));
  }
  await db.query('insert into public.owner_allowlist(user_id) values($1)', [OWNER]);
  for (const [id, role, status] of [[STUDENT, 'student', 'approved'], [OTHER, 'student', 'approved'], [TEACHER, 'teacher', 'approved'], [SUSPENDED, 'student', 'suspended'], [INDIRECT, 'student', 'approved']]) {
    await db.query("insert into public.classroom_accounts(id,name,email,role,status) values($1,'Test',$2,$3,$4)", [id, `${id}@example.test`, role, status]);
  }
  for (const id of [OWNER, STUDENT, OTHER, SUSPENDED, INDIRECT]) {
    await db.query("insert into storage.objects(bucket_id,name) values('profile-photos',$1)", [`${id}/avatar.webp`]);
  }
});
after(async () => { await db?.close(); });

async function actor(id: string, oauth = false) {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role: 'authenticated', ...(oauth ? { client_id: 'mcp-client' } : {}) })]);
  await db.query("select set_config('request.jwt.claim.client_id',$1,false)", [oauth ? 'mcp-client' : '']);
}

test('photo bucket is private and allows only bounded WebP objects', async () => {
  await db.exec('reset role');
  const bucket = (await db.query<{ public: boolean; file_size_limit: number; allowed_mime_types: string[] }>("select public,file_size_limit,allowed_mime_types from storage.buckets where id='profile-photos'")).rows[0];
  assert.ok(bucket);
  assert.equal(bucket.public, false);
  assert.equal(Number(bucket.file_size_limit), 1024 * 1024);
  assert.deepEqual(bucket.allowed_mime_types, ['image/webp']);
});

test('students and owner may read, replace and delete only their own avatar', async () => {
  for (const id of [OWNER, STUDENT, OTHER]) {
    await actor(id);
    const photos = await db.query<{ name: string }>("select name from storage.objects where bucket_id='profile-photos'");
    assert.deepEqual(photos.rows.map(row => row.name), [`${id}/avatar.webp`]);
    assert.equal((await db.query("update storage.objects set metadata='{}' where bucket_id='profile-photos' returning id")).rows.length, 1);
    await assert.rejects(db.query("update storage.objects set name=$1 where bucket_id='profile-photos'", [`${TEACHER}/avatar.webp`]), /row-level security/);
    assert.equal((await db.query("delete from storage.objects where bucket_id='profile-photos' returning id")).rows.length, 1);
    await db.query("insert into storage.objects(bucket_id,name) values('profile-photos',$1)", [`${id}/avatar.webp`]);
    for (const path of [`${TEACHER}/avatar.webp`, `${id}/other.webp`, `${id}/avatar.svg`]) {
      await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('profile-photos',$1)", [path]), /row-level security/);
    }
  }
});

test('teacher, suspended student and OAuth client cannot read or mutate private photos', async () => {
  for (const [id, oauth] of [[TEACHER, false], [SUSPENDED, false], [STUDENT, true]] as const) {
    await actor(id, oauth);
    assert.equal((await db.query("select id from storage.objects where bucket_id='profile-photos'")).rows.length, 0);
    assert.equal((await db.query("update storage.objects set metadata='{}' where bucket_id='profile-photos' returning id")).rows.length, 0);
    assert.equal((await db.query("delete from storage.objects where bucket_id='profile-photos' returning id")).rows.length, 0);
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('profile-photos',$1)", [`${id}/avatar.webp`]), /row-level security/);
  }
});

test('an unrelated broad storage policy cannot expose another student photo', async () => {
  await db.exec('reset role; create policy unrelated_read on storage.objects for select to authenticated using(true)');
  await actor(STUDENT);
  assert.deepEqual((await db.query<{ name: string }>("select name from storage.objects where bucket_id='profile-photos'")).rows.map(row => row.name), [`${STUDENT}/avatar.webp`]);
  await actor(STUDENT, true);
  assert.equal((await db.query("select name from storage.objects where bucket_id='profile-photos'")).rows.length, 0);
});

async function shareGroup(...members: string[]) {
  await db.exec('reset role');
  const group = (await db.query<{ id: string }>(
    "insert into private.friend_groups(owner_id,name,timezone) values($1,'Photo friends','Europe/Istanbul') returning id", [members[0]])).rows[0].id;
  for (const id of members) {
    await db.query('insert into private.friend_group_members(group_id,user_id) values($1,$2)', [group, id]);
  }
  return group;
}

async function canRead(id: string) {
  return (await db.query<{ allowed: boolean }>('select public.profile_photo_can_read($1::uuid) as allowed', [id])).rows[0].allowed;
}

async function visiblePhotos() {
  return (await db.query<{ name: string }>("select name from storage.objects where bucket_id='profile-photos' order by name")).rows.map(row => row.name);
}

test('only current approved peers share photos and the relationship is not transitive', async () => {
  const first = await shareGroup(STUDENT, OTHER, TEACHER, SUSPENDED);
  const second = await shareGroup(OTHER, INDIRECT);
  await actor(STUDENT);
  assert.equal((await db.query<{ allowed: boolean }>('select public.profile_photo_can_read(null) as allowed')).rows[0].allowed, false);
  assert.equal(await canRead(STUDENT), true);
  assert.equal(await canRead(OTHER), true);
  for (const id of [INDIRECT, OWNER, TEACHER, SUSPENDED, UNKNOWN]) assert.equal(await canRead(id), false);
  assert.deepEqual(await visiblePhotos(), [`${STUDENT}/avatar.webp`, `${OTHER}/avatar.webp`]);
  await actor(OTHER);
  assert.equal(await canRead(STUDENT), true);
  assert.equal(await canRead(INDIRECT), true);
  await db.exec('reset role');
  await db.query('delete from private.friend_groups where id in ($1,$2)', [first, second]);
});

test('shared read access never grants peer photo writes, even with broad storage policies', async () => {
  const group = await shareGroup(STUDENT, OTHER);
  await db.exec('reset role; create policy unrelated_write on storage.objects for all to authenticated using(true) with check(true)');
  await actor(STUDENT);
  assert.equal(await canRead(OTHER), true);
  assert.equal((await db.query("update storage.objects set metadata='{}' where bucket_id='profile-photos' and name=$1 returning id", [`${OTHER}/avatar.webp`])).rows.length, 0);
  assert.equal((await db.query("delete from storage.objects where bucket_id='profile-photos' and name=$1 returning id", [`${OTHER}/avatar.webp`])).rows.length, 0);
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('profile-photos',$1)", [`${OTHER}/avatar.webp`]), /row-level security/);
  await assert.rejects(db.query("update storage.objects set name=$1 where bucket_id='profile-photos' and name=$2", [`${OTHER}/avatar.webp`, `${STUDENT}/avatar.webp`]), /row-level security/);
  await db.exec('reset role; drop policy unrelated_write on storage.objects');
  await db.query('delete from private.friend_groups where id=$1', [group]);
});

test('removing the last shared group or leaving it immediately revokes photo reads', async () => {
  const first = await shareGroup(STUDENT, OTHER);
  const second = await shareGroup(STUDENT, OTHER);
  await actor(STUDENT);
  assert.equal(await canRead(OTHER), true);
  await db.query('select public.friend_remove($1::uuid,$2::uuid)', [OTHER, first]);
  assert.equal(await canRead(OTHER), true);
  await db.query('select public.friend_remove($1::uuid,$2::uuid)', [STUDENT, second]);
  assert.equal(await canRead(OTHER), false);
  assert.deepEqual(await visiblePhotos(), [`${STUDENT}/avatar.webp`]);
  await actor(OTHER);
  assert.equal(await canRead(STUDENT), false);
  await db.exec('reset role');
  await db.query('delete from private.friend_groups where id in ($1,$2)', [first, second]);
});

test('suspension, teacher role and OAuth sessions block shared photo reads', async () => {
  const group = await shareGroup(STUDENT, OTHER, TEACHER, SUSPENDED);
  await db.exec('reset role');
  await db.query("update public.classroom_accounts set status='suspended' where id=$1", [OTHER]);
  await actor(STUDENT);
  assert.equal(await canRead(OTHER), false);
  await db.exec('reset role');
  await db.query("update public.classroom_accounts set status='approved' where id=$1", [OTHER]);
  for (const [id, oauth] of [[TEACHER, false], [SUSPENDED, false], [STUDENT, true]] as const) {
    await actor(id, oauth);
    assert.equal(await canRead(STUDENT), false);
    assert.equal(await canRead(OTHER), false);
    assert.deepEqual(await visiblePhotos(), []);
  }
  await db.exec('reset role; set role anon');
  await assert.rejects(() => canRead(STUDENT), /permission denied/);
  await db.exec('reset role; set role service_role');
  await assert.rejects(() => canRead(STUDENT), /permission denied/);
  await db.exec('reset role');
  await db.query('delete from private.friend_groups where id=$1', [group]);
});

test('shared read policies safely reject non-avatar and malformed object names', async () => {
  const group = await shareGroup(STUDENT, OTHER);
  await db.exec('reset role');
  for (const name of ['not-a-uuid/avatar.webp', `${OTHER}/other.webp`, `${OTHER}/avatar.webp/extra`, `${OTHER}/avatar.svg`]) {
    await db.query("insert into storage.objects(bucket_id,name) values('profile-photos',$1)", [name]);
  }
  await actor(STUDENT);
  assert.deepEqual(await visiblePhotos(), [`${STUDENT}/avatar.webp`, `${OTHER}/avatar.webp`]);
  await db.exec('reset role');
  await db.query('delete from private.friend_groups where id=$1', [group]);
});
