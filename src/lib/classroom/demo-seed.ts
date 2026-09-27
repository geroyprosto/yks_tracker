import type { PGlite } from '@electric-sql/pglite';
import type { ExamFormat } from '../domain/types';
import type { ClassroomAccountStatus, ClassroomRole } from './types';
import { CLASSROOM_TIMEZONE, classroomWeekStart, shiftClassroomDate } from './metrics';
import { localDate } from '../ui';

/** These identities exist only in the isolated, local PGlite demo database. */
const id = (group: number, person: number, record = 0) =>
  `d0000000-0000-4000-8${group.toString(16).padStart(3, '0')}-${String(person).padStart(6, '0')}${String(record).padStart(6, '0')}`;
export const DEMO_ADMIN_ID = id(0, 0, 1);
export const DEMO_TEACHER_IDS = [id(0, 0, 11), id(0, 0, 12)] as const;
export const DEMO_STUDENT_IDS = Array.from({ length: 35 }, (_, index) => id(0, 0, 101 + index));
/** Three devices in each teacher's class simulate an open application in local previews. */
export const DEMO_PRESENCE_SIMULATIONS = [1, 2, 7, 13, 14, 15].map(index => ({
  user_id: DEMO_STUDENT_IDS[index], device_id: id(8, index + 1),
}));
export type ClassroomDemoAccount = {
  id: string; key: string; name: string; email: string; role: ClassroomRole;
  status: ClassroomAccountStatus; teacher_id: string | null;
};

const studentNames = [
  'Ecrin Yılmaz', 'Arda Demir', 'Zeynep Kaya', 'Kerem Şahin', 'Elif Aydın',
  'Mert Çelik', 'İpek Arslan', 'Yusuf Koç', 'Defne Yıldız', 'Deniz Aksoy',
  'Ada Karaca', 'Emir Güneş', 'Asya Polat', 'Berk Eren', 'Duru Taş',
  'Efe Yalçın', 'Selin Özdemir', 'Alp Türkmen', 'Yağmur Acar', 'Kaan Güler',
  'Nehir Kurt', 'Ömer Tekin', 'Sude Aktaş', 'Doruk Erdem', 'İdil Keskin',
  'Can Bozkurt', 'Nisa Korkmaz', 'Umut Sezer', 'Azra Çetin', 'Onur Aslan',
  'Ceren Bulut', 'Baran Doğan', 'Melis Ekinci', 'Bora Uslu', 'Ela Yavuz',
];
export const CLASSROOM_DEMO_ACCOUNTS: readonly ClassroomDemoAccount[] = [
  { id: DEMO_ADMIN_ID, key: 'admin', name: 'Sümeyra · Demo Yönetici', email: 'yonetici@classroom-demo.invalid', role: 'admin', status: 'approved', teacher_id: null },
  { id: DEMO_TEACHER_IDS[0], key: 'teacher-10', name: 'Ayşe Demir', email: 'ayse@classroom-demo.invalid', role: 'teacher', status: 'approved', teacher_id: null },
  { id: DEMO_TEACHER_IDS[1], key: 'teacher-25', name: 'Mehmet Yıldız', email: 'mehmet@classroom-demo.invalid', role: 'teacher', status: 'approved', teacher_id: null },
  ...studentNames.map((name, index) => ({
    id: DEMO_STUDENT_IDS[index], key: `student-${index + 1}`, name,
    email: `ogrenci${index + 1}@classroom-demo.invalid`, role: 'student' as const,
    status: 'approved' as const, teacher_id: DEMO_TEACHER_IDS[index < 10 ? 0 : 1],
  })),
  { id: id(0, 0, 201), key: 'pending-teacher', name: 'Selma Deniz', email: 'selma@classroom-demo.invalid', role: 'teacher', status: 'pending', teacher_id: null },
  { id: id(0, 0, 202), key: 'pending-student', name: 'Ali Çınar', email: 'ali@classroom-demo.invalid', role: 'student', status: 'pending', teacher_id: null },
];

