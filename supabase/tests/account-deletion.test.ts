import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const email = (id: string) => `${id}@deletion.example.test`;
async function insert(db: PGlite, table: string, row: Record<string, unknown>) {
  const keys = Object.keys(row);
  return db.query(`insert into ${table}(${keys.join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map(key => typeof row[key] === 'object' && row[key] !== null && !Array.isArray(row[key]) && !ArrayBuffer.isView(row[key]) ? JSON.stringify(row[key]) : row[key]));
}
async function database() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create table auth.users(id uuid primary key,email text,email_change text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;`);
  const directory = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, directory), 'utf8'));
  }
  // Hosted Auth dependencies and deliberate non-FK identifiers. Tokens are
  // synthetic; the test checks deletion rather than the provider's token format.
  await db.exec(`create table auth.identities(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,email text,identity_data jsonb);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
    create table auth.refresh_tokens(id uuid primary key,user_id text,session_id uuid references auth.sessions(id) on delete cascade);
    create table auth.mfa_factors(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
    create table auth.mfa_challenges(id uuid primary key,factor_id uuid references auth.mfa_factors(id) on delete cascade);
    create table auth.mfa_amr_claims(id uuid primary key,session_id uuid references auth.sessions(id) on delete cascade);
    create table auth.mfa_recovery_code_sets(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
    create table auth.mfa_recovery_codes(id uuid primary key,mfa_recovery_code_set_id uuid references auth.mfa_recovery_code_sets(id) on delete cascade);
    create table auth.one_time_tokens(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
    create table auth.oauth_authorizations(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
    create table auth.oauth_consents(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
    create table auth.webauthn_challenges(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
    create table auth.webauthn_credentials(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
    create table auth.audit_log_entries(id uuid primary key,payload json);
    create table auth.oauth_client_states(id uuid primary key,code_verifier text);
    create table auth.flow_state(id uuid primary key,user_id uuid,linking_target_id uuid,oauth_client_state_id uuid);
    create table auth.saml_relay_states(id uuid primary key,for_email text,flow_state_id uuid references auth.flow_state(id) on delete cascade);
    create table auth.scim_users(id uuid primary key,user_id uuid references auth.users(id) on delete set null,user_name text,resource jsonb);
    create schema storage;create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid,owner_id text);
    create table storage.s3_multipart_uploads(id uuid primary key,owner_id text,bucket_id text,key text);
    create table storage.s3_multipart_uploads_parts(id uuid primary key,owner_id text,bucket_id text,key text);
    create table public.demo_sessions(token_hash text primary key,user_id uuid references auth.users(id),expires_at timestamptz);`);
  const admin = randomUUID();
  await account(db, admin, 'admin');
  await insert(db, 'public.owner_allowlist', { user_id: admin });
  return { db, admin };
}
async function account(db: PGlite, id: string, role = 'student', teacher: string | null = null, status = 'approved') {
  await insert(db, 'auth.users', { id, email: email(id), email_confirmed_at: '2026-10-01T00:00:00Z' });
  await insert(db, 'public.classroom_accounts', { id, name: `Synthetic ${role}`, email: email(id), role, status, teacher_id: teacher });
}
async function prepare(db: PGlite, admin: string, target: string, confirmation = email(target), digests: string[] = []) {
  await db.exec('set role service_role');
  try {
    return (await db.query<{ value: { exists: boolean; emails: string[]; storage: { bucket_id: string; name: string }[] } }>(
      'select public.classroom_account_delete_prepare($1,$2,$3,$4::text[]) as value', [admin, target, confirmation, digests])).rows[0].value;
  } finally { await db.exec('reset role'); }
}
async function ownedRows(db: PGlite, target: string) {
  const tables = (await db.query<{ schema_name: string; table_name: string }>(`select n.nspname schema_name,c.relname table_name
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attname='user_id' and not a.attisdropped
    where n.nspname in ('public','private') and c.relkind='r' order by 1,2`)).rows;
  const result: Record<string, unknown[]> = {};
  for (const row of tables) result[`${row.schema_name}.${row.table_name}`] = (await db.query(
    `select to_jsonb(t) value from ${row.schema_name}.${row.table_name} t where user_id=$1 order by to_jsonb(t)::text`, [target])).rows;
  return result;
}
async function seedStudyGraph(db: PGlite, user: string) {
  const term = randomUUID(), course = randomUUID(), topic = randomUUID(), history = randomUUID(), task = randomUUID(), session = randomUUID();
  const document = randomUUID(), exam = randomUUID(), report = randomUUID(), request = randomUUID(), series = randomUUID();
  await insert(db, 'public.profiles', { user_id: user });
  await insert(db, 'public.education_terms', { id: term, user_id: user, academic_year: '2026–2027', name: 'Güz' });
  await insert(db, 'public.education_profiles', { user_id: user, education_level: 'university', yks_goal: true, active_term_id: term });
  await insert(db, 'public.education_drafts', { user_id: user, step: 1, data: { target: user } });
  await insert(db, 'public.education_courses', { id: course, user_id: user, term_id: term, name: 'Matematik', context: 'school' });
  await insert(db, 'public.course_exam_results', { user_id: user, course_id: course, term_id: term, course_name: 'Matematik', exam_date: '2026-10-01', assessment_type: 'Vize', score: 80, scale: 100 });
  await insert(db, 'public.topics', { id: topic, user_id: user, exam: 'TYT', subject: 'Matematik', name: 'Synthetic topic' });
  await insert(db, 'public.topic_history', { id: history, user_id: user, topic_id: topic, old_mastery: 0, new_mastery: 1 });
  await insert(db, 'public.tasks', { id: task, user_id: user, title: 'Synthetic task', topic_id: topic, plan_date: '2026-10-01' });
  await insert(db, 'public.study_sessions', { id: session, user_id: user, course_id: course, task_id: task, started_at: '2026-10-01T10:00:00Z', active_since: '2026-10-01T10:00:00Z' });
  await insert(db, 'public.study_intervals', { user_id: user, session_id: session, started_at: '2026-10-01T10:00:00Z', ended_at: '2026-10-01T10:30:00Z' });
  await db.query("update public.study_sessions set status='finished',finished_at='2026-10-01T10:30:00Z',active_since=null,accumulated_seconds=1800 where id=$1", [session]);
  await insert(db, 'public.manual_study_entries', { user_id: user, course_id: course, subject: 'Matematik', study_date: '2026-10-01', duration_seconds: 900 });
  await insert(db, 'public.practice_entries', { user_id: user, course_id: course, exam: 'TYT', subject: 'Matematik', practice_date: '2026-10-01', question_count: 25, test_count: 1 });
  await insert(db, 'public.daily_plan_versions', { user_id: user, plan_date: '2026-10-01', version: 1, target_minutes: 60, task_share: .7, difficulty_factors: { easy: 1, medium: 1.25, hard: 1.5 }, snapshot: JSON.stringify([{ id: task }]) });
  await insert(db, 'public.audit_log', { user_id: user, entity: 'task', entity_id: task, action: 'task.create', new_value: { id: task } });
  await insert(db, 'public.command_receipts', { user_id: user, request_id: randomUUID(), command_type: 'task.create', payload: {}, result: { id: task } });
  await insert(db, 'public.journal_entries', { user_id: user, journal_date: '2026-10-01', original_text: 'Synthetic private diary' });
  await insert(db, 'public.day_marks', { user_id: user, mark_date: '2026-10-02', kind: 'rest' });
  await insert(db, 'public.exam_documents', { id: document, user_id: user, original_filename: 'synthetic.pdf', sha256: 'a'.repeat(64), storage_path: `${user}/${'a'.repeat(64)}.pdf`, byte_size: 100, page_count: 1, extraction_status: 'ready', candidates: JSON.stringify([{}]) });
  await insert(db, 'public.exams', { id: exam, user_id: user, name: 'Synthetic exam', exam_date: '2026-10-01', format_code: 'TYT', format_version: 1, format_snapshot: {}, source_document_id: document });
  await insert(db, 'public.exam_results', { exam_id: exam, user_id: user, section_key: 'math', correct: 30, wrong: 5, blank: 5, net: 28.75 });
  await insert(db, 'public.exam_imports', { user_id: user, document_id: document, candidate_index: 0, exam_id: exam, result_fingerprint: 'a'.repeat(32), corrections: {} });
  await insert(db, 'public.google_calendar_connections', { user_id: user, refresh_token_ciphertext: 'synthetic'.repeat(8) });
  await insert(db, 'public.analysis_settings', { user_id: user });
  await insert(db, 'public.analysis_reports', { id: report, user_id: user, start_date: '2026-10-01', end_date: '2026-10-01', source_hash: 'b'.repeat(64), status: 'completed', body: 'Synthetic report', request_id: request });
  await insert(db, 'public.analysis_report_requests', { user_id: user, request_id: request, report_id: report, start_date: '2026-10-01', end_date: '2026-10-01', source_hash: 'b'.repeat(64) });
  await insert(db, 'public.analysis_usage', { user_id: user, month: '2026-10-01' });
  await insert(db, 'public.journal_ai_suggestions', { user_id: user, request_id: randomUUID(), source_hash: 'c'.repeat(64), status: 'completed', fields: {}, reserved_month: '2026-10-01', reserved_cost_usd: 0 });
  await insert(db, 'private.education_receipts', { user_id: user, request_id: randomUUID(), command_type: 'profile.save', payload: {}, result: { id: user } });
  await insert(db, 'private.topic_review_schedule', { user_id: user, topic_id: topic, step: 1, plan_date: '2026-10-04', origin_history_id: history, task_id: task });
  await insert(db, 'private.topic_review_series', { id: series, user_id: user, topic_id: topic, event_id: history, completed_at: '2026-10-01T10:00:00Z' });
  await insert(db, 'private.topic_review_stages', { user_id: user, series_id: series, topic_id: topic, stage: 0, plan_date: '2026-10-04', task_id: task });
  await insert(db, 'private.topic_review_receipts', { user_id: user, run_id: request, current_cutoff: '2026-10-01T10:00:00Z', result: { task_ids: [task] } });
  await insert(db, 'private.coaching_plans', { user_id: user, plan: { user_id: user } });
  await insert(db, 'private.coaching_runs', { user_id: user, run_id: request, cutoff: '2026-10-01T10:00:00Z', source_state: { user_id: user }, report_id: report, previous_report_id: report });
  await insert(db, 'private.coaching_homework', { user_id: user, assignment_key: 'synthetic', task_id: task, run_id: request, receipt: { id: task } });
  return { task, session, document, exam, report };
}
async function seedAuthGraph(db: PGlite, target: string, other: string) {
  const session = randomUUID(), factor = randomUUID(), recovery = randomUUID(), state = randomUUID(), linkedState = randomUUID();
  const alias = `${target}@alias.example.test`;
  await insert(db, 'auth.identities', { id: randomUUID(), user_id: target, email: alias, identity_data: { email: alias } });
  await insert(db, 'auth.sessions', { id: session, user_id: target });
  for (const session_id of [session, null]) await insert(db, 'auth.refresh_tokens', { id: randomUUID(), user_id: target, session_id });
  await insert(db, 'auth.mfa_factors', { id: factor, user_id: target });
  await insert(db, 'auth.mfa_challenges', { id: randomUUID(), factor_id: factor });
  await insert(db, 'auth.mfa_amr_claims', { id: randomUUID(), session_id: session });
  await insert(db, 'auth.mfa_recovery_code_sets', { id: recovery, user_id: target });
  await insert(db, 'auth.mfa_recovery_codes', { id: randomUUID(), mfa_recovery_code_set_id: recovery });
  for (const table of ['one_time_tokens', 'oauth_authorizations', 'oauth_consents', 'webauthn_challenges', 'webauthn_credentials']) {
    await insert(db, `auth.${table}`, { id: randomUUID(), user_id: target });
  }
  for (const id of [state, linkedState]) await insert(db, 'auth.oauth_client_states', { id, code_verifier: 'synthetic' });
  await insert(db, 'auth.flow_state', { id: randomUUID(), user_id: target, oauth_client_state_id: state });
  await insert(db, 'auth.flow_state', { id: randomUUID(), user_id: other, linking_target_id: target, oauth_client_state_id: linkedState });
  await insert(db, 'auth.saml_relay_states', { id: randomUUID(), for_email: alias });
  await insert(db, 'auth.scim_users', { id: randomUUID(), user_id: target, user_name: alias, resource: { user_id: target } });
  await insert(db, 'auth.audit_log_entries', { id: randomUUID(), payload: { actor_id: target, traits: { email: email(target) } } });
  await insert(db, 'auth.audit_log_entries', { id: randomUUID(), payload: { actor_id: other, traits: { user_email: alias } } });
  await insert(db, 'public.demo_sessions', { token_hash: target, user_id: target, expires_at: '2026-10-10T00:00:00Z' });
  return alias;
}

