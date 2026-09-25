import assert from "node:assert/strict";
import test from "node:test";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { emptyState } from "../src/lib/domain/types";
import { analysisSourcesInput, registerAnalysisSourcesTool } from "../src/lib/server/mcp-analysis-tool";

test("analysis source tool defaults to 14 days and excludes unshared journal text", async () => {
  assert.equal(analysisSourcesInput.parse({}).lookback_days, 14);
  assert.equal(analysisSourcesInput.safeParse({ lookback_days: 32 }).success, false);
  const state = emptyState(true);
  state.server_now = "2026-09-25T12:00:00Z";
  state.manual_study_entries = [{ id: "study-1", study_date: "2026-09-24", subject: "TYT Fizik",
    duration_seconds: 3000, created_at: "2026-09-24T12:00:00Z" }];
  state.journal_entries = [{ id: "journal-1", journal_date: "2026-09-24",
    original_text: "PRIVATE-NOTES-DO-NOT-SEND", structured_fields: { mood: "iyi", food_drink: "özel" },
    exclude_from_analysis: false, ai_shared_fields: ["mood"], revision: 1,
    created_at: "2026-09-24T12:00:00Z", updated_at: "2026-09-24T12:00:00Z" },
  { id: "journal-2", journal_date: "2026-09-23", original_text: "EXCLUDED-NOTES",
    structured_fields: { mood: "kötü" }, exclude_from_analysis: true,
    ai_shared_fields: ["original_text", "mood"], revision: 1,
    created_at: "2026-09-23T12:00:00Z", updated_at: "2026-09-23T12:00:00Z" }];
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "analysis-test", version: "0.1.0" });
    registerAnalysisSourcesTool(server, async () => state);
    return server;
  }, { responseMode: "json" });
  const response = await handler.fetch(new Request("https://study.example.com/api/mcp", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "get_analysis_sources", arguments: {} } }),
  }));
  assert.equal(response.status, 200);
  const raw = await response.text();
  const payload = raw.startsWith("event:") ? raw.split(/\r?\n/).find(line => line.startsWith("data: "))?.slice(6) : raw;
  assert.ok(payload);
  const result = JSON.parse(JSON.parse(payload).result.content[0].text);
  assert.deepEqual(result.period, { start: "2026-09-12", end: "2026-09-25", timezone: "Europe/Istanbul" });
  assert.equal(result.summary.total_seconds, 3000);
  assert.deepEqual(result.days.find((day: { date: string }) => day.date === "2026-09-24").journal,
    { date: "2026-09-24", fields: { mood: "iyi" } });
  assert.equal(result.days.find((day: { date: string }) => day.date === "2026-09-23").journal, null);
  assert.equal(JSON.stringify(result).includes("PRIVATE-NOTES-DO-NOT-SEND"), false);
  assert.equal(JSON.stringify(result).includes("EXCLUDED-NOTES"), false);
});
