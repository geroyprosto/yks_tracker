import { test } from "node:test";
import assert from "node:assert/strict";
import { createMcpHandler, McpServer, PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } from "@modelcontextprotocol/server";
import { MAX_MCP_BODY_BYTES, readMcpBody } from "../src/lib/server/mcp-request-body";

for (const modern of [false, true]) {
  test(`MCP ${modern ? "modern discovery" : "legacy initialization"} works after bounded parser consumes the request`, async () => {
    const body = modern
      ? { jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: {
          [PROTOCOL_VERSION_META_KEY]: "2026-07-28", [CLIENT_INFO_META_KEY]: { name: "test", version: "1" }, [CLIENT_CAPABILITIES_META_KEY]: {},
        } } }
      : { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } };
    const headers = new Headers({ "Content-Type": "application/json", Accept: "application/json, text/event-stream" });
    if (modern) { headers.set("MCP-Protocol-Version", "2026-07-28"); headers.set("Mcp-Method", "server/discover"); }
    const request = new Request("https://study.example/api/mcp", { method: "POST", headers, body: JSON.stringify(body) });
    const parsed = await readMcpBody(request);
    assert.ok(!(parsed instanceof Response));
    assert.equal(request.bodyUsed, true);
    assert.throws(() => request.clone()); // A second read or clone is impossible.
    const handler = createMcpHandler(() => new McpServer({ name: "test", version: "1" }));
    try {
      const response = await handler.fetch(request, parsed);
      assert.equal(response.status, 200, await response.clone().text());
      const wire = await response.text();
      assert.match(wire, /serverInfo/);
    } finally { await handler.close(); }
  });
}

test("MCP parser rejects oversized streaming bodies even with a false Content-Length", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(MAX_MCP_BODY_BYTES + 1)); },
    cancel() { cancelled = true; },
  });
  const request = new Request("https://study.example/api/mcp", {
    method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "1" }, body, duplex: "half",
  } as RequestInit);
  const result = await readMcpBody(request);
  assert.ok(result instanceof Response);
  assert.equal(result.status, 413);
  assert.equal(cancelled, true);
});

test("MCP parser rejects declared oversize before reading, and preserves JSON media and syntax errors", async () => {
  const oversized = new Request("https://study.example/api/mcp", { method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": String(MAX_MCP_BODY_BYTES + 1) }, body: "{}" });
  const rejected = await readMcpBody(oversized);
  assert.ok(rejected instanceof Response);
  assert.equal(rejected.status, 413);
  assert.equal(oversized.bodyUsed, false);
  for (const [type, body, status] of [["text/plain", "{}", 415], ["application/json", "{broken", 400], ["application/json", "", 400]] as const) {
    const response = await readMcpBody(new Request("https://study.example/api/mcp", { method: "POST", headers: { "Content-Type": type }, body }));
    assert.ok(response instanceof Response);
    assert.equal(response.status, status);
  }
});

test("MCP parser preserves split Unicode bytes", async () => {
  const bytes = new TextEncoder().encode('{"note":"çalışma"}');
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close();
  } });
  const parsed = await readMcpBody(new Request("https://study.example/api/mcp", {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: stream, duplex: "half",
  } as RequestInit));
  assert.deepEqual(parsed, { parsedBody: { note: "çalışma" } });
});