test('hard closure removes the complete study/Auth graph and structured copies while preserving another student', async () => {
  const { db, admin } = await database();
  try {
    const teacher = randomUUID(), target = randomUUID(), other = randomUUID();
    await account(db, teacher, 'teacher');await account(db, target, 'student', teacher);await account(db, other, 'student', teacher);
    const targetStudy = await seedStudyGraph(db, target);await seedStudyGraph(db, other);
    const alias = await seedAuthGraph(db, target, other);
    const survivingBefore = await ownedRows(db, other);
    const application = randomUUID(), message = randomUUID(), alert = randomUUID(), group = randomUUID();
    await insert(db, 'public.classroom_applications', { id: application, user_id: target, name: 'Synthetic applicant', email: email(target), requested_role: 'student', teacher_id: teacher, reviewed_by: admin });
    await insert(db, 'public.classroom_messages', { id: message, teacher_id: teacher, student_id: target, sender_id: teacher, category: 'praise', body: 'Synthetic message' });
    await insert(db, 'public.classroom_messages', { teacher_id: teacher, student_id: target, sender_id: target, parent_id: message, category: 'praise', body: 'Synthetic reply' });
    await insert(db, 'public.classroom_alerts', { id: alert, teacher_id: teacher, student_id: target, body: 'Synthetic alert' });
    await insert(db, 'public.classroom_alerts', { teacher_id: teacher, student_id: target, body: 'Synthetic followup', parent_id: alert, kind: 'followup' });
    await insert(db, 'public.classroom_feedback', { alert_id: alert, teacher_id: teacher, student_id: target, event: 'accepted', body: 'Synthetic feedback' });
    await insert(db, 'public.classroom_presence', { user_id: target, device_id: randomUUID(), expires_at: '2026-10-10T00:00:00Z' });
    for (const [actor, payload, result] of [[target, {}, {}], [admin, { id: target.toUpperCase() }, {}], [teacher, { id: application }, {}], [teacher, { id: message }, { id: alert }], [teacher, { email: alias.toUpperCase() }, {}]]) {
      await insert(db, 'public.classroom_receipts', { user_id: actor, request_id: randomUUID(), command_type: 'synthetic', payload, result });
    }
    await insert(db, 'public.command_receipts', { user_id: other, request_id: randomUUID(), command_type: 'synthetic.copy', payload: { nested: [{ id: targetStudy.task }] }, result: {} });
    await insert(db, 'public.audit_log', { user_id: other, entity: 'synthetic.copy', entity_id: targetStudy.report, action: 'synthetic.copy' });
    await insert(db, 'private.friend_groups', { id: group, owner_id: target, name: 'Synthetic group', timezone: 'Europe/Istanbul' });
    for (const user of [target, other]) await insert(db, 'private.friend_group_members', { group_id: group, user_id: user });
    await insert(db, 'private.friend_invites', { inviter_id: other, accepted_by: target, group_id: group, token_hash: new Uint8Array(32).fill(1), expires_at: '2026-10-10T00:00:00Z' });
    const [user_a, user_b] = [target, other].sort();await insert(db, 'private.friendships', { user_a, user_b });
    const digest = 'd'.repeat(64);
    await insert(db, 'private.classroom_registration_attempts', { key: `email:${digest}`, attempts: 1, reset_at: '2026-10-10T00:00:00Z' });
    const survivingCounterKeys = [`email:${'1'.repeat(64)}`, `ip:${'2'.repeat(64)}`];
    for (const key of survivingCounterKeys) await insert(db, 'private.classroom_registration_attempts', { key, attempts: 2, reset_at: '2026-10-10T00:00:00Z' });
    await insert(db, 'private.ai_application_usage', { month: '2026-10-01', estimated_cost_usd: 35 });
    const globals = ['public.exam_format_versions', 'private.ai_budget_policy', 'private.ai_application_usage', 'private.mcp_oauth_audience_config'];
    const globalBefore = await Promise.all(globals.map(table => db.query(`select to_jsonb(t) value from ${table} t order by to_jsonb(t)::text`)));
    const unrelatedReceipt = randomUUID(), unrelatedAudit = randomUUID();
    await insert(db, 'public.classroom_receipts', { user_id: teacher, request_id: unrelatedReceipt, command_type: 'message.send', payload: { student_id: other, body: 'Synthetic unrelated content' }, result: {} });
    await insert(db, 'auth.audit_log_entries', { id: unrelatedAudit, payload: { actor_id: other, traits: { user_email: email(other) } } });
    const plan = await prepare(db, admin, target, email(target), [digest]);
    assert.equal(plan.exists, true);assert.ok(plan.emails.includes(alias));assert.deepEqual(plan.storage, []);
    const populated = await ownedRows(db, target);
    for (const [table, rows] of Object.entries(populated)) {
      if (table !== 'public.owner_allowlist') assert.ok(rows.length > 0, `${table} must be populated to test its cascade`);
    }
    // Auth writes this audit immediately before deleting its user in the same transaction.
    await insert(db, 'auth.audit_log_entries', { id: randomUUID(), payload: { actor_id: admin, action: 'user_deleted', traits: { user_id: target, user_email: email(target) } } });
    await assert.rejects(() => db.query('delete from public.study_sessions where id=$1', [targetStudy.session]), /DURATION_IMMUTABLE/);
    await db.query('delete from auth.users where id=$1', [target]);
    for (const [table, rows] of Object.entries(await ownedRows(db, target))) assert.equal(rows.length, 0, table);
    assert.deepEqual(await ownedRows(db, other), survivingBefore);
    assert.equal((await db.query('select 1 from public.classroom_accounts where id=$1', [target])).rows.length, 0);
    for (const table of ['classroom_messages', 'classroom_alerts', 'classroom_feedback', 'classroom_applications']) assert.equal((await db.query(`select 1 from public.${table}`)).rows.length, 0, table);
    for (const table of ['friendships', 'friend_invites', 'friend_groups', 'friend_group_members', 'classroom_email_outbox']) assert.equal((await db.query(`select 1 from private.${table}`)).rows.length, 0, table);
    assert.deepEqual((await db.query<{ key: string }>('select key from private.classroom_registration_attempts order by key')).rows.map(row => row.key), survivingCounterKeys);
    for (const [index, table] of globals.entries()) assert.deepEqual((await db.query(`select to_jsonb(t) value from ${table} t order by to_jsonb(t)::text`)).rows, globalBefore[index].rows, table);
    for (const table of ['identities', 'sessions', 'refresh_tokens', 'mfa_factors', 'mfa_challenges', 'mfa_amr_claims', 'mfa_recovery_code_sets', 'mfa_recovery_codes', 'one_time_tokens', 'oauth_authorizations', 'oauth_consents', 'webauthn_challenges', 'webauthn_credentials', 'flow_state', 'oauth_client_states', 'saml_relay_states', 'scim_users']) assert.equal((await db.query(`select 1 from auth.${table}`)).rows.length, 0, table);
    assert.deepEqual((await db.query('select id from auth.audit_log_entries')).rows, [{ id: unrelatedAudit }]);
    assert.deepEqual((await db.query('select request_id from public.classroom_receipts')).rows, [{ request_id: unrelatedReceipt }]);
    assert.equal((await db.query('select 1 from public.demo_sessions')).rows.length, 0);
    assert.equal((await prepare(db, admin, target)).exists, false);
    await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${target}',false)`);
    await assert.rejects(() => db.query('select public.yks_state()'), /OWNER_REQUIRED/);
  } finally { await db.close(); }
});

