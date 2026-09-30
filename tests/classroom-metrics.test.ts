import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, type AppState, type ExamRecord, type StudySession } from '../src/lib/domain/types';
import { studentMetrics } from '../src/lib/classroom/metrics';
import { seedClassroomDemo, refreshDemoPresence, DEMO_PRESENCE_SIMULATIONS, DEMO_TEACHER_IDS, DEMO_STUDENT_IDS } from '../src/lib/classroom/demo-seed';

const now = new Date('2026-09-28T00:00:00Z'); // Monday, 03:00 Istanbul.
function session(id: string, start: string, finish: string): StudySession {
  return { id, title: 'Matematik', subject: 'Matematik', task_id: null, topic_id: null,
    study_type: 'Soru çözümü', mode: 'stopwatch', status: 'finished', started_at: start,
    active_since: null, accumulated_seconds: 99999, finished_at: finish, target_seconds: null, revision: 1 };
}
function exam(id: string, date: string, correct: number, wrong = 4): ExamRecord {
  return { id, exam_date: date, name: 'TYT', publisher: 'Demo', format_code: 'TYT', format_version: 1,
    format_snapshot: { code: 'TYT', version: 1, label: 'Test', total_questions: 40, wrong_divisor: 4,
      sections: [{ key: 'matematik', label: 'Matematik', question_count: 40 }] },
    duration_minutes: 60, notes: '', score: null, rank: null, source_document_id: null, import_metadata: null,
    results: [{ section_key: 'matematik', correct, wrong, blank: 40 - correct - wrong, net: correct - wrong / 4 }],
    reported_total_net: null, total_net: correct - wrong / 4, total_net_source: 'sections', revision: 1,
    created_at: `${date}T12:00:00Z`, updated_at: `${date}T12:00:00Z` };
}

test('Istanbul midnight and Monday split only actual study intervals, excluding a pause', () => {
  const state: AppState = { ...emptyState(),
    sessions: [session('s', '2026-09-27T20:30:00Z', '2026-09-27T21:40:00Z')],
    intervals: [
      { id: 'a', session_id: 's', started_at: '2026-09-27T20:30:00Z', ended_at: '2026-09-27T21:10:00Z' },
      { id: 'b', session_id: 's', started_at: '2026-09-27T21:30:00Z', ended_at: '2026-09-27T21:40:00Z' },
    ],
  };
  const monday = studentMetrics(state, now);
  assert.equal(monday.today, '2026-09-28');
  assert.equal(monday.weekStart, '2026-09-28');
  assert.equal(monday.todaySeconds, 1200);
  assert.equal(monday.weekSeconds, 1200);
  const sunday = studentMetrics(state, new Date('2026-09-27T20:59:59Z'));
  assert.equal(sunday.weekStart, '2026-09-21');
  assert.equal(sunday.todaySeconds, 1799);
});

test('overlapping device records are merged and orphan/paused open intervals are ignored', () => {
  const state = emptyState();
  state.sessions = [session('s', '2026-09-27T21:00:00Z', '2026-09-27T22:00:00Z'),
    { ...session('paused', '2026-09-27T21:00:00Z', '2026-09-27T22:00:00Z'), status: 'paused', finished_at: null }];
  state.intervals = [
    { id: '1', session_id: 's', started_at: '2026-09-27T21:00:00Z', ended_at: '2026-09-27T21:30:00Z' },
    { id: '2', session_id: 's', started_at: '2026-09-27T21:20:00Z', ended_at: '2026-09-27T22:00:00Z' },
    { id: '3', session_id: 'missing', started_at: '2026-09-27T21:00:00Z', ended_at: null },
    { id: '4', session_id: 'paused', started_at: '2026-09-27T21:00:00Z', ended_at: null },
  ];
  assert.equal(studentMetrics(state, now).todaySeconds, 3600);
});

test('active countdown caps time at remaining work and never adds paused wall time', () => {
  const state = emptyState();
  state.sessions = [{ ...session('s', '2026-09-27T21:00:00Z', '2026-09-27T22:00:00Z'),
    mode: 'countdown', target_seconds: 3600, accumulated_seconds: 3000, status: 'running',
    active_since: '2026-09-27T22:00:00Z', finished_at: null }];
  state.intervals = [
    { id: 'a', session_id: 's', started_at: '2026-09-27T21:00:00Z', ended_at: '2026-09-27T21:50:00Z' },
    { id: 'b', session_id: 's', started_at: '2026-09-27T22:00:00Z', ended_at: null },
  ];
  assert.equal(studentMetrics(state, now).todaySeconds, 3600);
});