const SEED_VERSION = 1;
type SeedConnection = Pick<PGlite, 'query'>;
type Row = Record<string, unknown>;
async function insertRows(db: SeedConnection, table: string, rows: Row[], conflict: string[], update = true) {
  if (!rows.length) return;
  // Every identifier is authored in this file, never supplied by an HTTP request.
  const columns = Object.keys(rows[0]);
  const changes = columns.filter(column => !conflict.includes(column));
  await db.query(`insert into ${table} (${columns.join(',')})
    select ${columns.join(',')} from jsonb_populate_recordset(null::${table}, $1::jsonb)
    on conflict (${conflict.join(',')}) do ${update && changes.length
      ? `update set ${changes.map(column => `${column}=excluded.${column}`).join(',')}` : 'nothing'}`,
  [JSON.stringify(rows)]);
}
function stamp(date: string, hour = 12, minute = 0) {
  return new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:00`).toISOString();
}
function iso(time: number) { return new Date(time).toISOString(); }

/**
 * Keep six explicitly simulated demo devices connected. Their working/break
 * state is still derived by the classroom RPC from their real stored timer;
 * this function never starts, resumes or fabricates a study interval. Ecrin and
 * the interactive browser-test student are intentionally outside this list.
 * All real browser devices retain their normal heartbeat/leave/expiry behavior.
 */
export async function refreshDemoPresence(db: PGlite, now = new Date()): Promise<number> {
  if (process.env.NODE_ENV === 'production') throw new Error('CLASSROOM_DEMO_DISABLED_IN_PRODUCTION');
  if (!Number.isFinite(now.getTime())) throw new Error('INVALID_DEMO_DATE');
  const initialized = await db.query<{ initialized: boolean }>(
    "select to_regclass('private.classroom_demo_seed_local') is not null as initialized",
  );
  if (!initialized.rows[0]?.initialized) throw new Error('CLASSROOM_DEMO_REQUIRES_SEEDED_DATABASE');
  const result = await db.query(`update public.classroom_presence p
    set visible=true,last_seen=$2::timestamptz,expires_at=$2::timestamptz+interval '75 seconds'
    from jsonb_to_recordset($1::jsonb) as simulation(user_id uuid,device_id uuid),public.classroom_accounts account
    where p.user_id=simulation.user_id and p.device_id=simulation.device_id and account.id=p.user_id
      and account.role='student' and account.status='approved'
      and account.email like '%@classroom-demo.invalid'
    returning p.user_id`, [JSON.stringify(DEMO_PRESENCE_SIMULATIONS), now.toISOString()]);
  return result.rows.length;
}

/**
 * Re-runnable local demonstration: the same day/version does not overwrite
 * messages, approvals or timer interactions. On a later day only stable seeded
 * rows are refreshed; records made while exploring the demo are preserved.
 * This entry point never connects to Supabase or creates real Auth passwords.
 */
export async function seedClassroomDemo(db: PGlite, now = new Date()): Promise<{ seeded: boolean; day: string }> {
  if (process.env.NODE_ENV === 'production') throw new Error('CLASSROOM_DEMO_DISABLED_IN_PRODUCTION');
  const today = localDate(now, CLASSROOM_TIMEZONE);
  const current = now.getTime();
  if (!Number.isFinite(current)) throw new Error('INVALID_DEMO_DATE');
  // Defense against accidentally reusing this helper with a real Auth schema.
  const realAuth = await db.query(`select 1 from information_schema.columns
    where table_schema='auth' and table_name='users' and column_name='encrypted_password'`);
  if (realAuth.rows.length) throw new Error('CLASSROOM_DEMO_REQUIRES_ISOLATED_DATABASE');
  await db.exec(`create table if not exists private.classroom_demo_seed_local(
    singleton boolean primary key default true check(singleton),version integer not null,day date not null);
    revoke all on private.classroom_demo_seed_local from public,anon,authenticated;`);
  const old = await db.query<{ version: number; day: string }>('select version,day::text from private.classroom_demo_seed_local where singleton');
  if (old.rows[0]?.version === SEED_VERSION && old.rows[0]?.day === today) return { seeded: false, day: today };

  await db.transaction(async tx => {
    const ids = CLASSROOM_DEMO_ACCOUNTS.map(account => account.id);
    const collisions = await tx.query(`select id from auth.users where id=any($1::uuid[])
      and (email is null or email not like '%@classroom-demo.invalid')`, [ids]);
    if (collisions.rows.length) throw new Error('CLASSROOM_DEMO_ID_COLLISION');
    await insertRows(tx, 'auth.users', CLASSROOM_DEMO_ACCOUNTS.map(account => ({
      id: account.id, email: account.email, email_confirmed_at: iso(current - 30 * 86400000),
    })), ['id'], false);
    await insertRows(tx, 'public.classroom_accounts', CLASSROOM_DEMO_ACCOUNTS.map(account => ({
      id: account.id, name: account.name, email: account.email, role: account.role,
      status: account.status, teacher_id: account.teacher_id,
      created_at: iso(current - 30 * 86400000), updated_at: now.toISOString(),
    })), ['id'], false);
    await insertRows(tx, 'public.profiles', CLASSROOM_DEMO_ACCOUNTS.filter(account => account.role === 'student' && account.status === 'approved').map((account, index) => ({
      user_id: account.id, display_name: account.name, exam_year: now.getFullYear() + 1,
      timezone: CLASSROOM_TIMEZONE, daily_target_minutes: 180 + index % 5 * 30,
      theme: 'ocean', appearance: 'dark', updated_at: now.toISOString(),
    })), ['user_id'], false);
    const formats = (await tx.query<ExamFormat>('select * from public.exam_format_versions where version=1')).rows;
    const topics = (await tx.query<{ exam: 'TYT' | 'AYT'; subject: string; name: string; source: string }>('select * from private.starter_topics()')).rows;

    for (let index = 0; index < 35; index++) {
      const user_id = DEMO_STUDENT_IDS[index];
      const teacher_id = DEMO_TEACHER_IDS[index < 10 ? 0 : 1];
      const person = index + 1;
      await insertRows(tx, 'public.topics', topics.map((topic, topicIndex) => ({
        ...topic, id: id(4, person, topicIndex), user_id, mastery: (index * 3 + topicIndex * 7 + Math.floor(topicIndex / 9)) % 5,
        notes: '', source: topic.source, updated_at: iso(current - (topicIndex % 20) * 86400000),
      })), ['user_id', 'exam', 'subject', 'name'], false);

      const sessions: Row[] = [];
      const intervals: Row[] = [];
      const questions: Row[] = [];
      const midnight = Date.parse(stamp(today, 0));
      for (let daysAgo = 20; daysAgo >= 0; daysAgo--) {
        if (daysAgo > 0 && (daysAgo + index) % 6 === 0) continue;
        const date = shiftClassroomDate(today, -daysAgo);
        const total = (45 + (index * 17 + daysAgo * 11) % 135) * 60;
        const pause = (8 + index % 8) * 60;
        const session_id = id(2, person, daysAgo);
        let start = Date.parse(stamp(date, 9 + index % 6, daysAgo % 4 * 10));
        let actual = total;
        let breakSeconds = pause;
        if (daysAgo === 0) {
          const available = Math.max(0, Math.floor((current - midnight) / 1000) - 120);
          actual = Math.min(total, available);
          breakSeconds = Math.min(pause, Math.max(0, available - actual));
          start = Math.max(midnight, current - (actual + breakSeconds + 120) * 1000);
        }
        if (actual > 0) {
          const first = Math.floor(actual * .55);
          const finish = start + (actual + breakSeconds) * 1000;
          sessions.push({ id: session_id, user_id, title: `${daysAgo % 2 ? 'Matematik' : 'Türkçe'} çalışma`,
            subject: daysAgo % 2 ? 'Matematik' : 'Türkçe', study_type: 'Soru çözümü', mode: 'stopwatch',
            status: 'finished', started_at: iso(start), active_since: null,
            accumulated_seconds: actual, finished_at: iso(finish), revision: 1 });
          intervals.push({ id: id(3, person, daysAgo * 2), user_id, session_id, started_at: iso(start), ended_at: iso(start + first * 1000) });
          intervals.push({ id: id(3, person, daysAgo * 2 + 1), user_id, session_id,
            started_at: iso(start + (first + breakSeconds) * 1000), ended_at: iso(finish) });
        }
        for (let subject = 0; subject < 3; subject++) questions.push({
          id: id(5, person, daysAgo * 3 + subject), user_id, practice_date: date,
          exam: subject === 2 ? 'AYT' : 'TYT', subject: ['Matematik', 'Türkçe', 'Fizik'][subject],
          question_count: 12 + (index * 13 + daysAgo * 7 + subject * 17) % 73,
          test_count: 0, revision: 1, created_at: daysAgo ? stamp(date, 18) : now.toISOString(),
          updated_at: daysAgo ? stamp(date, 18) : now.toISOString(),
        });
      }
      // A genuine Sunday-to-Monday interval exercises both calendar boundaries.
      const monday = classroomWeekStart(today);
      const boundary = Date.parse(stamp(monday, 0));
      const end = Math.min(boundary + 25 * 60000, current);
      const crossId = id(2, person, 100);
      sessions.push({ id: crossId, user_id, title: 'Gece tekrarı', subject: 'Matematik', study_type: 'Tekrar',
        mode: 'stopwatch', status: 'finished', started_at: iso(boundary - 20 * 60000), active_since: null,
        accumulated_seconds: Math.floor((end - boundary + 20 * 60000) / 1000), finished_at: iso(end), revision: 1 });
      intervals.push({ id: id(3, person, 1000), user_id, session_id: crossId,
        started_at: iso(boundary - 20 * 60000), ended_at: iso(end) });
      await insertRows(tx, 'public.study_sessions', sessions, ['id']);
      await insertRows(tx, 'public.study_intervals', intervals, ['id']);
      await insertRows(tx, 'public.practice_entries', questions, ['id']);

      const activeMode = index % 4;
      if (activeMode === 1 || activeMode === 2) {
        const currentId = id(2, person, 200);
        const competing = await tx.query('select id from public.study_sessions where user_id=$1 and status in (\'running\',\'paused\') and id<>$2', [user_id, currentId]);
        if (!competing.rows.length) {
          const activeStart = current - 60 * 1000;
          await insertRows(tx, 'public.study_sessions', [{ id: currentId, user_id, title: 'Matematik odak çalışması',
            subject: 'Matematik', study_type: 'Soru çözümü', mode: 'stopwatch', status: activeMode === 1 ? 'running' : 'paused',
            started_at: iso(activeStart), active_since: activeMode === 1 ? iso(activeStart) : null,
            accumulated_seconds: activeMode === 1 ? 0 : 40, finished_at: null, revision: 1 }], ['id']);
          await insertRows(tx, 'public.study_intervals', [{ id: id(3, person, 2000), user_id, session_id: currentId,
            started_at: iso(activeStart), ended_at: activeMode === 1 ? null : iso(activeStart + 40000) }], ['id']);
        }
      }
      await insertRows(tx, 'public.classroom_presence', [{ user_id, device_id: id(8, person),
        visible: activeMode !== 0, last_seen: iso(current - (activeMode === 0 ? (35 + index * 7) * 60000 : 0)),
        expires_at: iso(current + (activeMode === 0 ? -60000 : 90000)) }], ['user_id', 'device_id']);

      for (const [formatIndex, code] of (['TYT', 'AYT_SAYISAL'] as const).entries()) {
        // A few students have no AYT yet; one per class has no exam data at all.
        if (index === 9 || index === 34 || (formatIndex === 1 && index % 7 === 0)) continue;
        const format = formats.find(item => item.code === code)!;
        for (let attempt = 0; attempt < 3; attempt++) {
          const exam_id = id(6, person, formatIndex * 10 + attempt);
          const exam_date = shiftClassroomDate(today, -(18 - attempt * 7 + index % 3));
          const direction = index % 3 === 0 ? 1 : index % 3 === 1 ? -1 : 0;
          const results = format.sections.map((section, sectionIndex) => {
            const fraction = .38 + ((index * 7 + sectionIndex * 3) % 36) / 100;
            const trend = direction * attempt * (section.key === 'matematik' ? 2 : 1);
            const correct = Math.min(section.question_count, Math.max(0, Math.round(section.question_count * fraction) + trend));
            const wrong = Math.min(section.question_count - correct, 1 + (index + sectionIndex) % Math.max(2, Math.round(section.question_count * .16)));
            return { exam_id, user_id, section_key: section.key, correct, wrong,
              blank: section.question_count - correct - wrong, net: correct - wrong / format.wrong_divisor };
          });
          await insertRows(tx, 'public.exams', [{ id: exam_id, user_id, name: `${code === 'TYT' ? 'TYT' : 'AYT Sayısal'} Genel Deneme ${attempt + 1}`,
            publisher: ['Yol Haritası', 'Adım Adım', 'Hedef'][index % 3], exam_date, format_code: code, format_version: format.version,
            format_snapshot: format, duration_minutes: code === 'TYT' ? 150 + index % 4 * 5 : 140 + index % 5 * 10,
            notes: 'Yerel demo için üretilmiş örnek sonuçlar.', total_net: results.reduce((sum, result) => sum + result.net, 0),
            total_net_source: 'sections', revision: 1, created_at: stamp(exam_date, 16), updated_at: stamp(exam_date, 16) }], ['id']);
          await insertRows(tx, 'public.exam_results', results, ['exam_id', 'section_key']);
        }
      }
      const category = (['praise', 'continue', 'excellent', 'warning'] as const)[index % 4];
      const messageId = id(7, person);
      await insertRows(tx, 'public.classroom_messages', [{ id: messageId, teacher_id, student_id: user_id, sender_id: teacher_id,
        parent_id: null, category, body: ['Matematikteki düzenli tekrarın sonuçlarına yansıyor. Tebrik ederim!',
          'Bu hafta belirlediğin çalışma düzenini sürdür; küçük adımlar birikiyor.',
          'Soru çözümündeki kararlılığın çok iyi. Emeğini fark ediyorum.',
          'Bugünkü tekrarını plana eklemeyi unutma. Zorlandığın soruları birlikte değerlendirebiliriz.'][index % 4],
        created_at: iso(current - (2 + index % 12) * 3600000), read_at: index % 3 === 0 ? null : iso(current - 3600000) }], ['id'], false);
      if (index % 3 === 1) await insertRows(tx, 'public.classroom_messages', [{ id: id(7, person, 1), teacher_id, student_id: user_id,
        sender_id: user_id, parent_id: messageId, category, body: 'Teşekkür ederim hocam, bugün matematik tekrarımı da tamamlayacağım.',
        created_at: iso(current - 1800000), read_at: null }], ['id'], false);
      if (index % 6 === 0) {
        const alertId = id(9, person);
        const refused = index % 12 === 0;
        const feedbackDay = shiftClassroomDate(today, -2);
        const acceptedTime = Date.parse(stamp(feedbackDay, 6));
        const startedTime = acceptedTime + 2 * 60000;
        await insertRows(tx, 'public.classroom_alerts', [{ id: alertId, teacher_id, student_id: user_id,
          body: 'Hemen kütüphaneye git :)', kind: 'initial', parent_id: null, status: refused ? 'declined' : 'accepted',
          refusal_count: refused ? 10 : 0, created_at: iso(acceptedTime - 10 * 60000),
          accepted_at: refused ? null : iso(acceptedTime), followup_due_at: refused ? null : iso(acceptedTime + 15 * 60000),
          started_at: refused ? null : iso(startedTime), closed_at: iso(acceptedTime) }], ['id'], false);
        await insertRows(tx, 'public.classroom_feedback', [{ id: id(10, person), alert_id: alertId, teacher_id, student_id: user_id,
          event: refused ? 'refused_ten' : 'accepted', body: refused ? 'Öğrenci uyarıya 10 kez Hayır dedi.' : 'Öğrenci çalışacağını onayladı.',
          created_at: iso(acceptedTime) }], ['alert_id', 'event'], false);
        if (!refused) await insertRows(tx, 'public.classroom_feedback', [{ id: id(10, person, 1), alert_id: alertId, teacher_id,
          student_id: user_id, event: 'started', body: 'Çalışmaya başladı.', created_at: iso(startedTime) }], ['alert_id', 'event'], false);
        if (!refused) {
          // The sample "started" event is backed by an actual matching study interval.
          const responseSession = id(2, person, 300);
          await insertRows(tx, 'public.study_sessions', [{ id: responseSession, user_id, title: 'Sabah tekrarı', subject: 'Matematik',
            study_type: 'Tekrar', mode: 'stopwatch', status: 'finished', started_at: iso(startedTime), active_since: null,
            accumulated_seconds: 1200, finished_at: iso(startedTime + 1200000), revision: 1 }], ['id'], false);
          await insertRows(tx, 'public.study_intervals', [{ id: id(3, person, 3000), user_id, session_id: responseSession,
            started_at: iso(startedTime), ended_at: iso(startedTime + 1200000) }], ['id'], false);
        }
      }
    }
    await insertRows(tx, 'public.classroom_applications', CLASSROOM_DEMO_ACCOUNTS.filter(account => account.status === 'pending').map((account, index) => ({
      id: id(11, index), user_id: account.id, name: account.name, email: account.email, requested_role: account.role,
      teacher_id: account.role === 'student' ? DEMO_TEACHER_IDS[0] : null, status: 'pending',
      created_at: iso(current - (index + 1) * 3600000), reviewed_at: null, reviewed_by: null,
    })), ['id'], false);
    await tx.query(`insert into private.classroom_demo_seed_local(singleton,version,day) values(true,$1,$2)
      on conflict(singleton) do update set version=excluded.version,day=excluded.day`, [SEED_VERSION, today]);
  });
  return { seeded: true, day: today };
}
