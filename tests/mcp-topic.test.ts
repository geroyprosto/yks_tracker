import assert from "node:assert/strict";
import test from "node:test";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerTopicStatusTool, updateTopicStatusInput } from "../src/lib/server/mcp-topic-tool";

const requestId = "11111111-1111-4111-8111-111111111111";
const topicId = "22222222-2222-4222-8222-222222222222";

test("topic status tool accepts only an exact confirmed topic and bounded learning level", () => {
  const valid = { request_id: requestId, confirmed_by_user: true,
    topic_id: topicId, expected_revision: 2, mastery: 3 };
  assert.equal(updateTopicStatusInput.safeParse(valid).success, true);
  for (const changed of [
    { ...valid, confirmed_by_user: false },
    { ...valid, topic_id: undefined },
    { ...valid, expected_revision: 0 },
    { ...valid, mastery: 5 },
    { ...valid, topic_name: "Polinomlar" },
    { ...valid, user_id: topicId },
  ]) assert.equal(updateTopicStatusInput.safeParse(changed).success, false);
});

test("topic status tool uses revisioned owner command and returns a narrow replay-safe receipt", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const client = { rpc: async (name: string, args?: Record<string, unknown>) => {
    if (name === "mcp_owner_command") {
      writes.push(args ?? {});
      return { data: { id: topicId, request_id: requestId, replayed: writes.length > 1 }, error: null };
    }
    if (name === "mcp_owner_state") throw new Error("Write must not fetch full state");
    throw new Error("unexpected RPC");
  }};
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "topic-test", version: "0.1.0" });
    registerTopicStatusTool(server, client as never, topicId, "https://study.example.com/");
    return server;
  }, { responseMode: "json" });
  async function call(args: Record<string, unknown>) {
    const response = await handler.fetch(new Request("https://study.example.com/api/mcp", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "update_topic_status", arguments: args } }),
    }));
    assert.equal(response.status, 200);
    const raw = await response.text();
    const payload = raw.startsWith("event:") ? raw.split(/\r?\n/).find(line => line.startsWith("data: "))?.slice(6) : raw;
    assert.ok(payload);
    return JSON.parse(payload).result as { isError?: boolean; content: Array<{ text: string }> };
  }
  const input = { request_id: requestId, confirmed_by_user: true,
    topic_id: topicId, expected_revision: 2, mastery: 3 };
  const first = await call(input);
  assert.equal(first.isError, undefined);
  assert.deepEqual(writes[0], { p_user_id: topicId, request_id: requestId, command_type: "topic.update",
    payload: { id: topicId, expected_revision: 2, mastery: 3 } });
  const receipt = JSON.parse(first.content[0].text);
  assert.equal(receipt.status, "saved");
  assert.equal(receipt.topic_id, topicId);
  assert.equal(receipt.mastery, 3);
  assert.equal(JSON.stringify(receipt).includes("private_journal_text"), false);
  assert.equal(JSON.parse((await call(input)).content[0].text).status, "already_saved");
  assert.equal((await call({ ...input, confirmed_by_user: false })).isError, true);
  assert.equal(writes.length, 2);
});




