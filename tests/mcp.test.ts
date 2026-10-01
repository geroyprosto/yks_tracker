import assert from "node:assert/strict";
import test from "node:test";
import { handleMcpRequest } from "../src/lib/server/mcp-handler";
import { createExamInput, createStudySessionInput, createTaskInput, listStudySessionsInput, listTasksInput, studySummaryInput } from "../src/lib/server/mcp-tools";

const requestId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";

test("MCP denies anonymous and cookie-only requests before any tool runs", async () => {
  const previous = {
    MCP_ENABLED: process.env.MCP_ENABLED,
    MCP_PUBLIC_URL: process.env.MCP_PUBLIC_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ALLOWED_USER_EMAIL: process.env.ALLOWED_USER_EMAIL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  };
  Object.assign(process.env, {
    MCP_ENABLED: "true",
    MCP_PUBLIC_URL: "https://study.example.com/api/mcp",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit_test",
    ALLOWED_USER_EMAIL: "owner@example.com",
    SUPABASE_SECRET_KEY: "sb_secret_unit_test",
  });
  try {
    for (const cookie of [null, "sb-session=forged"]) {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (cookie) headers.set("Cookie", cookie);
      const response = await handleMcpRequest(new Request("https://study.example.com/api/mcp", {
        method: "POST", headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }));
      assert.equal(response.status, 401);
      assert.match(response.headers.get("www-authenticate") ?? "", /resource_metadata="https:\/\/study\.example\.com\/api\/mcp\/oauth-protected-resource"/);
    }
    const metadata = await handleMcpRequest(new Request("https://study.example.com/api/mcp/oauth-protected-resource"));
    assert.equal(metadata.status, 200);
    const body = await metadata.json();
    assert.equal(body.resource, "https://study.example.com/api/mcp");
    assert.deepEqual(body.authorization_servers, ["https://example.supabase.co/auth/v1"]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("MCP input schemas enforce bounded reads and idempotent task creation", () => {
  assert.equal(studySummaryInput.safeParse({ period: "year" }).success, true);
  assert.equal(studySummaryInput.safeParse({ period: "lifetime" }).success, false);
  assert.equal(listTasksInput.safeParse({ limit: 101 }).success, false);
  assert.equal(createTaskInput.safeParse({ request_id: requestId, title: "Matematik", plan_date: "2026-09-25" }).success, true);
  assert.equal(createTaskInput.safeParse({ title: "Matematik", plan_date: "2026-09-25" }).success, false);
  assert.equal(createTaskInput.safeParse({ request_id: requestId, title: "Matematik", plan_date: "2026-09-25", planned_minutes: 1441 }).success, false);
});

test("MCP advertises only the ten scoped tools with correct behavior hints", async () => {
  const [{ createMcpHandler }, { createStudyMcpServer }] = await Promise.all([
    import("@modelcontextprotocol/server"), import("../src/lib/server/mcp-tools"),
  ]);
  const handler = createMcpHandler(() => createStudyMcpServer({} as never, ownerId, "https://study.example.com/"), { responseMode: "json" });
  const response = await handler.fetch(new Request("https://study.example.com/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }));
  assert.equal(response.status, 200);
  const raw = await response.text();
  const payload = raw.startsWith("event:") ? raw.split(/\r?\n/).find(line => line.startsWith("data: "))?.slice(6) : raw;
  assert.ok(payload);
  const body = JSON.parse(payload);
  const tools = body.result.tools as Array<{ name: string; annotations: Record<string, unknown>; _meta: Record<string, unknown> }>;
  assert.deepEqual(tools.map(tool => tool.name), ["get_study_summary", "list_tasks", "list_topics", "list_study_sessions", "list_exams", "create_task", "create_study_session", "create_exam", "update_topic_status", "get_analysis_sources"]);
  for (const tool of tools) assert.deepEqual(tool._meta.securitySchemes, [{ type: "oauth2", scopes: [] }]);
  assert.equal(tools[0].annotations.readOnlyHint, true);
  assert.equal(tools[3].annotations.readOnlyHint, true);
  for (const index of [5, 6, 7, 8]) {
    assert.equal(tools[index].annotations.readOnlyHint, false);
    assert.equal(tools[index].annotations.idempotentHint, true);
  }
});

test("MCP initialize exposes the coach instructions to connected clients", async () => {
  const [{ createMcpHandler }, { createStudyMcpServer }] = await Promise.all([
    import("@modelcontextprotocol/server"), import("../src/lib/server/mcp-tools"),
  ]);
  const handler = createMcpHandler(() => createStudyMcpServer({} as never, ownerId, "https://study.example.com/"), { responseMode: "json" });
  const response = await handler.fetch(new Request("https://study.example.com/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" },
    } }),
  }));
  assert.equal(response.status, 200);
  const raw = await response.text();
  const payload = raw.startsWith("event:") ? raw.split(/\r?\n/).find(line => line.startsWith("data: "))?.slice(6) : raw;
  assert.ok(payload);
  const body = JSON.parse(payload);
  assert.match(body.result.instructions, /get_analysis_sources/);
  assert.match(body.result.instructions, /beş düşük öncelikli pekiştirme/);
});

test("MCP exam creation accepts only confirmed, structured results", () => {
  const basic = {
    request_id: requestId, confirmed_by_user: true, name: "TYT denemesi",
    exam_date: "2026-09-25", format_code: "TYT", reported_total_net: 72.5,
  };
  const parsed = createExamInput.safeParse(basic);
  assert.equal(parsed.success, true);
  if (parsed.success) assert.deepEqual(parsed.data.results, []);
  for (const input of [
    { ...basic, confirmed_by_user: false },
    { ...basic, confirmed_by_user: undefined },
    { ...basic, request_id: undefined },
    { ...basic, reported_total_net: undefined },
    { ...basic, file_path: "C:\\private\\result.pdf" },
    { ...basic, pdf_url: "https://example.com/result.pdf" },
    { ...basic, results: [
      { section_key: "turkish", net: 30 }, { section_key: "turkish", net: 31 },
    ] },
    { ...basic, branch_subject: "Matematik" },
    { ...basic, format_code: "BRANCH" },
  ]) assert.equal(createExamInput.safeParse(input).success, false);
  assert.equal(createExamInput.safeParse({
    ...basic, reported_total_net: undefined, format_code: "BRANCH",
    branch_subject: "TYT Matematik", branch_question_count: 40,
    results: [{ section_key: "branch", correct: 30, wrong: 6, blank: 4 }],
  }).success, true);
});

test("MCP create_exam maps a confirmed call to the existing idempotent command and returns a narrow receipt", async () => {
  const [{ createMcpHandler }, { createStudyMcpServer }] = await Promise.all([
    import("@modelcontextprotocol/server"), import("../src/lib/server/mcp-tools"),
  ]);
  const captured: Array<{ p_user_id: string; request_id: string; command_type: string; payload: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === "mcp_owner_state") throw new Error("Write must not fetch full state");
      if (name === "mcp_owner_command") {
        const input = args as typeof captured[number];
        captured.push(input);
        return { data: { id: "exam-record-1", request_id: input.request_id,
          replayed: captured.length > 1 }, error: null };
      }
      throw new Error("unexpected RPC");
    },
  };
  const handler = createMcpHandler(() => createStudyMcpServer(client as never, ownerId, "https://study.example.com/"), { responseMode: "json" });
  async function call(args: Record<string, unknown>) {
    const response = await handler.fetch(new Request("https://study.example.com/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_exam", arguments: args } }),
    }));
    assert.equal(response.status, 200);
    const raw = await response.text();
    const payload = raw.startsWith("event:") ? raw.split(/\r?\n/).find(line => line.startsWith("data: "))?.slice(6) : raw;
    assert.ok(payload);
    return JSON.parse(payload).result as { isError?: boolean; content: Array<{ text: string }> };
  }
  const args = {
    request_id: requestId, confirmed_by_user: true, name: "TYT denemesi",
    exam_date: "2026-09-25", format_code: "TYT", publisher: "Yayın",
    results: [{ section_key: "turkish", correct: 35, wrong: 4, blank: 1 }],
  };
  const first = await call(args);
  assert.equal(first.isError, undefined);
  const firstReceipt = JSON.parse(first.content[0].text);
  assert.deepEqual(firstReceipt, {
    id: "exam-record-1", request_id: requestId, status: "saved",
    replayed: false, app_url: "https://study.example.com/",
  });
  assert.deepEqual(captured[0], {
    p_user_id: ownerId, request_id: requestId, command_type: "exam.create",
    payload: { name: "TYT denemesi", exam_date: "2026-09-25",
      format_code: "TYT", publisher: "Yayın", results: args.results },
  });
  assert.equal((await call(args)).content[0].text.includes('"status":"already_saved"'), true);
  assert.equal(captured.length, 2);
  const rejected = await call({ ...args, confirmed_by_user: false });
  assert.equal(rejected.isError, true);
  assert.equal(captured.length, 2);
  assert.equal(JSON.stringify(firstReceipt).includes("private_journal_text"), false);
});
test("MCP manual study inputs require explicit date, subject, duration and confirmation", () => {
  const valid = {request_id: requestId, confirmed_by_user: true,
    study_date: "2026-09-25", subject: "TYT Fizik", minutes: 50};
  assert.equal(createStudySessionInput.safeParse(valid).success, true);
  for (const changed of [
    {...valid, confirmed_by_user: false},
    {...valid, confirmed_by_user: undefined},
    {...valid, request_id: undefined},
    {...valid, study_date: undefined},
    {...valid, study_date: "2026-09-31"},
    {...valid, subject: "  "},
    {...valid, minutes: 0},
    {...valid, minutes: 1441},
    {...valid, minutes: 50.5},
    {...valid, user_id: requestId},
    {...valid, started_at: "2026-09-25T10:00:00Z"},
  ]) assert.equal(createStudySessionInput.safeParse(changed).success, false);
  assert.equal(listStudySessionsInput.safeParse({limit: 25}).success, true);
  assert.equal(listStudySessionsInput.safeParse({limit: 101}).success, false);
});

