import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

type Account = { id: string; role: string; status: string; teacher_id: string | null };
type ClassroomState = {
  account: Account | null; accounts: Account[]; applications: Array<{ id: string; user_id: string; requested_role: string; teacher_id: string | null; status: string; reviewed_by: string | null }>;
  invites: Array<{ id: string; token: string }>; messages: Array<{ id: string; body: string; read_at: string | null }>;
  alerts: Array<{ id: string; body: string; status: string; kind: string; parent_id: string | null; refusal_count: number; accepted_at: string | null; followup_due_at: string | null; started_at: string | null; closed_at: string | null }>;
  feedback: Array<{ alert_id: string; event: string }>;
  students: Array<{ id: string; state: Record<string, unknown>; presence: { status: string; online: boolean; session_id: string | null } }>;
};
const OWNER = randomUUID();
const TEACHERS = [randomUUID(), randomUUID()];
const STUDENTS = Array.from({ length: 35 }, () => randomUUID());
const APPLICANTS = Array.from({ length: 6 }, () => randomUUID());
const UNVERIFIED = randomUUID();
let db: PGlite;
let invitation: { id: string; token: string };

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;`);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, migrations), "utf8"));
  }
  for (const id of [OWNER, ...TEACHERS, ...STUDENTS, ...APPLICANTS, UNVERIFIED]) {
    await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,$3,'{\"role\":\"admin\"}')",
      [id, `${id}@example.test`, id === UNVERIFIED ? null : new Date().toISOString()]);
  }
  // Existing owner setup can run after all migrations; it must still bootstrap.
  await db.query("insert into public.owner_allowlist(user_id) values($1)", [OWNER]);
  for (const [i, id] of TEACHERS.entries()) {
    await db.query("insert into public.classroom_accounts(id,name,email,role,status) values($1,$2,$3,'teacher','approved')",
      [id, `Öğretmen ${i + 1}`, `teacher${i + 1}@example.test`]);
  }
  for (const [i, id] of STUDENTS.entries()) {
    await db.query("insert into public.classroom_accounts(id,name,email,role,status,teacher_id) values($1,$2,$3,'student','approved',$4)",
      [id, `Öğrenci ${i + 1}`, `student${i + 1}@example.test`, TEACHERS[i < 10 ? 0 : 1]]);
    await db.query("insert into public.profiles(user_id,display_name) values($1,$2)", [id, `Öğrenci ${i + 1}`]);
  }
});
after(async () => { await db?.close(); });

async function browser(id: string, target: PGlite = db) {
  await target.exec("reset role; set role authenticated");
  await target.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await target.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, role: "authenticated" })]);
  await target.query("select set_config('request.jwt.claim.client_id','',false)");
}
async function state() {
  return (await db.query<{ value: ClassroomState }>("select public.classroom_state() as value")).rows[0].value;
}
async function command(type: string, payload: Record<string, unknown>, requestId = randomUUID()) {
  return (await db.query<{ value: { id: string; token: string; replayed: boolean } }>(
    "select public.classroom_command($1::uuid,$2,$3::jsonb) as value", [requestId, type, JSON.stringify(payload)])).rows[0].value;
}
async function apply(role: string, token?: string) {
  return (await db.query<{ value: string }>("select public.classroom_apply('Başvuran', $1,$2) as value", [role, token ?? null])).rows[0].value;
}
async function timerStart(title = "Gerçek çalışma") {
  return (await db.query<{ value: { id: string } }>("select public.yks_command($1::uuid,'timer.start',$2::jsonb) as value",
    [randomUUID(), JSON.stringify({ title, mode: "stopwatch" })])).rows[0].value.id;
}
async function sql<T = Record<string, unknown>>(statement: string, parameters: unknown[] = []) {
  await db.exec("reset role");
  return db.query<T>(statement, parameters);
}
async function tick() {
  await db.exec("reset role; set role service_role");
  return (await db.query<{ value: number }>("select public.classroom_tick() as value")).rows[0].value;
}

test("teachers get exactly their 10/25 students and cannot query or mutate any student table", async () => {
  for (const [index, teacher] of TEACHERS.entries()) {
    await browser(teacher);
    const data = await state();
    assert.equal(data.students.length, index === 0 ? 10 : 25);
    assert.deepEqual(new Set(data.students.map(s => s.id)), new Set(STUDENTS.slice(index === 0 ? 0 : 10, index === 0 ? 10 : 35)));
    assert.equal(data.accounts.length, 0);
    for (const table of ["profiles", "study_sessions", "study_intervals", "exams", "topics", "journal_entries", "analysis_reports"]) {
      assert.equal((await db.query(`select * from public.${table}`)).rows.length, 0, table);
    }
    await assert.rejects(() => db.query("select public.yks_state()"), /OWNER_REQUIRED/);
    await assert.rejects(() => db.query("select public.yks_command($1::uuid,'task.create',$2::jsonb)",
      [randomUUID(), JSON.stringify({ title: "Forbidden", plan_date: "2026-09-25", user_id: STUDENTS[0] })]), /OWNER_REQUIRED/);
    await assert.rejects(() => db.query("update public.profiles set display_name='Hacked' where user_id=$1", [STUDENTS[0]]), /permission denied/);
    await assert.rejects(() => db.query("select private.classroom_statistics($1)", [STUDENTS[0]]), /permission denied/);
    await assert.rejects(() => command("message.send", { student_id: STUDENTS[index === 0 ? 10 : 0], category: "warning", body: "Forbidden" }), /ACCESS_DENIED/);
  }
});

test("approved students retain existing state/commands and private text never reaches teacher statistics", async () => {
  await browser(STUDENTS[0]);
  await db.query("select public.yks_command($1::uuid,'topic.create',$2::jsonb)", [randomUUID(), JSON.stringify({ exam: "TYT", subject: "Matematik", name: "Özel konu", notes: "PRIVATE_SECRET" })]);
  await db.query("select public.yks_command($1::uuid,'task.create',$2::jsonb)", [randomUUID(), JSON.stringify({ title: "PRIVATE_TASK", plan_date: "2026-09-25" })]);
  const own = (await db.query<{ value: { topics: Array<{ notes: string }> } }>("select public.yks_state() as value")).rows[0].value;
  assert.ok(own.topics.some(t => t.notes === "PRIVATE_SECRET"));
  assert.equal((await db.query("select user_id from public.profiles")).rows.length, 1);
  await browser(TEACHERS[0]);
  const data = await state();
  assert.equal(JSON.stringify(data).includes("PRIVATE_SECRET"), false);
  assert.equal(JSON.stringify(data).includes("PRIVATE_TASK"), false);
  assert.deepEqual(data.students[0].state.journal_entries, []);
  await assert.rejects(() => db.query("select * from public.classroom_messages"), /permission denied/);
});

test("anonymous/unverified/pending users cannot gain roles from metadata or access study data", async () => {
  await browser(UNVERIFIED);
  await assert.rejects(() => apply("teacher"), /EMAIL_VERIFICATION_REQUIRED/);
  await browser(APPLICANTS[0]);
  assert.equal((await state()).account, null);
  await assert.rejects(() => apply("admin"), /INVALID_INPUT/);
  const first = await apply("teacher");
  assert.equal(await apply("teacher"), first);
  const pending = await state();
  assert.equal(pending.account?.status, "pending");
  assert.equal(pending.account?.role, "teacher");
  assert.equal(pending.students.length, 0);
  assert.equal(pending.applications.length, 1);
  assert.equal((await db.query("select * from public.profiles")).rows.length, 0);
  await browser(TEACHERS[0]);
  await assert.rejects(() => command("application.review", { id: first, decision: "approved" }), /ACCESS_DENIED/);
  await browser(APPLICANTS[0]);
  await assert.rejects(() => db.query("select public.yks_state()"), /OWNER_REQUIRED/);
  await assert.rejects(() => command("invite.create", {}), /APPROVAL_REQUIRED/);
  await db.exec("reset role; set role anon");
  await assert.rejects(() => db.query("select public.classroom_state()"), /permission denied/);
  await assert.rejects(() => db.query("select public.classroom_command($1,'invite.create','{}')", [randomUUID()]), /permission denied/);
});

test("invitations are random, multi-use and scoped; only the invited teacher or admin can review", async () => {
  await browser(TEACHERS[0]);
  const request = randomUUID();
  invitation = await command("invite.create", { expires_in_days: 7 }, request);
  assert.match(invitation.token, /^[0-9a-f]{64}$/);
  assert.equal((await command("invite.create", { expires_in_days: 7 }, request)).token, invitation.token);
  await assert.rejects(() => command("invite.create", { expires_in_days: 8 }, request), /IDEMPOTENCY_CONFLICT/);
  const preview = (await db.query<{ value: { teacher_id: string; teacher_name: string } }>("select public.classroom_invite($1) as value", [invitation.token])).rows[0].value;
  assert.equal(preview.teacher_id, TEACHERS[0]);
  assert.equal(preview.teacher_name, "Öğretmen 1");
  for (const applicant of APPLICANTS.slice(1, 3)) {
    await browser(applicant);
    const id = await apply("student", invitation.token);
    assert.equal(await apply("student", invitation.token), id);
    await browser(TEACHERS[1]);
    assert.equal((await state()).applications.some(application => application.id === id), false);
    await assert.rejects(() => command("application.review", { id, decision: "approved" }), /ACCESS_DENIED/);
    await browser(TEACHERS[0]);
    assert.equal((await state()).applications.find(application => application.id === id)?.teacher_id, TEACHERS[0]);
    await assert.rejects(() => command("application.review", {
      id, decision: "approved", teacher_id: TEACHERS[1],
    }), /ACCESS_DENIED/);
    if (applicant === APPLICANTS[1]) {
      const requestId = randomUUID();
      await command("application.review", { id, decision: "approved" }, requestId);
      assert.equal((await command("application.review", { id, decision: "approved" }, requestId)).replayed, true);
      await browser(applicant);
      assert.equal((await state()).account?.teacher_id, TEACHERS[0]);
      assert.equal((await state()).applications.find(application => application.id === id)?.reviewed_by, TEACHERS[0]);
      await db.query("select public.yks_state()");
    }
  }
  await browser(TEACHERS[1]);
  await assert.rejects(() => command("invite.revoke", { id: invitation.id }), /NOT_FOUND/);
  await browser(TEACHERS[0]);
  const revoked = await command("invite.create", {});
  await command("invite.revoke", { id: revoked.id });
  await browser(APPLICANTS[3]);
  await assert.rejects(() => apply("student", revoked.token), /INVITE_INVALID/);
  assert.equal((await db.query<{ value: null }>("select public.classroom_invite($1) as value", [revoked.token])).rows[0].value, null);
  await sql("update public.classroom_invites set expires_at=now()-interval '1 second' where id=$1", [revoked.id]);
  await browser(APPLICANTS[3]);
  await assert.rejects(() => apply("student", revoked.token), /INVITE_INVALID/);
  await sql("update public.classroom_invites set expires_at=now()-interval '1 second' where id=$1", [invitation.id]);
  await browser(APPLICANTS[3]);
  await assert.rejects(() => apply("student", invitation.token), /INVITE_INVALID/);
});

test("independent students wait for admin approval before study access", async () => {
  await browser(APPLICANTS[3]);
  const enrollment = await apply("student");
  assert.equal(await apply("student"), enrollment);
  const own = await state();
  assert.equal(own.account?.role, "student");
  assert.equal(own.account?.status, "pending");
  assert.equal(own.account?.teacher_id, null);
  assert.equal(own.applications.find(application => application.id === enrollment)?.status, "pending");
  await assert.rejects(() => db.query("select public.yks_state()"), /OWNER_REQUIRED/);
  await browser(TEACHERS[0]);
  assert.equal((await state()).applications.some(application => application.id === enrollment), false);
  await assert.rejects(() => command("application.review", { id: enrollment, decision: "approved" }), /ACCESS_DENIED/);
  await browser(OWNER);
  assert.equal((await state()).applications.find(application => application.id === enrollment)?.teacher_id, null);
  await command("application.review", { id: enrollment, decision: "approved" });
  await browser(APPLICANTS[3]);
  assert.equal((await state()).account?.status, "approved");
  assert.equal((await state()).account?.teacher_id, null);
  await db.query("select public.yks_state()");
  await db.query("select public.yks_command($1::uuid,'task.create',$2::jsonb)",
    [randomUUID(), JSON.stringify({ title: "Bireysel çalışma", plan_date: "2026-09-26" })]);
  assert.equal((await db.query("select user_id from public.profiles")).rows.length, 1);
  for (const teacher of TEACHERS) {
    await browser(teacher);
    assert.equal((await state()).students.some(student => student.id === APPLICANTS[3]), false);
    await assert.rejects(() => command("message.send", {
      student_id: APPLICANTS[3], category: "warning", body: "Sınıf dışı öğrenci",
    }), /ACCESS_DENIED/);
  }
});

test("teacher reviews invited students and transfers; admin retains an override", async () => {
  await browser(TEACHERS[0]);
  const invite = await command("invite.create", {});
  await browser(APPLICANTS[4]);
  const invited = await apply("student", invite.token);
  assert.equal(await apply("student", invite.token), invited);
  const invitedState = await state();
  assert.equal(invitedState.account?.status, "pending");
  assert.equal(invitedState.account?.teacher_id, null);
  assert.equal(invitedState.applications.find(application => application.id === invited)?.status, "pending");
  await assert.rejects(() => db.query("select public.yks_state()"), /OWNER_REQUIRED/);
  await browser(TEACHERS[0]);
  assert.equal((await state()).students.some(student => student.id === APPLICANTS[4]), false);
  assert.equal((await state()).applications.find(application => application.id === invited)?.status, "pending");

  await browser(APPLICANTS[3]);
  const soloRequest = await apply("student", invite.token);
  assert.equal(await apply("student", invite.token), soloRequest);
  assert.equal((await state()).account?.teacher_id, null);
  assert.equal((await state()).account?.status, "approved");
  assert.equal((await state()).applications.find(application => application.id === soloRequest)?.status, "pending");
  await db.query("select public.yks_state()");
  await browser(TEACHERS[0]);
  assert.equal((await state()).students.some(student => student.id === APPLICANTS[3]), false);

  await browser(OWNER);
  const data = await state();
  assert.equal(data.account?.role, "admin");
  assert.equal(data.account?.status, "approved");
  assert.ok(data.accounts.length >= 39);
  assert.equal(data.applications.find(application => application.id === invited)?.status, "pending");
  assert.equal(data.applications.find(application => application.id === soloRequest)?.status, "pending");
  const adminOverride = data.applications.find(application => application.user_id === APPLICANTS[2]);
  assert.ok(adminOverride);
  await command("application.review", { id: adminOverride.id, decision: "approved" });
  await browser(TEACHERS[0]);
  await command("application.review", { id: invited, decision: "approved" });
  await command("application.review", { id: invited, decision: "approved" });
  await assert.rejects(() => command("application.review", { id: invited, decision: "rejected" }), /INVALID_TRANSITION/);
  await browser(APPLICANTS[4]);
  assert.equal((await state()).account?.teacher_id, TEACHERS[0]);
  await db.query("select public.yks_state()");

  await browser(TEACHERS[0]);
  await command("application.review", { id: soloRequest, decision: "approved" });
  await browser(APPLICANTS[3]);
  assert.equal((await state()).account?.teacher_id, TEACHERS[0]);
  await db.query("select public.yks_state()");
  await browser(TEACHERS[0]);
  assert.ok((await state()).students.some(student => student.id === APPLICANTS[3]));
  assert.ok((await state()).students.some(student => student.id === APPLICANTS[4]));
  await browser(TEACHERS[1]);
  assert.equal((await state()).students.some(student => student.id === APPLICANTS[3] || student.id === APPLICANTS[4]), false);
});

test("a rejected invited student cannot use independent signup to bypass the review", async () => {
  await browser(TEACHERS[0]);
  const invite = await command("invite.create", {});
  await browser(APPLICANTS[5]);
  const application = await apply("student", invite.token);
  await browser(OWNER);
  await command("application.review", { id: application, decision: "rejected" });
  await browser(APPLICANTS[5]);
  assert.equal((await state()).account?.status, "rejected");
  await assert.rejects(() => apply("student"), /ACCESS_DENIED/);
  assert.equal((await state()).account?.status, "rejected");
  await assert.rejects(() => db.query("select public.yks_state()"), /OWNER_REQUIRED/);
  await browser(TEACHERS[0]);
  assert.equal((await state()).students.some(student => student.id === APPLICANTS[5]), false);
});

test("earlier independent students stay approved after the new approval migration", async () => {
  const fixture = new PGlite();
  const migrationName = "20260926030009_independent_student_accounts.sql";
  const migrations = new URL("../migrations/", import.meta.url);
  const studentId = randomUUID();
  try {
    await fixture.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;`);
    for (const name of (await readdir(migrations)).filter(name => name.endsWith(".sql") && name < migrationName).sort()) {
      await fixture.exec(await readFile(new URL(name, migrations), "utf8"));
    }
    await fixture.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [studentId, "existing-solo@example.test"]);
    await browser(studentId, fixture);
    const application = (await fixture.query<{ value: string }>(
      "select public.classroom_apply('Eski Öğrenci','student',null) as value")).rows[0].value;
    const beforeMigration = (await fixture.query<{ value: ClassroomState }>(
      "select public.classroom_state() as value")).rows[0].value;
    assert.equal(beforeMigration.account?.status, "pending");
    assert.equal(beforeMigration.applications.find(item => item.id === application)?.status, "pending");
    await assert.rejects(() => fixture.query("select public.yks_state()"), /OWNER_REQUIRED/);

    await fixture.exec("reset role");
    await fixture.exec(await readFile(new URL(migrationName, migrations), "utf8"));
    await browser(studentId, fixture);
    const afterMigration = (await fixture.query<{ value: ClassroomState }>(
      "select public.classroom_state() as value")).rows[0].value;
    assert.equal(afterMigration.account?.status, "approved");
    assert.equal(afterMigration.account?.teacher_id, null);
    assert.equal(afterMigration.applications.find(item => item.id === application)?.status, "approved");
    await fixture.query("select public.yks_state()");
    const profiles = await fixture.query<{ display_name: string }>("select display_name from public.profiles where user_id=$1", [studentId]);
    assert.equal(profiles.rows[0]?.display_name, "Eski Öğrenci");
    await fixture.exec("reset role");
    await fixture.exec(await readFile(new URL("20260926034053_application_approval_scope.sql", migrations), "utf8"));
    await browser(studentId, fixture);
    const stillApproved = (await fixture.query<{ value: ClassroomState }>(
      "select public.classroom_state() as value")).rows[0].value;
    assert.equal(stillApproved.account?.status, "approved");
    assert.equal(stillApproved.account?.teacher_id, null);
    await fixture.query("select public.yks_state()");
  } finally {
    await fixture.close();
  }
});

