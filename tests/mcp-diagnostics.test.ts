import { test } from "node:test";
import assert from "node:assert/strict";
import { mcpTransportDiagnostic } from "../src/lib/server/mcp-diagnostics";

test("MCP rejection diagnostics identify init negotiation without exposing credentials or body fields", async () => {
  const request = new Request("https://study.example/api/mcp?private=secret", {
    method: "POST", headers: { Authorization: "Bearer SECRET_TOKEN", Cookie: "SECRET_COOKIE",
      "MCP-Protocol-Version": "2026-07-28", Accept: "application/json, text/event-stream" },
  });
  const result = await mcpTransportDiagnostic(request, {
    jsonrpc: "2.0", id: "SECRET_ID", method: "initialize",
    params: { protocolVersion: "2026-07-28", clientInfo: { name: "SECRET_CLIENT" }, arguments: { note: "SECRET_NOTE" } },
  }, Response.json({ error: { code: -32020, message: "Bad Request: the request headers and body disagree: an initialize request (legacy handshake) was sent with a modern MCP-Protocol-Version header", data: { token: "SECRET_ERROR_DATA" } } }, { status: 400 }));
  assert.equal(result?.rpcMethod, "initialize");
  assert.equal(result?.protocolHeader, "2026-07-28");
  assert.equal(result?.initializeProtocol, "2026-07-28");
  assert.equal(result?.errorCode, -32020);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|private/);
});

test("MCP rejection diagnostics suppress untrusted names, protocol values and SDK messages", async () => {
  const result = await mcpTransportDiagnostic(new Request("https://study.example/api/mcp", {
    method: "POST", headers: { "MCP-Protocol-Version": "SECRET_HEADER" },
  }), { method: "SECRET_METHOD", params: { protocolVersion: "SECRET_VERSION" } },
  Response.json({ error: { code: "SECRET_CODE", message: "SECRET_MESSAGE", data: { note: "SECRET_DATA" } } }, { status: 400 }));
  assert.equal(result?.rpcMethod, "unknown");
  assert.equal(result?.protocolHeader, "invalid");
  assert.equal(result?.error, "unclassified_sdk_error");
  assert.equal(result?.errorCode, null);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});

test("successful MCP responses produce no diagnostics", async () => {
  assert.equal(await mcpTransportDiagnostic(new Request("https://study.example/api/mcp"), {}, Response.json({ result: {} })), null);
});