test('teacher closure detaches surviving students and erases invitation copies without erasing their study records', async () => {
  const { db, admin } = await database();
  try {
    const teacher = randomUUID(), student = randomUUID(), otherTeacher = randomUUID(), token = 'e'.repeat(64);
    await account(db, teacher, 'teacher');await account(db, otherTeacher, 'teacher');await account(db, student, 'student', teacher);await seedStudyGraph(db, student);
    const application = randomUUID();
    await insert(db, 'public.classroom_applications', { id: application, user_id: student, name: 'Synthetic student', email: email(student), requested_role: 'student', teacher_id: teacher, reviewed_by: teacher });
    await insert(db, 'public.classroom_invites', { teacher_id: teacher, token, expires_at: '2026-10-10T00:00:00Z' });
    await db.query('update auth.users set raw_user_meta_data=$2::jsonb where id=$1', [student, JSON.stringify({ name: 'Synthetic student', invite_token: token, requested_role: 'student' })]);
    await insert(db, 'public.classroom_receipts', { user_id: student, request_id: randomUUID(), command_type: 'synthetic.invite', payload: { invite_token: token }, result: {} });
    const before = await ownedRows(db, student);
    await prepare(db, admin, teacher);
    await assert.rejects(() => db.query("update public.classroom_accounts set status='approved' where id=$1", [teacher]), /ACCOUNT_DELETION_IN_PROGRESS/);
    await db.query('delete from auth.users where id=$1', [teacher]);
    assert.equal((await db.query<{ teacher_id: string | null }>('select teacher_id from public.classroom_accounts where id=$1', [student])).rows[0].teacher_id, null);
    const applicationAfter = (await db.query<{ teacher_id: null; reviewed_by: null }>('select teacher_id,reviewed_by from public.classroom_applications where id=$1', [application])).rows[0];
    assert.deepEqual(applicationAfter, { teacher_id: null, reviewed_by: null });
    const after = await ownedRows(db, student);
    for (const table of Object.keys(before).filter(table => !['public.classroom_applications', 'public.classroom_receipts', 'public.classroom_events', 'private.state_cache_generations'].includes(table))) assert.deepEqual(after[table], before[table], table);
    const generation = (await db.query<{ generation: number }>('select generation from private.state_cache_generations where user_id=$1', [student])).rows[0].generation;
    const previousGeneration = (before['private.state_cache_generations'][0] as { value: { generation: number } }).value.generation;
    assert.ok(generation > previousGeneration, 'surviving student cache is invalidated after its teacher is removed');
    assert.deepEqual((await db.query('select raw_user_meta_data from auth.users where id=$1', [student])).rows[0], { raw_user_meta_data: { name: 'Synthetic student', requested_role: 'student' } });
    assert.equal((await db.query('select 1 from public.classroom_invites')).rows.length, 0);
    assert.equal((await db.query('select 1 from public.classroom_accounts where id=$1', [otherTeacher])).rows.length, 1);
  } finally { await db.close(); }
});