test("class transfer keeps current membership until target-teacher review and rejection preserves it", async () => {
  await browser(TEACHERS[1]);
  const second = await command("invite.create", {});
  await browser(STUDENTS[0]);
  const request = await apply("student", second.token);
  assert.equal((await state()).account?.teacher_id, TEACHERS[0]);
  assert.equal((await state()).account?.status, "approved");
  await browser(TEACHERS[0]);
  assert.ok((await state()).students.some(s => s.id === STUDENTS[0]));
  await browser(TEACHERS[1]);
  assert.equal((await state()).students.some(s => s.id === STUDENTS[0]), false);
  assert.equal((await state()).applications.find(application => application.id === request)?.status, "pending");
  await browser(TEACHERS[0]);
  await assert.rejects(() => command("application.review", { id: request, decision: "rejected" }), /ACCESS_DENIED/);
  await browser(TEACHERS[1]);
  await command("application.review", { id: request, decision: "rejected" });
  await browser(STUDENTS[0]);
  assert.equal((await state()).account?.teacher_id, TEACHERS[0]);
  const retry = await apply("student", second.token);
  assert.notEqual(retry, request);
  await browser(TEACHERS[1]);
  await command("application.review", { id: retry, decision: "approved" });
  await browser(TEACHERS[0]);
  assert.equal((await state()).students.some(s => s.id === STUDENTS[0]), false);
  await assert.rejects(() => command("alert.send", { student_id: STUDENTS[0], body: "Eski sınıf" }), /ACCESS_DENIED/);
  await browser(TEACHERS[1]);
  assert.ok((await state()).students.some(s => s.id === STUDENTS[0]));
});

