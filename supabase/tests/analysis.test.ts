import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role; create schema auth;" +
    "create table auth.users(id uuid primary key);" +
    "create function auth.uid() returns uuid language sql stable as $$" +
    " select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;" +
    "grant usage on schema public,auth to anon,authenticated,service_role;" +
    "grant execute on function auth.uid() to anon,authenticated,service_role;");
  await db.query("insert into auth.users values($1),($2)", [OWNER, OTHER]);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, migrations), "utf8"));
  }
  await db.query("insert into public.owner_allowlist(user_id) values($1)", [OWNER]);
  await asOwner();
  await db.query("select public.yks_state()");
});
after(async () => { await db?.close(); });

async function asOwner() {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [OWNER]);
}
async function asOther() {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [OTHER]);
}
async function asService() {
  await db.exec("reset role; set role service_role; reset request.jwt.claim.sub");
}
async function admin(sql: string, values: unknown[] = []) {
  await db.exec("reset role");
  try { return await db.query(sql, values); }
  finally { await asOwner(); }
}
type Claim = {
  report: { id: string; status: string; request_id: string };
  claimed: boolean;
  replayed: boolean;
};
async function claim(requestId: string, hash = HASH_A, maxRequests = 3, reserve = 0.2) {
  await asService();
  try {
    const result = await db.query<{ value: Claim }>(
      "select public.analysis_report_claim_for_owner($1::uuid,$2::uuid,$3::date,$4::date,$5::text," +
        "$6::integer,$7::numeric,$8::numeric) as value",
      [OWNER, requestId, "2026-09-01", "2026-09-14", hash, maxRequests, 1, reserve],
    );
    return result.rows[0].value;
  } finally { await asOwner(); }
}
async function usage() {
  const result = await db.query<{ requests: number; estimated_cost_usd: string }>(
    "select requests,estimated_cost_usd from public.analysis_usage where user_id=$1", [OWNER],
  );
  return result.rows[0];
}

test("only the server can change the owner schedule", async () => {
  await assert.rejects(
    () => db.query("select public.analysis_schedule_set(true,$1::date)", ["2026-09-25"]),
    /permission denied/,
  );
  await asService();
  const enabled = await db.query<{ value: { enabled: boolean; start_date: string } }>(
    "select to_jsonb(public.analysis_schedule_set_for_owner($1::uuid,true,$2::date)) as value",
    [OWNER, "2026-09-25"],
  );
  assert.equal(enabled.rows[0].value.enabled, true);
  assert.equal(enabled.rows[0].value.start_date, "2026-09-25");
  await assert.rejects(
    () => db.query("select public.analysis_schedule_set_for_owner($1::uuid,true,$2::date)", [OTHER, "2026-09-25"]),
    /OWNER_REQUIRED/,
  );
  await asOwner();
  await assert.rejects(() => db.query("update public.analysis_settings set enabled=false"), /permission denied/);
  await asOther();
  assert.equal((await db.query("select * from public.analysis_settings")).rows.length, 0);
  await assert.rejects(
    () => db.query("select public.analysis_schedule_set_for_owner($1::uuid,true,$2::date)", [OWNER, "2026-09-25"]),
    /permission denied/,
  );
  await asOwner();
});

test("claim is atomic, replay-safe, and rejects browser completion", async () => {
  const id = randomUUID();
  const first = await claim(id);
  assert.equal(first.claimed, true);
  assert.equal(first.report.status, "running");
  const repeat = await claim(id);
  assert.equal(repeat.claimed, false);
  assert.equal(repeat.replayed, true);
  assert.equal(repeat.report.id, first.report.id);
  await assert.rejects(() => claim(id, HASH_B), /IDEMPOTENCY_CONFLICT/);
  const sameSource = await claim(randomUUID());
  assert.equal(sameSource.claimed, false);
  assert.equal(sameSource.report.id, first.report.id);
  assert.equal((await usage()).requests, 1);
  assert.equal(Number((await usage()).estimated_cost_usd), 0.2);
  await assert.rejects(
    () => db.query("select public.analysis_report_finalize($1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb,$6::jsonb,$7::numeric)",
      [OWNER, first.report.id, id, "fabricated", "{}", "{}", 0.1]),
    /permission denied/,
  );
  await assert.rejects(() => db.query("update public.analysis_reports set status='completed'"), /permission denied/);
});

test("expired lease becomes uncertain without another paid attempt", async () => {
  const reportId = (await claim(randomUUID())).report.id;
  await admin("update public.analysis_reports set lease_expires_at=now()-interval '1 minute' where id=$1", [reportId]);
  const second = await claim(randomUUID());
  assert.equal(second.claimed, false);
  assert.equal(second.report.status, "uncertain");
  assert.equal((await usage()).requests, 1);
  await asService();
  const source = await db.query<{ value: { settings: unknown; tasks: unknown[]; journal_entries: unknown[] } }>(
    "select public.analysis_source_state($1::uuid) as value", [OWNER],
  );
  assert.ok(source.rows[0].value.settings);
  assert.ok(Array.isArray(source.rows[0].value.tasks));
  assert.ok(Array.isArray(source.rows[0].value.journal_entries));
  await assert.rejects(() => db.query("select public.analysis_source_state($1::uuid)", [OTHER]), /OWNER_REQUIRED/);
  await asOwner();
});

