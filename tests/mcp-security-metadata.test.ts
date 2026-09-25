import assert from "node:assert/strict";
import test from "node:test";
import { addToolSecurityMetadata } from "../src/lib/server/mcp-security-metadata";

test("tool list exposes OAuth scheme at the standard descriptor field and compatibility mirror", async () => {
  const scheme = [{ type: "oauth2", scopes: [] }];
  const source = Response.json({ jsonrpc: "2.0", id: 1, result: { tools: [
    { name: "list_topics", _meta: { securitySchemes: scheme } },
    { name: "create_exam", securitySchemes: scheme, _meta: { securitySchemes: scheme } },
  ] } }, { headers: { "Content-Length": "1" } });
  const rewritten = await addToolSecurityMetadata(source);
  const payload = await rewritten.json();
  assert.deepEqual(payload.result.tools.map((tool: { securitySchemes: unknown }) => tool.securitySchemes), [scheme, scheme]);
  assert.deepEqual(payload.result.tools[0]._meta.securitySchemes, scheme);
  assert.equal(rewritten.headers.has("content-length"), false);
});

test("non tool-list errors pass through without a modified response", async () => {
  const source = Response.json({ jsonrpc: "2.0", id: 2, error: { code: -32601 } });
  assert.equal(await addToolSecurityMetadata(source), source);
});