test("suspension immediately denies existing study JWTs and teacher access", async () => {
  await browser(OWNER);
  await command("account.suspend", { id: STUDENTS[1], suspended: true });
  await browser(STUDENTS[1]);
  assert.equal((await state()).account?.status, "suspended");
  assert.equal((await db.query("select * from public.profiles")).rows.length, 0);
  await assert.rejects(() => db.query("select public.yks_state()"), /OWNER_REQUIRED/);
  await assert.rejects(() => command("presence.heartbeat", { device_id: randomUUID() }), /APPROVAL_REQUIRED/);
  await browser(TEACHERS[0]);
  assert.equal((await state()).students.some(s => s.id === STUDENTS[1]), false);
  await browser(OWNER);
  await command("account.suspend", { id: STUDENTS[1], suspended: false });
  await browser(STUDENTS[1]);
  await db.query("select public.yks_state()");
});

test("categorized messages, replies and read receipts persist and reject ID tampering", async () => {
  await browser(TEACHERS[0]);
  const request = randomUUID();
  const body = { student_id: STUDENTS[2], category: "praise", body: "Matematikte güzel ilerleme!" };
  const message = await command("message.send", body, request);
  assert.equal((await command("message.send", body, request)).id, message.id);
  await browser(TEACHERS[1]);
  assert.equal((await state()).messages.some(m => m.id === message.id), false);
  await assert.rejects(() => command("message.read", { id: message.id }), /ACCESS_DENIED/);
  await browser(STUDENTS[3]);
  await assert.rejects(() => command("message.reply", { id: message.id, body: "Başka öğrenci" }), /ACCESS_DENIED/);
  await browser(STUDENTS[2]);
  assert.equal((await state()).messages.find(m => m.id === message.id)?.read_at, null);
  await command("message.read", { id: message.id });
  const reply = await command("message.reply", { id: message.id, body: "Teşekkürler öğretmenim." });
  await browser(TEACHERS[0]);
  assert.ok((await state()).messages.find(m => m.id === message.id)?.read_at);
  assert.equal((await state()).messages.find(m => m.id === reply.id)?.body, "Teşekkürler öğretmenim.");
  await assert.rejects(() => command("message.send", { ...body, body: "x".repeat(2001) }), /check constraint/);
  await assert.rejects(() => command("message.send", { ...body, category: "untrusted" }), /check constraint/);
});