test("service finalization reconciles reserve once and cached result costs nothing", async () => {
  const existing = await admin("select id,request_id from public.analysis_reports where source_hash=$1", [HASH_A]);
  const { id, request_id } = existing.rows[0] as { id: string; request_id: string };
  await asService();
  const params = [OWNER, id, request_id, "Limited observations.", JSON.stringify({ days: 5 }),
    JSON.stringify({ input_tokens: 20 }), 0.12];
  const sql = "select to_jsonb(public.analysis_report_finalize($1::uuid,$2::uuid,$3::uuid,$4::text," +
    "$5::jsonb,$6::jsonb,$7::numeric)) as value";
  const completed = await db.query<{ value: { status: string } }>(sql, params);
  assert.equal(completed.rows[0].value.status, "completed");
  await db.query(sql, params);
  await assert.rejects(
    () => db.query(sql, [OWNER, id, randomUUID(), "late worker", "{}", "{}", 0.1]),
    /STALE_ATTEMPT/,
  );
  await asOwner();
  const cached = await claim(randomUUID());
  assert.equal(cached.claimed, false);
  assert.equal(cached.report.status, "completed");
  assert.equal(Number((await usage()).estimated_cost_usd), 0.12);
});

test("failed attempt stays blocked, retains budget, and stays private", async () => {
  const id = randomUUID();
  const second = await claim(id, HASH_B, 3, 0.3);
  assert.equal(second.claimed, true);
  await asService();
  const failed = await db.query<{ value: { status: string } }>(
    "select to_jsonb(public.analysis_report_fail($1::uuid,$2::uuid,$3::uuid,$4::text)) as value",
    [OWNER, second.report.id, id, "Provider response could not be confirmed"],
  );
  assert.equal(failed.rows[0].value.status, "failed");
  await asOwner();
  const reattempt = await claim(randomUUID(), HASH_B, 3, 0.3);
  assert.equal(reattempt.claimed, false);
  assert.equal(reattempt.report.status, "failed");
  assert.equal((await usage()).requests, 2);
  assert.equal(Number((await usage()).estimated_cost_usd), 0.42);
  await asOther();
  assert.equal((await db.query("select * from public.analysis_reports")).rows.length, 0);
  await assert.rejects(() => db.query("select public.analysis_report_claim_for_owner($1::uuid,$2::uuid,$3::date,$4::date,$5::text,$6::integer,$7::numeric,$8::numeric)",
    [OWNER, randomUUID(), "2026-09-01", "2026-09-14", HASH_A, 3, 1, 0.2]), /permission denied/);
  await db.exec("reset role; set role anon");
  await assert.rejects(() => db.query("select * from public.analysis_reports"), /permission denied/);
  await asOwner();
});

test("two simultaneous claims share one reservation and RPC grants stay narrow", async () => {
  const privilege = await admin(
    "select has_function_privilege('authenticated'," +
    " 'public.analysis_report_claim_for_owner(uuid,uuid,date,date,text,integer,numeric,numeric)','EXECUTE') as browser_claim," +
    " has_function_privilege('service_role'," +
    " 'public.analysis_report_claim_for_owner(uuid,uuid,date,date,text,integer,numeric,numeric)','EXECUTE') as server_claim," +
    " has_function_privilege('authenticated','public.analysis_source_state(uuid)','EXECUTE') as browser_source",
  );
  const grants = privilege.rows[0] as { browser_claim: boolean; server_claim: boolean; browser_source: boolean };
  assert.equal(grants.browser_claim, false);
  assert.equal(grants.server_claim, true);
  assert.equal(grants.browser_source, false);
  await asService();
  const sql = "select public.analysis_report_claim_for_owner($1::uuid,$2::uuid,$3::date,$4::date," +
    "$5::text,$6::integer,$7::numeric,$8::numeric) as value";
  const inputs = (id: string) => [OWNER, id, "2026-09-15", "2026-09-28", "c".repeat(64), 4, 1, 0.1];
  try {
    const [a, b] = await Promise.all([
      db.query<{ value: Claim }>(sql, inputs(randomUUID())),
      db.query<{ value: Claim }>(sql, inputs(randomUUID())),
    ]);
    assert.deepEqual([a.rows[0].value.claimed, b.rows[0].value.claimed].sort(), [false, true]);
    assert.equal(a.rows[0].value.report.id, b.rows[0].value.report.id);
  } finally { await asOwner(); }
  assert.equal((await usage()).requests, 3);
  assert.equal(Number((await usage()).estimated_cost_usd), 0.52);
});