test('server preparation rejects untrusted roles, protected targets and inexact confirmation without changing accounts', async () => {
  const { db, admin } = await database();
  try {
    const target = randomUUID(), teacher = randomUUID(), pendingAdmin = randomUUID(), secondAdmin = randomUUID();
    await account(db, target);await account(db, teacher, 'teacher');await account(db, pendingAdmin, 'admin', null, 'suspended');await account(db, secondAdmin, 'admin');
    for (const actor of [target, teacher, pendingAdmin, randomUUID()]) await assert.rejects(() => prepare(db, actor, target), /ACCESS_DENIED/);
    for (const protectedId of [admin, secondAdmin]) await assert.rejects(() => prepare(db, admin, protectedId), /ACCESS_DENIED/);
    for (const confirmation of [email(target).toUpperCase(), ` ${email(target)}`, 'wrong@example.test']) await assert.rejects(() => prepare(db, admin, target, confirmation), /DELETE_CONFIRMATION_REQUIRED/);
    await assert.rejects(() => prepare(db, admin, target, email(target), ['bad']), /INVALID_INPUT/);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(() => db.query('select public.classroom_account_delete_prepare($1,$2,$3)', [admin, target, email(target)]), /permission denied/);
      await db.exec('reset role');
    }
    assert.equal((await db.query<{ status: string }>('select status from public.classroom_accounts where id=$1', [target])).rows[0].status, 'approved');
    assert.equal((await db.query('select 1 from private.classroom_account_deletion_keys')).rows.length, 0);
    await prepare(db, admin, target);
    await db.query("update public.classroom_accounts set role='admin' where id=$1", [target]);
    await assert.rejects(() => db.query('delete from auth.users where id=$1', [target]), /ACCESS_DENIED/);
  } finally { await db.close(); }
});