test("ten actual No presses lock dismissal for five minutes across sessions; retries never add presses", async () => {
  await browser(TEACHERS[0]);
  const alert = await command("alert.send", { student_id: STUDENTS[3], body: "HEMEN MASANA GEÇ!!" });
  await browser(STUDENTS[3]);
  const request = randomUUID();
  await command("alert.respond", { id: alert.id, response: "refuse" }, request);
  await command("alert.respond", { id: alert.id, response: "refuse" }, request);
  assert.equal((await state()).alerts.find(a => a.id === alert.id)?.refusal_count, 1);
  for (let i = 1; i < 10; i++) await command("alert.respond", { id: alert.id, response: "refuse" });
  await command("alert.respond", { id: alert.id, response: "refuse" });
  const data = await state();
  assert.equal(data.alerts.find(a => a.id === alert.id)?.refusal_count, 10);
  assert.equal(data.alerts.find(a => a.id === alert.id)?.status, "declined");
  assert.ok(data.alerts.find(a => a.id === alert.id)?.closed_at);
  assert.equal(data.feedback.filter(f => f.alert_id === alert.id && f.event === "refused_ten").length, 1);
  await assert.rejects(() => command("alert.respond", { id: alert.id, response: "dismiss" }), /ALERT_LOCKED/);
  await browser(STUDENTS[3]); // A reload or second device sees the same database lock.
  assert.equal((await state()).alerts.find(a => a.id === alert.id)?.status, "declined");
  await assert.rejects(() => command("alert.respond", { id: alert.id, response: "dismiss" }), /ALERT_LOCKED/);
  await sql("update public.classroom_alerts set closed_at=clock_timestamp()-interval '4 minutes 59 seconds' where id=$1", [alert.id]);
  await browser(STUDENTS[3]);
  await assert.rejects(() => command("alert.respond", { id: alert.id, response: "dismiss" }), /ALERT_LOCKED/);
  await sql("update public.classroom_alerts set closed_at=clock_timestamp()-interval '5 minutes 1 second' where id=$1", [alert.id]);
  await browser(STUDENTS[3]);
  await command("alert.respond", { id: alert.id, response: "dismiss" });
  assert.equal((await state()).alerts.find(a => a.id === alert.id)?.status, "dismissed");
  await browser(STUDENTS[4]);
  await assert.rejects(() => command("alert.respond", { id: alert.id, response: "accept" }), /ACCESS_DENIED/);
});

