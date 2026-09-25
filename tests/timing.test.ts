import assert from "node:assert/strict";
import test from "node:test";
import { secondsByDay, sessionSeconds } from "../src/lib/timing";
import type { StudyInterval, StudySession } from "../src/lib/domain/types";

function session(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: "session", title: "Çalışma", task_id: null, topic_id: null, subject: null,
    study_type: "Soru çözümü", mode: "stopwatch", target_seconds: null,
    status: "running", started_at: "2026-09-24T08:00:00Z",
    active_since: "2026-09-24T08:00:00Z", accumulated_seconds: 0,
    finished_at: null, revision: 1, ...overrides,
  };
}

function interval(started_at: string, ended_at: string | null, id = "interval"): StudyInterval {
  return { id, session_id: "session", started_at, ended_at };
}

test("running timer derives elapsed time after a suspended browser resumes", () => {
  const s = session({ accumulated_seconds: 120 });
  assert.equal(sessionSeconds(s, Date.parse("2026-09-24T08:10:05Z")), 725);
});

test("paused and finished timers never count wall time", () => {
  for (const status of ["paused", "finished"] as const) {
    assert.equal(sessionSeconds(session({ status, accumulated_seconds: 125 }), Date.parse("2026-09-25T08:00:00Z")), 125);
  }
});

test("a future active timestamp cannot subtract saved study time", () => {
  assert.equal(sessionSeconds(session({ accumulated_seconds: 90 }), Date.parse("2026-09-24T07:59:00Z")), 90);
});

test("countdown saves at most its target after a long browser suspension", () => {
  assert.equal(sessionSeconds(session({ mode: "countdown", target_seconds: 2400, accumulated_seconds: 600 }), Date.parse("2026-09-25T08:00:00Z")), 2400);
});

test("active intervals split at Istanbul midnight without counting a pause", () => {
  const result = secondsByDay({
    sessions: [session({ status: "finished" })],
    intervals: [interval("2026-09-24T20:50:00Z", "2026-09-24T21:10:00Z"), interval("2026-09-24T21:30:00Z", "2026-09-24T21:40:00Z", "later")],
  });
  assert.deepEqual(result, { "2026-09-24": 600, "2026-09-25": 1200 });
});

test("an open resumed countdown stops at the remaining target on the correct date", () => {
  const result = secondsByDay({
    sessions: [session({ mode: "countdown", target_seconds: 1200, accumulated_seconds: 600 })],
    intervals: [interval("2026-09-24T20:00:00Z", "2026-09-24T20:10:00Z"), interval("2026-09-24T20:55:00Z", null, "resumed")],
  }, "Europe/Istanbul", Date.parse("2026-09-25T08:00:00Z"));
  assert.deepEqual(result, { "2026-09-24": 900, "2026-09-25": 300 });
});

test("spring daylight saving day has 23 actual hours", () => {
  const result = secondsByDay({ sessions: [session({ status: "finished" })], intervals: [interval("2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z")] }, "America/New_York");
  assert.deepEqual(result, { "2026-03-08": 23 * 3600 });
});

test("fall daylight saving day has 25 actual hours and splits the following day", () => {
  const result = secondsByDay({ sessions: [session({ status: "finished" })], intervals: [interval("2026-11-01T04:00:00Z", "2026-11-02T05:30:00Z")] }, "America/New_York");
  assert.deepEqual(result, { "2026-11-01": 25 * 3600, "2026-11-02": 1800 });
});

test("multiple midnight boundaries preserve total active seconds", () => {
  const result = secondsByDay({ sessions: [session({ status: "finished" })], intervals: [interval("2026-09-24T20:00:00Z", "2026-09-26T22:00:00Z")] });
  assert.deepEqual(result, { "2026-09-24": 3600, "2026-09-25": 86400, "2026-09-26": 86400, "2026-09-27": 3600 });
  assert.equal(Object.values(result).reduce((a, b) => a + b, 0), 50 * 3600);
});

test("missing sessions and invalid or reversed intervals cannot inflate study totals", () => {
  const result = secondsByDay({
    sessions: [session()],
    intervals: [
      { ...interval("2026-09-24T08:00:00Z", "2026-09-24T09:00:00Z"), session_id: "deleted" },
      interval("invalid", "2026-09-24T09:00:00Z", "invalid"),
      interval("2026-09-24T09:00:00Z", "2026-09-24T08:00:00Z", "reversed"),
    ],
  });
  assert.deepEqual(result, {});
});