test('Storage ownership and UUID folder boundaries block deletion until bytes are removed through Storage', async () => {
  const { db, admin } = await database();
  try {
    const target = randomUUID(), other = randomUUID();await account(db, target);await account(db, other);
    const targetObjects = [
      { id: randomUUID(), bucket_id: 'exam-documents', name: `${target}/synthetic.pdf`, owner: null, owner_id: null },
      { id: randomUUID(), bucket_id: 'other-bucket', name: 'owned-by-uuid', owner: target, owner_id: null },
      { id: randomUUID(), bucket_id: 'other-bucket', name: 'owned-by-text', owner: null, owner_id: target },
    ];
    for (const row of targetObjects) await insert(db, 'storage.objects', row);
    const unrelated = { id: randomUUID(), bucket_id: 'exam-documents', name: `${target}-other/synthetic.pdf`, owner: other, owner_id: other };
    await insert(db, 'storage.objects', unrelated);
    const plan = await prepare(db, admin, target);assert.equal(plan.storage.length, 3);
    await assert.rejects(() => db.query('delete from auth.users where id=$1', [target]), /STORAGE_CLEANUP_REQUIRED/);
    assert.equal((await db.query('select 1 from auth.users where id=$1', [target])).rows.length, 1);
    // Represents successful Storage API removal; production never SQL-deletes these rows.
    await db.query('delete from storage.objects where id=any($1::uuid[])', [targetObjects.map(row => row.id)]);
    await insert(db, 'storage.s3_multipart_uploads', { id: randomUUID(), owner_id: target, bucket_id: 'exam-documents', key: `${target}/partial.pdf` });
    await assert.rejects(() => db.query('delete from auth.users where id=$1', [target]), /STORAGE_CLEANUP_REQUIRED/);
    await db.exec('delete from storage.s3_multipart_uploads');
    await db.query('delete from auth.users where id=$1', [target]);
    assert.deepEqual((await db.query('select id from storage.objects')).rows, [{ id: unrelated.id }]);
  } finally { await db.close(); }
});

