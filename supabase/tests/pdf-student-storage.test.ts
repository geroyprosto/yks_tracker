import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const OTHER_STUDENT = "33333333-3333-4333-8333-333333333333";
const TEACHER = "44444444-4444-4444-8444-444444444444";
const SUSPENDED = "55555555-5555-4555-8555-555555555555";
const SHA = "a".repeat(64);
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
    create table storage.objects(id integer generated always as identity primary key,bucket_id text not null,name text not null);
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    grant select,insert,delete on storage.objects to authenticated;
    grant usage,select on sequence storage.objects_id_seq to authenticated;`);
  const users = [OWNER, STUDENT, OTHER_STUDENT, TEACHER, SUSPENDED];
  for (const id of users) {
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, `${id}@example.test`]);
  }
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, migrations), "utf8"));
  }
  await db.query("insert into public.owner_allowlist(user_id) values($1)", [OWNER]);
  for (const [id, role, status] of [
    [STUDENT, "student", "approved"],
    [OTHER_STUDENT, "student", "approved"],
    [TEACHER, "teacher", "approved"],
    [SUSPENDED, "student", "suspended"],
  ]) {
    await db.query("insert into public.classroom_accounts(id,name,email,role,status) values($1,'Test',$2,$3,$4)",
      [id, `${id}@example.test`, role, status]);
  }
  for (const id of [OWNER, STUDENT, OTHER_STUDENT, SUSPENDED]) {
    await db.query("insert into storage.objects(bucket_id,name) values('exam-documents',$1)",
      [`${id}/${SHA}.pdf`]);
  }
});
after(async () => { await db?.close(); });

async function asBrowser(id: string, oauth = false) {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query("select set_config('request.jwt.claims',$1,false)",
    [JSON.stringify({sub: id, role: "authenticated", ...(oauth ? {client_id: "mcp-client"} : {})})]);
  await db.query("select set_config('request.jwt.claim.client_id',$1,false)", [oauth ? "mcp-client" : ""]);
}

test("approved students and owner can only access their own exam PDF folder", async () => {
  for (const id of [OWNER, STUDENT, OTHER_STUDENT]) {
    await asBrowser(id);
    const own = await db.query<{name: string}>("select name from storage.objects where bucket_id='exam-documents'");
    assert.deepEqual(own.rows.map(row => row.name), [`${id}/${SHA}.pdf`]);
    await db.query("insert into storage.objects(bucket_id,name) values('exam-documents',$1)",
      [`${id}/${"b".repeat(64)}.pdf`]);
    await assert.rejects(() => db.query(
      "insert into storage.objects(bucket_id,name) values('exam-documents',$1)",
      [`${TEACHER}/${"c".repeat(64)}.pdf`]), /row-level security policy/);
  }
});

test("teacher, suspended student and OAuth client cannot access private PDFs", async () => {
  for (const id of [TEACHER, SUSPENDED]) {
    await asBrowser(id);
    assert.equal((await db.query("select name from storage.objects where bucket_id='exam-documents'")).rows.length, 0);
    await assert.rejects(() => db.query(
      "insert into storage.objects(bucket_id,name) values('exam-documents',$1)",
      [`${id}/${"b".repeat(64)}.pdf`]), /row-level security policy/);
  }
  await asBrowser(STUDENT, true);
  assert.equal((await db.query("select name from storage.objects where bucket_id='exam-documents'")).rows.length, 0);
  await assert.rejects(() => db.query(
    "insert into storage.objects(bucket_id,name) values('exam-documents',$1)",
    [`${STUDENT}/${"c".repeat(64)}.pdf`]), /row-level security policy/);
});

test("student PDF registration and reviewed import remain isolated per account", async () => {
  const candidates = [{index: 0, label: "TYT", student_label: null, format_code: "TYT",
    exam_date: "2026-09-14", name: "PDF deneme", publisher: null, results: [],
    source_pages: [1], warnings: ["İncele"]}];
  await asBrowser(STUDENT);
  const registered = await db.query<{value: {id: string}}>(
    "select public.exam_import_register($1,$2,$3,$4,$5,$6::jsonb) as value",
    ["d".repeat(64), "deneme.pdf", 1024, 1, "needs_visual_review", JSON.stringify(candidates)]);
  const documentId = registered.rows[0].value.id;
  const visible = await db.query<{user_id: string}>("select user_id from public.exam_documents where id=$1", [documentId]);
  assert.equal(visible.rows[0].user_id, STUDENT);
  const payload = {name: "PDF deneme", exam_date: "2026-09-14", format_code: "TYT",
    results: [], reported_total_net: 61.5};
  const committed = await db.query<{value: {id: string}}>(
    "select public.exam_import_commit($1,$2,0,$3::jsonb,false) as value",
    [randomUUID(), documentId, JSON.stringify(payload)]);
  assert.equal((await db.query<{user_id: string}>("select user_id from public.exams where id=$1",
    [committed.rows[0].value.id])).rows[0].user_id, STUDENT);

  await asBrowser(OTHER_STUDENT);
  assert.equal((await db.query("select id from public.exam_documents where id=$1", [documentId])).rows.length, 0);
  await assert.rejects(() => db.query(
    "select public.exam_import_commit($1,$2,0,$3::jsonb,false)",
    [randomUUID(), documentId, JSON.stringify(payload)]), /NOT_FOUND/);
  for (const id of [TEACHER, SUSPENDED]) {
    await asBrowser(id);
    await assert.rejects(() => db.query(
      "select public.exam_import_register($1,$2,$3,$4,$5,$6::jsonb)",
      ["e".repeat(64), "deneme.pdf", 1024, 1, "needs_visual_review", JSON.stringify(candidates)]), /OWNER_REQUIRED/);
  }
});