test("accepting and actually starting are separate events, including a same-second second-device start", async () => {
  await browser(TEACHERS[0]);
  const alert = await command("alert.send", { student_id: STUDENTS[4], body: "Kütüphaneye geç :)" });
  await browser(STUDENTS[4]);
  await command("alert.respond", { id: alert.id, response: "accept" });
  let data = await state();
  assert.equal(data.feedback.filter(f => f.alert_id === alert.id && f.event === "accepted").length, 1);
  assert.equal(data.feedback.filter(f => f.alert_id === alert.id && f.event === "started").length, 0);
  assert.equal(data.alerts.find(a => a.id === alert.id)?.started_at, null);
  await browser(STUDENTS[4]); // A new device's verified session uses the same DB actor.
  await timerStart();
  data = await state();
  assert.equal(data.feedback.filter(f => f.alert_id === alert.id && f.event === "started").length, 1);
  assert.ok(data.alerts.find(a => a.id === alert.id)?.started_at);
  await sql("update public.classroom_alerts set followup_due_at=now()-interval '1 minute' where id=$1", [alert.id]);
  await tick();
  await browser(STUDENTS[4]);
  assert.equal((await state()).alerts.some(a => a.parent_id === alert.id), false);
});

test("server time creates one durable 15-minute follow-up after reconnect; acknowledgement never starts a timer", async () => {
  await browser(TEACHERS[0]);
  const alert = await command("alert.send", { student_id: STUDENTS[5], body: "Bir adım at." });
  await browser(STUDENTS[5]);
  await command("alert.respond", { id: alert.id, response: "accept" });
  const accepted = (await state()).alerts.find(a => a.id === alert.id);
  assert.ok(accepted?.accepted_at && accepted.followup_due_at);
  assert.equal(new Date(accepted.followup_due_at).getTime() - new Date(accepted.accepted_at).getTime(), 15 * 60 * 1000);
  assert.equal(await tick(), 0); // Acceptance alone must not trigger the reminder early.
  await sql("update public.classroom_alerts set accepted_at=now()-interval '16 minutes', followup_due_at=now()-interval '1 minute' where id=$1", [alert.id]);
  assert.equal(await tick(), 1);
  assert.equal(await tick(), 0);
  await browser(STUDENTS[5]);
  const followups = (await state()).alerts.filter(a => a.parent_id === alert.id);
  assert.equal(followups.length, 1);
  assert.equal(followups[0].kind, "followup");
  assert.equal(followups[0].body, "E hani başlıyordun?");
  await command("alert.respond", { id: followups[0].id, response: "accept" });
  const data = await state();
  assert.equal(data.alerts.find(a => a.id === followups[0].id)?.status, "accepted");
  assert.equal(data.feedback.filter(f => f.alert_id === followups[0].id && f.event === "followup_acknowledged").length, 1);
  assert.equal((await db.query("select * from public.study_sessions")).rows.length, 0);
  await assert.rejects(() => db.query("select public.classroom_tick()"), /permission denied/);
});