test('latest completed examination differs from best; future and total-less records are excluded', () => {
  const state = emptyState();
  state.exams = [exam('best', '2026-09-15', 35), exam('previous', '2026-09-20', 25),
    exam('latest', '2026-09-25', 22), { ...exam('draft', '2026-09-27', 37), total_net: null },
    exam('future', '2026-10-01', 38), { ...exam('branch', '2026-09-28', 30), format_code: 'BRANCH' }];
  const result = studentMetrics(state, now);
  assert.equal(result.latestTYT?.exam.id, 'latest');
  assert.equal(result.latestTYT?.exam.total_net, 21);
  assert.equal(result.latestTYT?.previous?.id, 'previous');
  assert.equal(result.latestTYT?.delta, -3);
  assert.equal(result.latestTYT?.sections[0].delta, -3);
  assert.equal(result.latestAYT, null);
});

test('same-day exams have a deterministic latest record and support zero and negative nets', () => {
  const state = emptyState();
  state.exams = [exam('one', '2026-09-27', 1),
    { ...exam('two', '2026-09-27', 0), created_at: '2026-09-27T15:00:00Z' }];
  assert.equal(studentMetrics(state, now).latestTYT?.exam.total_net, -1);
  assert.equal(studentMetrics(state, now).latestTYT?.delta, -1);
});

test('no recorded data remains null, while explicit zero and zero-question records remain zero', () => {
  const state = emptyState();
  const result = studentMetrics(state, now);
  assert.equal(result.todaySeconds, null);
  assert.equal(result.weekSeconds, null);
  assert.equal(result.todayQuestions, null);
  assert.equal(result.latestTYT, null);
  assert.ok(result.weeklyStudy.every(day => day.seconds === null));
  state.day_marks = [{ id: 'zero', mark_date: '2026-09-28', kind: 'zero', revision: 1, created_at: now.toISOString(), updated_at: now.toISOString() }];
  state.practice_entries = [{ id: 'q', practice_date: '2026-09-28', exam: 'TYT', subject: 'Türkçe', question_count: 0,
    test_count: 1, revision: 1, created_at: now.toISOString(), updated_at: now.toISOString() }];
  const zero = studentMetrics(state, now);
  assert.equal(zero.todaySeconds, 0);
  assert.equal(zero.weekSeconds, 0);
  assert.equal(zero.todayQuestions, 0);
});

test('questions sum recorded counts and manual duration uses its reported calendar date', () => {
  const state = emptyState();
  state.manual_study_entries = [{ id: 'm', study_date: '2026-09-28', subject: 'Matematik', duration_seconds: 1800, created_at: now.toISOString() }];
  state.practice_entries = [20, 35, 12].map((count, index) => ({ id: String(index), practice_date: '2026-09-28',
    exam: 'TYT', subject: index === 2 ? 'Türkçe' : 'Matematik', question_count: count, test_count: 0,
    revision: 1, created_at: now.toISOString(), updated_at: now.toISOString() }));
  const result = studentMetrics(state, now);
  assert.equal(result.todaySeconds, 1800);
  assert.equal(result.todayQuestions, 67);
  assert.deepEqual(result.questionSubjects.map(row => row.questions), [55, 12]);
});

test('classroom question rows retain separate course identities and a clear unassigned label', () => {
  const state = emptyState();
  state.practice_entries = [
    { id: 'a', course_id: 'course-a', practice_date: '2026-09-28', exam: 'TYT', subject: 'Matematik', question_count: 12, test_count: 0, revision: 1, created_at: now.toISOString(), updated_at: now.toISOString() },
    { id: 'b', course_id: 'course-b', practice_date: '2026-09-28', exam: 'TYT', subject: 'Matematik', question_count: 8, test_count: 0, revision: 1, created_at: now.toISOString(), updated_at: now.toISOString() },
    { id: 'c', course_id: null, practice_date: '2026-09-28', exam: null, subject: null, question_count: 4, test_count: 0, revision: 1, created_at: now.toISOString(), updated_at: now.toISOString() },
  ];
  const rows = studentMetrics(state, now).questionSubjects;
  assert.deepEqual(rows.map(row => row.questions), [12, 8, 4]);
  assert.equal(new Set(rows.map(row => row.key)).size, 3);
  assert.deepEqual(rows.map(row => row.exam ? `${row.exam} ${row.subject}` : row.subject), ['TYT Matematik', 'TYT Matematik', 'Ders seçilmedi']);
});

