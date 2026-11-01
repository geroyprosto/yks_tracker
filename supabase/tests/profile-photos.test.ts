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
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id integer generated always as identity primary key,bucket_id text not null,name text not null,
      metadata jsonb default '{}',unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
    grant usage,select on sequence storage.objects_id_seq to anon,authenticated,service_role;`);
  for (const id of [OWNER, STUDENT, OTHER, TEACHER, SUSPENDED]) {
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id, `${id}@example.test`]);
  }
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    if (name.endsWith('_retire_profile_photos.sql')) {
      // Existing Storage metadata must survive the migration for later Storage API cleanup.
      for (const id of [OWNER, STUDENT, OTHER]) {
        await db.query("insert into storage.objects(bucket_id,name) values('profile-photos',$1)", [`${id}/avatar.webp`]);
      }
    }
    await db.exec(await readFile(new URL(name, migrations), 'utf8'));
  }
  await db.query('insert into public.owner_allowlist(user_id) values($1)', [OWNER]);
  for (const [id, role, status] of [[STUDENT, 'student', 'approved'], [OTHER, 'student', 'approved'], [TEACHER, 'teacher', 'approved'], [SUSPENDED, 'student', 'suspended']]) {
    await db.query("insert into public.classroom_accounts(id,name,email,role,status) values($1,'Test',$2,$3,$4)", [id, `${id}@example.test`, role, status]);
  }
  const group = (await db.query<{ id: string }>(
    "insert into private.friend_groups(owner_id,name,timezone) values($1,'Former photo friends','Europe/Istanbul') returning id", [STUDENT])).rows[0].id;
  for (const id of [STUDENT, OTHER]) {
    await db.query('insert into private.friend_group_members(group_id,user_id) values($1,$2)', [group, id]);
  }
  // A permissive policy for another feature must not reopen the retired bucket.
  await db.exec(`create policy fixture_broad_storage on storage.objects for all to anon,authenticated using(true) with check(true);
    insert into storage.buckets(id,name,public) values('fixture-files','fixture-files',false);`);
});

after(async () => { await db?.close(); });

async function actor(id: string, oauth = false) {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role: 'authenticated', ...(oauth ? { client_id: 'mcp-client' } : {}) })]);
  await db.query("select set_config('request.jwt.claim.client_id',$1,false)", [oauth ? 'mcp-client' : '']);
}

test('retirement retains private object metadata for API cleanup and removes photo RPCs', async () => {
  await db.exec('reset role');
  assert.deepEqual((await db.query<{ name: string }>("select name from storage.objects where bucket_id='profile-photos' order by name")).rows.map(row => row.name),
    [OWNER, STUDENT, OTHER].map(id => `${id}/avatar.webp`));
  assert.equal((await db.query<{ public: boolean }>("select public from storage.buckets where id='profile-photos'")).rows[0].public, false);
  assert.deepEqual((await db.query("select to_regprocedure('public.profile_photo_can_read(uuid)') as public_rpc, to_regprocedure('private.profile_photo_can_read(uuid)') as private_rpc")).rows,
    [{ public_rpc: null, private_rpc: null }]);
});

test('all browser identities lose photo access even with an unrelated permissive policy', async () => {
  for (const [id, oauth] of [[OWNER, false], [STUDENT, false], [OTHER, false], [TEACHER, false], [SUSPENDED, false], [STUDENT, true], ['', false]] as const) {
    if (id) await actor(id, oauth);
    else await db.exec('reset role; set role anon');
    assert.equal((await db.query("select name from storage.objects where bucket_id='profile-photos'")).rows.length, 0);
    assert.equal((await db.query("update storage.objects set metadata='{}' where bucket_id='profile-photos' returning id")).rows.length, 0);
    assert.equal((await db.query("delete from storage.objects where bucket_id='profile-photos' returning id")).rows.length, 0);
    await assert.rejects(() => db.query("insert into storage.objects(bucket_id,name) values('profile-photos',$1)", [`${id || 'anonymous'}/new.webp`]), /row-level security/);
  }
});

test('overwrites and moves cannot restore access to the retired photo bucket', async () => {
  await actor(STUDENT);
  await assert.rejects(() => db.query(`insert into storage.objects(bucket_id,name,metadata) values('profile-photos',$1,'{"size":2048}')
    on conflict(bucket_id,name) do update set metadata=excluded.metadata`, [`${STUDENT}/avatar.webp`]), /row-level security/);
  assert.equal((await db.query("update storage.objects set bucket_id='fixture-files' where bucket_id='profile-photos' returning id")).rows.length, 0);
  await db.query("insert into storage.objects(bucket_id,name) values('fixture-files','move.bin')");
  await assert.rejects(() => db.query("update storage.objects set bucket_id='profile-photos' where bucket_id='fixture-files' and name='move.bin'"), /row-level security/);
  await db.query("delete from storage.objects where bucket_id='fixture-files' and name='move.bin'");
});

test('unrelated buckets and trusted service-role Storage maintenance remain available', async () => {
  await actor(STUDENT);
  await db.query("insert into storage.objects(bucket_id,name) values('fixture-files','file.bin')");
  assert.equal((await db.query("select id from storage.objects where bucket_id='fixture-files' and name='file.bin'")).rows.length, 1);
  assert.equal((await db.query("update storage.objects set metadata='{\"size\":100}' where bucket_id='fixture-files' and name='file.bin' returning id")).rows.length, 1);
  assert.equal((await db.query("delete from storage.objects where bucket_id='fixture-files' and name='file.bin' returning id")).rows.length, 1);
  await db.exec('reset role; set role service_role');
  assert.equal((await db.query("select id from storage.objects where bucket_id='profile-photos'")).rows.length, 3);
  assert.equal((await db.query("delete from storage.objects where bucket_id='profile-photos' and name=$1 returning id", [`${OTHER}/avatar.webp`])).rows.length, 1);
});