test("working before acceptance does not falsely report a new start; late work cancels stale follow-up", async () => {
  await browser(STUDENTS[6]);
  const session = await timerStart();
  await browser(TEACHERS[0]);
  const alert = await command("alert.send", { student_id: STUDENTS[6], body: "Başlayalım." });
  await browser(STUDENTS[6]);
  await command("alert.respond", { id: alert.id, response: "accept" });
  assert.equal((await state()).feedback.filter(f => f.alert_id === alert.id && f.event === "started").length, 0);
  await sql("update public.classroom_alerts set followup_due_at=now()-interval '1 minute' where id=$1", [alert.id]);
  await tick();
  await browser(STUDENTS[6]);
  const prior = (await state()).alerts.find(a => a.parent_id === alert.id);
  assert.ok(prior);
  const revision = (await db.query<{ revision: number }>("select revision from public.study_sessions where id=$1", [session])).rows[0].revision;
  await db.query("select public.yks_command($1::uuid,'timer.pause',$2::jsonb)", [randomUUID(), JSON.stringify({ id: session, expected_revision: revision })]);
  await db.query("select public.yks_command($1::uuid,'timer.resume',$2::jsonb)", [randomUUID(), JSON.stringify({ id: session, expected_revision: revision + 1 })]);
  assert.equal((await state()).alerts.find(a => a.id === prior.id)?.status, "cancelled");
});

