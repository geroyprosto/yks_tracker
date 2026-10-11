import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STUDENT = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const TEACHER = '44444444-4444-4444-8444-444444444444';
const SUSPENDED = '55555555-5555-4555-8555-555555555555';
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
  for (const id of [OWNER, STUDENT, OTHER, TEACHER, SUSPENDED]) {
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id, `${id}@example.test`]);
  }
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, migrations), 'utf8'));
  }
  await db.query('insert into public.owner_allowlist(user_id) values($1)', [OWNER]);
  for (const [id, role, status] of [[STUDENT, 'student', 'approved'], [OTHER, 'student', 'approved'], [TEACHER, 'teacher', 'approved'], [SUSPENDED, 'student', 'suspended']]) {
    await db.query("insert into public.classroom_accounts(id,name,email,role,status) values($1,'Test',$2,$3,$4)", [id, `${id}@example.test`, role, status]);
  }
  for (const id of [OWNER, STUDENT, OTHER, SUSPENDED]) {
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