test("MCP manual study creation uses the owner command path and returns only a durable receipt", async () => {
  const [{createMcpHandler}, {createStudyMcpServer}] = await Promise.all([
    import("@modelcontextprotocol/server"), import("../src/lib/server/mcp-tools"),
  ]);
  const captured: Array<{p_user_id: string; request_id: string; command_type: string; payload: Record<string, unknown>}> = [];
  const client = {rpc: async (name: string, args?: Record<string, unknown>) => {
    if (name === "mcp_owner_state") throw new Error("Write must not fetch full state");
    if (name === "mcp_owner_command") {
      const input = args as typeof captured[number];
      captured.push(input);
      return {data: {id: "manual-record-1", request_id: input.request_id,
        replayed: captured.length > 1}, error: null};
    }
    throw new Error("unexpected RPC");
  }};
  const handler = createMcpHandler(() => createStudyMcpServer(client as never, ownerId, "https://study.example.com/"), {responseMode: "json"});
  async function call(args: Record<string, unknown>) {
    const response = await handler.fetch(new Request("https://study.example.com/api/mcp", {
      method: "POST", headers: {"Content-Type": "application/json", Accept: "application/json, text/event-stream"},
      body: JSON.stringify({jsonrpc: "2.0", id: 3, method: "tools/call",
        params: {name: "create_study_session", arguments: args}}),
    }));
    assert.equal(response.status, 200);
    const raw = await response.text();
    const payload = raw.startsWith("event:") ? raw.split(/\r?\n/).find(line => line.startsWith("data: "))?.slice(6) : raw;
    assert.ok(payload);
    return JSON.parse(payload).result as {isError?: boolean; content: Array<{text: string}>};
  }
  const args = {request_id: requestId, confirmed_by_user: true,
    study_date: "2026-09-25", subject: "TYT Fizik", minutes: 50};
  const first = await call(args);
  assert.equal(first.isError, undefined);
  assert.deepEqual(JSON.parse(first.content[0].text), {
    id: "manual-record-1", request_id: requestId, status: "saved", replayed: false,
    study_date: "2026-09-25", subject: "TYT Fizik", duration_seconds: 3000,
    app_url: "https://study.example.com/",
  });
  assert.deepEqual(captured[0], {p_user_id: ownerId, request_id: requestId, command_type: "manual_study.create",
    payload: {confirmed_by_user: true, study_date: "2026-09-25", subject: "TYT Fizik", minutes: 50}});
  const replay = await call(args);
  assert.equal(JSON.parse(replay.content[0].text).status, "already_saved");
  assert.equal(captured.length, 2);
  const rejected = await call({...args, confirmed_by_user: false});
  assert.equal(rejected.isError, true);
  assert.equal(captured.length, 2);
  assert.equal(first.content[0].text.includes("private_journal_text"), false);
});