test('isolated demo seed is repeatable, creates exactly 10/25 students and consistent current data', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { readFile, readdir } = await import('node:fs/promises');
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
    const directory = new URL('../supabase/migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(name, directory), 'utf8'));
    }
    const date = new Date();
    assert.equal((await seedClassroomDemo(db, date)).seeded, true);
    const liveSeeded=(await db.query<{user_id:string}>('select user_id from public.classroom_presence where expires_at>$1',[date.toISOString()])).rows;
    assert.deepEqual(new Set(liveSeeded.map(row=>row.user_id)),new Set(DEMO_PRESENCE_SIMULATIONS.map(row=>row.user_id)));
    const counts = (await db.query<{ teacher_id: string; count: number }>(`select teacher_id,count(*)::integer as count
      from public.classroom_accounts where role='student' and status='approved' group by teacher_id order by teacher_id`)).rows;
    assert.deepEqual(counts, DEMO_TEACHER_IDS.map((teacher_id, index) => ({ teacher_id, count: index === 0 ? 10 : 25 })));
    const before = (await db.query<{ count: number }>('select count(*)::integer as count from public.study_sessions')).rows[0].count;
    assert.equal((await seedClassroomDemo(db, date)).seeded, false);
    assert.equal((await db.query<{ count: number }>('select count(*)::integer as count from public.study_sessions')).rows[0].count, before);
    const invalidResults = await db.query(`select r.exam_id from public.exam_results r join public.exams e on e.id=r.exam_id
      cross join lateral jsonb_array_elements(e.format_snapshot->'sections') spec
      where spec->>'key'=r.section_key and (r.correct+r.wrong+r.blank<>(spec->>'question_count')::int
      or r.net<>r.correct-r.wrong/(e.format_snapshot->>'wrong_divisor')::numeric)`);
    assert.equal(invalidResults.rows.length, 0);
    const invalidTotals = await db.query(`select e.id from public.exams e join public.exam_results r on r.exam_id=e.id
      group by e.id having sum(r.net)<>e.total_net`);
    assert.equal(invalidTotals.rows.length, 0);
    const invalidSessions = await db.query(`select s.id from public.study_sessions s join public.study_intervals i on i.session_id=s.id
      where s.status='finished' group by s.id having s.accumulated_seconds<>sum(extract(epoch from (i.ended_at-i.started_at)))`);
    assert.equal(invalidSessions.rows.length, 0);
    for (let teacher = 0; teacher < 2; teacher++) {
      await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${DEMO_TEACHER_IDS[teacher]}',false);`);
      const result = (await db.query<{ value: { students: Array<{ id: string; teacher_id: string; state: AppState }> } }>('select public.classroom_state() as value')).rows[0].value;
      assert.equal(result.students.length, teacher ? 25 : 10);
      assert.ok(result.students.every(student => student.teacher_id === DEMO_TEACHER_IDS[teacher]));
      for (const student of result.students) {
        const metrics = studentMetrics(student.state, date);
        assert.ok(metrics.todayQuestions! > 0);
        assert.ok(metrics.weekSeconds! > 0);
      }
      await db.exec('reset role');
    }
    assert.equal((await db.query('select id from public.classroom_accounts where id=any($1::uuid[])', [DEMO_STUDENT_IDS])).rows.length, 35);
    const intervalsBefore = (await db.query<{ count: number }>('select count(*)::integer as count from public.study_intervals')).rows[0].count;
    const interactiveBefore = (await db.query<{ last_seen: string; expires_at: string }>(
      'select last_seen::text,expires_at::text from public.classroom_presence where user_id=$1', [DEMO_STUDENT_IDS[0]],
    )).rows[0];
    const later = new Date(date.getTime() + 3600000);
    assert.equal(await refreshDemoPresence(db, later), 6);
    const simulated = (await db.query<{ user_id: string; fresh: boolean }>(`select user_id,
      last_seen=$1::timestamptz and expires_at=$1::timestamptz+interval '75 seconds' as fresh
      from public.classroom_presence where user_id=any($2::uuid[])`, [later.toISOString(), DEMO_PRESENCE_SIMULATIONS.map(item => item.user_id)])).rows;
    assert.equal(simulated.length, 6); assert.ok(simulated.every(row => row.fresh));
    assert.equal((await db.query<{ count: number }>('select count(*)::integer as count from public.study_intervals')).rows[0].count, intervalsBefore);
    assert.deepEqual((await db.query<{ last_seen: string; expires_at: string }>(
      'select last_seen::text,expires_at::text from public.classroom_presence where user_id=$1', [DEMO_STUDENT_IDS[0]],
    )).rows[0], interactiveBefore);
  } finally { await db.close(); }
});
