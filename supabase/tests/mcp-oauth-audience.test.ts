import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const clientId = "dedicated-chatgpt-client";
const resource = "https://study.example.com/api/mcp";
let db: PGlite;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create role supabase_auth_admin;
    create schema private;
    revoke all on schema private from public, anon, authenticated, service_role;
  `);
  const migration = new URL("../migrations/20260925165024_mcp_oauth_audience_hook.sql", import.meta.url);
  await db.exec(await readFile(migration, "utf8"));
});

after(async () => { await db?.close(); });

function event(claimId?: string, method = "oauth_provider/authorization_code") {
  return {
    user_id: "11111111-1111-4111-8111-111111111111",
    authentication_method: method,
    claims: {
      iss: "https://example.supabase.co/auth/v1",
      aud: "authenticated",
      sub: "11111111-1111-4111-8111-111111111111",
      role: "authenticated",
      email: "owner@example.com",
      ...(claimId ? { client_id: claimId } : {}),
    },
    ...(claimId ? { client_id: claimId } : {}),
  };
}

async function hook(input: unknown) {
  const result = await db.query<{ value: unknown }>(
    "select private.mcp_oauth_access_token_hook($1::jsonb) as value",
    [JSON.stringify(input)],
  );
  return result.rows[0].value;
}

test("empty allowlist leaves ordinary and OAuth tokens untouched", async () => {
  await db.exec("set role supabase_auth_admin");
  try {
    assert.deepEqual(await hook(event()), event());
    assert.deepEqual(await hook(event(clientId)), event(clientId));
  } finally { await db.exec("reset role"); }
});

test("only the configured OAuth client receives the exact HTTPS MCP audience", async () => {
  await db.query(
    "insert into private.mcp_oauth_audience_config(client_id, resource_url) values($1, $2)",
    [clientId, resource],
  );
  await db.exec("set role supabase_auth_admin");
  try {
    const matching = event(clientId);
    const expected = structuredClone(matching);
    expected.claims.aud = resource;
    assert.deepEqual(await hook(matching), expected);
    assert.deepEqual(await hook(event(clientId, "token_refresh")), {
      ...event(clientId, "token_refresh"),
      claims: { ...event(clientId, "token_refresh").claims, aud: resource },
    });
    assert.deepEqual(await hook(event()), event());
    assert.deepEqual(await hook(event("another-client")), event("another-client"));

    const mismatched = { ...event(clientId), client_id: "another-client" };
    assert.deepEqual(await hook(mismatched), mismatched);
  } finally { await db.exec("reset role"); }
});

test("browser and service roles cannot call the hook or read its config", async () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(() => hook(event(clientId)), /permission denied/);
      await assert.rejects(
        () => db.query("select * from private.mcp_oauth_audience_config"),
        /permission denied/,
      );
    } finally { await db.exec("reset role"); }
  }

  await db.exec("set role supabase_auth_admin");
  try {
    assert.equal((await db.query("select client_id from private.mcp_oauth_audience_config")).rows.length, 1);
    await assert.rejects(
      () => db.query("update private.mcp_oauth_audience_config set resource_url = $1", [resource]),
      /permission denied/,
    );
  } finally { await db.exec("reset role"); }
});

test("configuration rejects an HTTP or malformed resource", async () => {
  await assert.rejects(
    () => db.query(
      "update private.mcp_oauth_audience_config set resource_url = $1",
      ["http://localhost:3000/api/mcp"],
    ),
    /check constraint/,
  );
});