test("MCP study listing excludes running timers and filters date-only records", async () => {
  const [{createMcpHandler}, {createStudyMcpServer}] = await Promise.all([
    import("@modelcontextprotocol/server"), import("../src/lib/server/mcp-tools"),
  ]);
  const state = {
    settings: {timezone: "Europe/Istanbul"},
    sessions: [
      {id: "finished", status: "finished", started_at: "2026-09-24T21:30:00Z",
        subject: "AYT Fizik", accumulated_seconds: 1800},
      {id: "running", status: "running", started_at: "2026-09-25T09:00:00Z",
        subject: "TYT Matematik", accumulated_seconds: 600},
    ],
    manual_study_entries: [{id: "manual", study_date: "2026-09-25",
      subject: "TYT Fizik", duration_seconds: 3000}],
  };
  const handler = createMcpHandler(() => createStudyMcpServer({rpc: async () => ({data: state, error: null})} as never,
    ownerId, "https://study.example.com/"), {responseMode: "json"});
  const response = await handler.fetch(new Request("https://study.example.com/api/mcp", {
    method: "POST", headers: {"Content-Type": "application/json", Accept: "application/json, text/event-stream"},
    body: JSON.stringify({jsonrpc: "2.0", id: 4, method: "tools/call", params: {
      name: "list_study_sessions", arguments: {from_date: "2026-09-25", to_date: "2026-09-25"}}}),
  }));
  assert.equal(response.status, 200);
  const raw = await response.text();
  const payload = raw.startsWith("event:") ? raw.split(/\r?\n/).find(line => line.startsWith("data: "))?.slice(6) : raw;
  assert.ok(payload);
  const body = JSON.parse(payload);
  const result = JSON.parse(body.result.content[0].text);
  assert.deepEqual(result, {sessions: [
    {kind: "timer", id: "finished", study_date: "2026-09-25", subject: "AYT Fizik", duration_seconds: 1800},
    {kind: "manual", id: "manual", study_date: "2026-09-25", subject: "TYT Fizik", duration_seconds: 3000},
  ], count: 2});
});