test('Auth delete failure rolls back target records and all cross-user scrubbing together', async () => {
  const { db, admin } = await database();
  try {
    const target = randomUUID(), other = randomUUID();await account(db, target);await account(db, other);await seedStudyGraph(db, target);
    const receipt = randomUUID(), digest = 'f'.repeat(64);
    await insert(db, 'public.classroom_receipts', { user_id: other, request_id: receipt, command_type: 'synthetic.copy', payload: { id: target }, result: {} });
    await insert(db, 'private.classroom_registration_attempts', { key: `email:${digest}`, attempts: 1, reset_at: '2026-10-10T00:00:00Z' });
    await prepare(db, admin, target, email(target), [digest]);
    const before = await ownedRows(db, target);
    await db.exec(`create function public.synthetic_delete_failure() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_FAILURE';end$$;
      create trigger z_synthetic_delete_failure before delete on auth.users for each row execute function public.synthetic_delete_failure();`);
    await assert.rejects(() => db.query('delete from auth.users where id=$1', [target]), /SYNTHETIC_FAILURE/);
    assert.deepEqual(await ownedRows(db, target), before);
    assert.equal((await db.query('select 1 from public.classroom_receipts where request_id=$1', [receipt])).rows.length, 1);
    assert.equal((await db.query('select 1 from private.classroom_registration_attempts where key=$1', [`email:${digest}`])).rows.length, 1);
    await db.exec('drop trigger z_synthetic_delete_failure on auth.users');
    await db.query('delete from auth.users where id=$1', [target]);
    assert.equal((await db.query('select 1 from public.classroom_receipts where request_id=$1', [receipt])).rows.length, 0);
    assert.equal((await db.query('select 1 from private.classroom_registration_attempts where key=$1', [`email:${digest}`])).rows.length, 0);
  } finally { await db.close(); }
});