test("hidden and closed tabs keep study timers running without claiming the student is online", async () => {
  const first = randomUUID(); const second = randomUUID(); const id = STUDENTS[7];
  await browser(id);
  await command("presence.heartbeat", { device_id: first, visible: false });
  await browser(TEACHERS[0]);
  assert.equal((await state()).students.find(s => s.id === id)?.presence.online, true);
  assert.equal((await state()).students.find(s => s.id === id)?.presence.status, "online");
  await browser(id);
  const session = await timerStart();
  await browser(TEACHERS[0]);
  assert.equal((await state()).students.find(s => s.id === id)?.presence.status, "working");
  await browser(id);
  await command("presence.heartbeat", { device_id: second, visible: false });
  await command("presence.leave", { device_id: first });
  await browser(TEACHERS[0]);
  assert.equal((await state()).students.find(s => s.id === id)?.presence.online, true);
  assert.equal((await state()).students.find(s => s.id === id)?.presence.status, "working");
  await browser(id);
  await command("presence.leave", { device_id: second });
  await browser(TEACHERS[0]);
  const closedRunning = (await state()).students.find(s => s.id === id)?.presence;
  assert.equal(closedRunning?.online, false);
  assert.equal(closedRunning?.status, "working");
  assert.equal(closedRunning?.session_id, session);
  await browser(id);
  await command("presence.heartbeat", { device_id: second, visible: false });
  await db.query("select public.yks_command($1::uuid,'timer.pause',$2::jsonb)", [randomUUID(), JSON.stringify({ id: session, expected_revision: 1 })]);
  await browser(TEACHERS[0]);
  const hiddenPaused = (await state()).students.find(s => s.id === id)?.presence;
  assert.equal(hiddenPaused?.online, true);
  assert.equal(hiddenPaused?.status, "break");
  await browser(id);
  await command("presence.leave", { device_id: second });
  await browser(TEACHERS[0]);
  const closedPaused = (await state()).students.find(s => s.id === id)?.presence;
  assert.equal(closedPaused?.status, "offline");
  assert.equal(closedPaused?.online, false);
  assert.equal(closedPaused?.session_id, session);
  await browser(id);
  await command("presence.heartbeat", { device_id: second, visible: false });
  await sql("update public.classroom_presence set expires_at=now()-interval '1 second' where user_id=$1", [id]);
  await browser(TEACHERS[0]);
  assert.equal((await state()).students.find(s => s.id === id)?.presence.status, "offline");
  assert.equal((await state()).students.find(s => s.id === id)?.presence.online, false);
});

test("realtime events contain only own invalidations; OAuth client tokens cannot enter classroom RPCs", async () => {
  await browser(TEACHERS[0]);
  const events = await db.query<{ user_id: string }>("select * from public.classroom_events");
  assert.ok(events.rows.length);
  assert.ok(events.rows.every(e => e.user_id === TEACHERS[0]));
  await assert.rejects(() => db.query("insert into public.classroom_events(user_id) values($1)", [TEACHERS[1]]), /permission denied/);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: TEACHERS[0], client_id: "oauth-client" })]);
  assert.equal((await db.query("select * from public.classroom_events")).rows.length, 0);
  await assert.rejects(() => state(), /AUTH_REQUIRED/);
  await assert.rejects(() => command("invite.create", {}), /AUTH_REQUIRED/);
});

test("suspending a teacher closes existing overlays and revokes invitations without trapping their students", async () => {
  await browser(TEACHERS[0]);
  const alert = await command("alert.send", { student_id: STUDENTS[8], body: "Bekleyen uyarı" });
  const invite = await command("invite.create", {});
  await browser(OWNER);
  await command("account.suspend", { id: TEACHERS[0], suspended: true });
  await browser(STUDENTS[8]);
  const record = (await state()).alerts.find(a => a.id === alert.id);
  assert.equal(record?.status, "cancelled");
  assert.equal((await db.query<{ value: unknown }>("select public.classroom_invite($1) as value", [invite.token])).rows[0].value, null);
  await browser(TEACHERS[0]);
  assert.equal((await state()).students.length, 0);
  await assert.rejects(() => command("invite.create", {}), /APPROVAL_REQUIRED/);
  await browser(OWNER);
  await command("account.suspend", { id: TEACHERS[0], suspended: false });
});

test("application decisions stay in-app even if the old email cron still runs", async () => {
  for (const user of [OWNER, TEACHERS[0], STUDENTS[0], APPLICANTS[0]]) {
    await browser(user);
    await assert.rejects(() => db.query("select public.classroom_email_claim()"), /permission denied/);
    await assert.rejects(() => db.query("select public.classroom_email_ack($1,true)", [randomUUID()]), /permission denied/);
    await assert.rejects(() => db.query("select * from private.classroom_email_outbox"), /permission denied/);
  }
  await db.exec("reset role; set role anon");
  await assert.rejects(() => db.query("select public.classroom_email_claim()"), /permission denied/);
  assert.equal((await sql("select count(*)::integer as total from private.classroom_email_outbox")).rows[0].total, 0);
  await browser(OWNER);
  const pendingTeacher = (await state()).applications.find(application => application.user_id === APPLICANTS[0]);
  assert.ok(pendingTeacher);
  await sql("insert into private.classroom_email_outbox(application_id) values($1)", [pendingTeacher.id]);
  await db.exec("set role service_role");
  await assert.rejects(() => db.query("select * from private.classroom_email_outbox"), /permission denied/);
  const claim = async () => (await db.query<{ value: Array<{ id: string }> }>(
    "select public.classroom_email_claim() as value")).rows[0].value;
  assert.deepEqual(await claim(), []);
  const persisted = await sql<{ attempts: number; sent_at: string | null }>(
    "select attempts,sent_at from private.classroom_email_outbox where application_id=$1", [pendingTeacher.id]);
  assert.equal(persisted.rows[0].attempts, 0);
  assert.equal(persisted.rows[0].sent_at, null);
});

