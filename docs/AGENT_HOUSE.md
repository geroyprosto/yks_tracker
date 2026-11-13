# Ajan Evi

Analiz opens an isometric six-room report viewer. Conversation remains with the Leader in Codex. Selecting a room reads its saved output; it does not call a model, create tasks, or log study time. The existing Analysis UI remains under “Çalışma ölçütleri ve önceki analizler”, and its API is unchanged.

## Reports

`src/lib/agent-house.ts` defines the versioned display contract. Each run contains dated agent summaries, recommendations, sources, tables, and schedule blocks. Role IDs are `leader`, `strategy`, `tracking`, `awareness`, `daily`, and `discovery`. Missing roles and skipped work are shown explicitly. Sample and live runs stay in separate lists; an example is never treated as a personal study record.

`GET /api/agent-house` returns the signed-in account’s latest five runs per mode. `POST /api/agent-house` accepts a validated display report, requires the existing signed-in study context and same-origin request, and binds the owner on the server. The optional file import displays the confirmed response immediately, even when an older run falls outside the latest-five list.

`publish_agent_house_report` exposes the same projection to the existing owner-authenticated YKSİM MCP connection. This tool adds only a report. The caller must preserve the run ID and payload for retries; a changed report needs a new ID. The connector may need its tool list refreshed before a new tool appears.

## Persistence

Apply `20261113221107_agent_house_reports.sql` before releasing this UI. Reports are immutable and keyed by account plus run ID. Identical publication returns the original report; conflicting content returns 409. Only the verified account can read reports, and writes use narrowly scoped service-only RPCs. The existing server Supabase credential is reused; no new client secret is needed. Account deletion cascades to these reports.

Publish only user-facing conclusions. The strict schema rejects extra raw-journal fields and unsafe source URL schemes, but free text is not an automatic secret scrubber. The producer must omit raw journals, private prompts, credentials, and local paths. The separate local workflow exports its reviewed display projection as `agent-house-report.json`.

This release stores and displays reports; it does not make local Codex jobs run while the computer is off or add live video/research ingestion. Previously stored reports remain available from the hosted app independently of the local computer.
