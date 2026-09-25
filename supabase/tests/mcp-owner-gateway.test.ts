import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;`);
  await db.query("insert into auth.users values($1),($2)", [OWNER, OTHER]);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort()) {
    if (name === "20260925182000_mcp_owner_gateway.sql") {
      // Embedded Postgres has no Supabase Storage. Add a permissive stub policy
      // so the new restrictive bucket policy has a meaningful interaction.
      await db.exec(`create schema storage; create table storage.objects (
        id integer generated always as identity primary key, bucket_id text not null, name text not null
      ); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated;
      grant select, insert on storage.objects to authenticated;
      create policy existing_owner_read on storage.objects for select to authenticated using (true);
      create policy existing_owner_insert on storage.objects for insert to authenticated with check (true);
      insert into storage.objects(bucket_id,name) values
        ('exam-documents','owner/report.pdf'),('other-bucket','public/example.pdf');`);
    }
    await db.exec(await readFile(new URL(name, migrations), "utf8"));
  }
  await db.query("insert into public.owner_allowlist(user_id) values($1)", [OWNER]);
});

after(async () => { await db?.close(); });

async function browser(userId = OWNER) {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.query("select set_config('request.jwt.claims',$1,false)",
    [JSON.stringify({sub: userId, role: "authenticated", aud: "authenticated"})]);
  await db.query("select set_config('request.jwt.claim.client_id','',false)");
}
async function oauth(userId = OWNER) {
  await browser(userId);
  await db.query("select set_config('request.jwt.claims',$1,false)",
    [JSON.stringify({sub: userId, role: "authenticated",
      client_id: "chatgpt-client", aud: "https://study.example.com/api/mcp"})]);
}
async function service() {
  await db.exec("reset role; set role service_role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.query("select set_config('request.jwt.claim.client_id','',false)");
  await db.query("select set_config('request.jwt.claims',$1,false)",
    [JSON.stringify({role: "service_role", aud: "service_role"})]);
}

test("ordinary browser owner still reads data and calls existing RPCs", async () => {
  await browser();
  const state = await db.query<{value: {settings: {display_name: string}}}>(
    "select public.yks_state() as value");
  assert.equal(state.rows[0].value.settings.display_name, "Sümeyra");
  const result = await db.query<{value: {id: string}}>(
    "select public.yks_command($1::uuid,'task.create',$2::jsonb) as value",
    [randomUUID(), JSON.stringify({title: "Browser task", plan_date: "2026-09-25"})]);
  assert.ok(result.rows[0].value.id);
  assert.equal((await db.query("select id from public.tasks")).rows.length, 1);
  assert.equal((await db.query("select id from storage.objects where bucket_id='exam-documents'")).rows.length, 1);
});

test("OAuth client bearer is denied on direct owner tables, all public owner RPCs and private Storage", async () => {
  await oauth();
  for (const table of ["owner_allowlist", "tasks", "topics", "journal_entries",
    "exam_documents", "exam_imports", "analysis_reports", "journal_ai_suggestions",
    "manual_study_entries"]) {
    const rows = await db.query(`select * from public.${table}`);
    assert.equal(rows.rows.length, 0, table);
  }
  const directRpc = [
    "select public.yks_state()",
    "select public.yks_command($1::uuid,'task.create',$2::jsonb)",
    "select public.exam_import_register($1,$2,$3,$4,$5,$6::jsonb,$7)",
    "select public.exam_import_commit($1::uuid,$1::uuid,0,$2::jsonb,false)",
  ];
  const params = [randomUUID(), JSON.stringify({title:"Blocked",plan_date:"2026-09-25"}),
    "a".repeat(64), "report.pdf", 100, 1, "application/pdf", "owner/report.pdf"];
  for (const statement of directRpc) {
    const values = statement.includes("exam_import_register") ? [params[2], params[3], params[4], params[5], params[6], "[]", params[7]]
      : statement.includes("yks_state") ? [] : params.slice(0, 2);
    await assert.rejects(() => db.query(statement, values), /OWNER_REQUIRED/, statement);
  }
  assert.equal((await db.query("select id from storage.objects where bucket_id='exam-documents'")).rows.length, 0);
  assert.equal((await db.query("select id from storage.objects where bucket_id='other-bucket'")).rows.length, 1);
  await assert.rejects(() => db.query(
    "insert into storage.objects(bucket_id,name) values('exam-documents','blocked.pdf')"),
  /row-level security policy/);
  await assert.rejects(() => db.query("select public.mcp_owner_state($1::uuid)", [OWNER]), /permission denied/);
  await assert.rejects(() => db.query(
    "select public.mcp_owner_command($1::uuid,$2::uuid,$3,$4::jsonb)",
    [OWNER, randomUUID(), "task.create", "{}"]), /permission denied/);
});

test("service gateway enforces owner target, command allowlist, idempotency and claim restoration", async () => {
  await service();
  assert.equal((await db.query<{value: boolean}>(
    "select public.mcp_owner_allowed($1::uuid) as value", [OWNER])).rows[0].value, true);
  assert.equal((await db.query<{value: boolean}>(
    "select public.mcp_owner_allowed($1::uuid) as value", [OTHER])).rows[0].value, false);
  await assert.rejects(() => db.query("select public.mcp_owner_state($1::uuid)", [OTHER]), /OWNER_REQUIRED/);
  const state = await db.query<{value: {tasks: Array<{title: string}>}}>(
    "select public.mcp_owner_state($1::uuid) as value", [OWNER]);
  assert.equal(state.rows[0].value.tasks.some(task => task.title === "Browser task"), true);
  assert.equal((await db.query<{value: string}>(
    "select current_setting('request.jwt.claim.sub',true) as value")).rows[0].value, "");
  const requestId = randomUUID();
  const args = [OWNER, requestId, "task.create",
    JSON.stringify({title: "MCP task", plan_date: "2026-09-25"})];
  const sql = "select public.mcp_owner_command($1::uuid,$2::uuid,$3,$4::jsonb) as value";
  const created = (await db.query<{value:{id:string;replayed:boolean}}>(sql, args)).rows[0].value;
  assert.equal(created.replayed, false);
  const replay = (await db.query<{value:{id:string;replayed:boolean}}>(sql, args)).rows[0].value;
  assert.equal(replay.id, created.id);
  assert.equal(replay.replayed, true);
  await db.exec("reset role");
  assert.equal((await db.query<{source:string}>(
    "select source from public.audit_log where entity='mcp_call' and entity_id=$1::uuid",
    [created.id])).rows.length, 1);
  await service();
  await assert.rejects(() => db.query(sql, [
    OWNER, randomUUID(), "journal.create", JSON.stringify({})]), /INVALID_INPUT/);
  assert.equal((await db.query<{value: string}>(
    "select current_setting('request.jwt.claim.sub',true) as value")).rows[0].value, "");
  await assert.rejects(() => db.query(sql, [
    OTHER, randomUUID(), "task.create", JSON.stringify({title:"No",plan_date:"2026-09-25"})]),
  /OWNER_REQUIRED/);
});