test("a teacher can remove only their own student without deleting study data", async () => {
  const student = STUDENTS[7];
  await browser(student);
  await db.query("select public.yks_command($1::uuid,'task.create',$2::jsonb)",
    [randomUUID(), JSON.stringify({ title: "Sınıftan sonra da kalan plan", plan_date: "2026-10-01" })]);

  await browser(TEACHERS[0]);
  const alert = await command("alert.send", { student_id: student, body: "Bekleyen çalışma uyarısı" });
  const message = await command("message.send", { student_id: student, category: "praise", body: "Öğretmen mesajı" });
  const beforeEvents = (await db.query<{ count: number }>("select count(*)::integer as count from public.classroom_events")).rows[0].count;
  await assert.rejects(() => command("student.remove", { id: STUDENTS[15] }), /ACCESS_DENIED/);
  await browser(STUDENTS[15]);
  await assert.rejects(() => command("student.remove", { id: student }), /ACCESS_DENIED/);
  await browser(OWNER);
  await assert.rejects(() => command("student.remove", { id: student }), /ACCESS_DENIED/);
  await browser(TEACHERS[0]);
  await assert.rejects(() => command("student.remove", { id: student, teacher_id: null }), /INVALID_INPUT/);

  const requestId = randomUUID();
  const removed = await command("student.remove", { id: student }, requestId);
  assert.equal(removed.id, student);
  assert.equal((await command("student.remove", { id: student }, requestId)).replayed, true);
  assert.equal((await state()).students.some(item => item.id === student), false);
  assert.equal((await state()).messages.some(item => item.id === message.id), false);
  assert.ok((await db.query<{ count: number }>("select count(*)::integer as count from public.classroom_events")).rows[0].count > beforeEvents);
  await assert.rejects(() => command("student.remove", { id: student }), /ACCESS_DENIED/);
  await assert.rejects(() => command("alert.send", { student_id: student, body: "Eski sınıf" }), /ACCESS_DENIED/);

  await browser(student);
  const own = await state();
  assert.equal(own.account?.teacher_id, null);
  assert.equal(own.account?.status, "approved");
  assert.equal(own.alerts.find(item => item.id === alert.id)?.status, "cancelled");
  assert.equal(own.messages.some(item => item.id === message.id), false);
  const study = (await db.query<{ value: { tasks: Array<{ title: string }> } }>("select public.yks_state() as value")).rows[0].value;
  assert.ok(study.tasks.some(task => task.title === "Sınıftan sonra da kalan plan"));
});

test("a student can leave their own class and the former teacher gets an invalidation", async () => {
  const student = STUDENTS[15];
  await browser(TEACHERS[1]);
  const alert = await command("alert.send", { student_id: student, body: "Sınıf uyarısı" });
  const beforeEvents = (await db.query<{ count: number }>("select count(*)::integer as count from public.classroom_events")).rows[0].count;
  await browser(student);
  assert.equal((await state()).account?.teacher_id, TEACHERS[1]);
  await assert.rejects(() => command("student.remove", { id: STUDENTS[16] }), /ACCESS_DENIED/);
  await command("student.remove", { id: student });
  const own = await state();
  assert.equal(own.account?.teacher_id, null);
  assert.equal(own.account?.status, "approved");
  assert.equal(own.alerts.find(item => item.id === alert.id)?.status, "cancelled");
  await assert.rejects(() => command("student.remove", { id: student }), /INVALID_TRANSITION/);
  await db.query("select public.yks_state()");

  await browser(TEACHERS[1]);
  assert.equal((await state()).students.some(item => item.id === student), false);
  assert.ok((await db.query<{ count: number }>("select count(*)::integer as count from public.classroom_events")).rows[0].count > beforeEvents);
  await assert.rejects(() => command("message.send", { student_id: student, category: "warning", body: "Eski sınıf" }), /ACCESS_DENIED/);
});

test("leaving a class with no alerts still notifies the former teacher", async () => {
  const student = STUDENTS[16];
  await browser(TEACHERS[1]);
  const beforeEvents = (await db.query<{ count: number }>(
    "select count(*)::integer as count from public.classroom_events where user_id=$1", [TEACHERS[1]]
  )).rows[0].count;
  await browser(student);
  await command("student.remove", { id: student });
  await browser(TEACHERS[1]);
  assert.ok((await db.query<{ count: number }>(
    "select count(*)::integer as count from public.classroom_events where user_id=$1", [TEACHERS[1]]
  )).rows[0].count > beforeEvents);
});
