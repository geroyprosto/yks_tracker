import {expect, test, type Page} from '@playwright/test';
import {emptyState, type AppState} from '../../src/lib/domain/types';
import {defaultModules, type CourseExamResult, type EducationState} from '../../src/lib/education';

const stamp = '2026-09-27T10:00:00.000Z', day = '2026-09-27';
const termId = '00000000-0000-4000-8000-000000000001';
const names = ['Matematik', 'Bilişim', 'Yabancı Dil', 'İktisat'];
function fixture(): AppState {
  const education: EducationState = {
    profile: {education_level: 'university', yks_goal: false, grade: null, department: 'Uluslararası Ticaret', university_year: '1', yks_track: 'undecided', modules: defaultModules, active_term_id: termId, onboarding_completed_at: stamp, revision: 1},
    draft: null, needs_onboarding: false, can_commit: true,
    terms: [{id: termId, academic_year: '2026–2027', name: 'Güz', starts_on: null, ends_on: null, archived: false, revision: 1, created_at: stamp}],
    courses: names.map((name, index) => ({id: `00000000-0000-4000-8000-00000000001${index}`, term_id: termId, name, normalized_name: name.toLocaleLowerCase('tr-TR'), context: 'school', exam: null, archived: false, revision: 1, created_at: stamp, updated_at: stamp})),
    results: [],
  };
  return {...emptyState(true), authenticated: true, server_now: stamp, education};
}
type Request = {request_id: string; type: string; payload: {rows?: Omit<CourseExamResult, 'id' | 'term_id' | 'course_name' | 'revision' | 'created_at' | 'updated_at'>[]; id?: string; expected_revision?: number; score?: number}};

async function openResults(page: Page, state: AppState, failFirst = false) {
  const sent: Request[] = [], handled = new Set<string>();
  await page.clock.setFixedTime(new Date(stamp));
  await page.route('**/api/state', route => route.fulfill({json: state}));
  await page.route('**/api/education', async route => {
    const request = route.request().postDataJSON() as Request;
    sent.push(request);
    const education = state.education!;
    if (!handled.has(request.request_id)) {
      if (request.type === 'results.batch') {
        education.results.push(...request.payload.rows!.map((row, index) => ({...row, id: `${request.request_id}-${index}`, term_id: termId, course_name: education.courses.find(course => course.id === row.course_id)!.name, revision: 1, created_at: stamp, updated_at: stamp})));
      } else if (request.type === 'result.update') {
        const result = education.results.find(record => record.id === request.payload.id)!;
        Object.assign(result, request.payload, {revision: result.revision + 1});
      } else throw new Error(`Unexpected education command: ${request.type}`);
      handled.add(request.request_id);
    }
    if (failFirst && sent.length === 1) {await route.fulfill({status: 503, json: {error: {message: 'Sentetik yanıt kaybı'}}}); return;}
    await route.fulfill({json: {ok: true, state: education}});
  });
  await page.goto('/');
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Sınav Sonuçları', exact: true}).click();
  return sent;
}

test('quick table skips blanks, keeps zero/decimal, Enter advances, failed response retries one atomic request', async ({page}) => {
  const state = fixture(), sent = await openResults(page, state, true);
  await expect(page.getByRole('button', {name: 'Konularım', exact: true})).toHaveCount(0);
  await page.getByLabel('Matematik puanı', {exact: true}).fill('0');
  await page.getByLabel('Matematik puanı', {exact: true}).press('Enter');
  await expect(page.getByLabel('Bilişim puanı', {exact: true})).toBeFocused();
  await page.getByLabel('Bilişim puanı', {exact: true}).fill('87,5');
  await page.getByRole('button', {name: 'Tümünü kaydet', exact: true}).click();
  await expect(page.getByText('Kayıt doğrulanamadı.', {exact: false})).toBeVisible();
  await expect(page.getByLabel('Bilişim puanı', {exact: true})).toHaveValue('87,5');
  await page.getByRole('button', {name: 'Tümünü kaydet', exact: true}).click();
  await expect(page.getByRole('status')).toContainText('2 sınav sonucu birlikte kaydedildi.');
  expect(sent).toHaveLength(2);
  expect(sent[0].request_id).toBe(sent[1].request_id);
  expect(sent[0].payload.rows!.map(row => row.score)).toEqual([0, 87.5]);
  expect(state.education!.results).toHaveLength(2);
  await expect(page.getByLabel('Matematik puanı', {exact: true})).toHaveValue('');

  // A deliberately new exam with the same date and score has a new operation identity.
  await page.getByLabel('Matematik puanı', {exact: true}).fill('0');
  await page.getByRole('button', {name: 'Tümünü kaydet', exact: true}).click();
  await expect(page.getByRole('status')).toContainText('1 sınav sonucu birlikte kaydedildi.');
  expect(sent[2].request_id).not.toBe(sent[0].request_id);
  expect(state.education!.results).toHaveLength(3);
  await page.getByRole('button', {name: `Matematik Vize ${day} sonucunu düzenle`}).first().click();
  const dialog = page.getByRole('dialog', {name: 'Ders sınavını düzenle'});
  await dialog.getByLabel('Alınan puan').fill('15');
  await dialog.getByRole('button', {name: 'Değişikliği kaydet'}).click();
  await expect(dialog).not.toBeVisible();
  expect(sent[3]).toMatchObject({type: 'result.update', payload: {expected_revision: 1, score: 15}});
});

test('local CSV preview maps columns, forces unknown course selection, and validates every row before sending', async ({page}) => {
  const state = fixture(), sent = await openResults(page, state);
  await page.getByRole('button', {name: 'Yapıştır / CSV', exact: true}).click();
  await page.getByLabel('Ders–puan tablosu', {exact: true}).fill('Puan;Ders;Ölçek;Tarih\n16;Matematik;20;27.09.2026\n0;Bilişim 1;100;2026-09-27\n87,5;İKTİSAT;100;2026-09-27');
  await page.getByRole('button', {name: 'Önizle ve eşleştir'}).click();
  await expect(page.getByRole('combobox', {name: 'Ders sütunu', exact: true})).toHaveValue('1');
  await page.getByRole('button', {name: 'Önizlemeyi kaydet'}).click();
  await expect(page.getByText('İşaretli satırları düzelt.', {exact: false})).toBeVisible();
  expect(sent).toHaveLength(0);
  await page.getByLabel('2. satır dersi', {exact: true}).selectOption(state.education!.courses[1].id);
  await page.getByRole('button', {name: 'Önizlemeyi kaydet'}).click();
  await expect(page.getByRole('status')).toContainText('3 sınav sonucu birlikte kaydedildi.');
  expect(sent[0].payload.rows!.map(row => [row.score, row.scale, row.exam_date])).toEqual([[16, 20, day], [0, 100, day], [87.5, 100, day]]);
  await page.getByRole('combobox', {name: 'Grafikteki ders', exact: true}).selectOption(state.education!.courses[3].id);
  await expect(page.getByRole('img', {name: 'İktisat için 1 sınav sonucu; puan grafiği'})).toBeVisible();
  await expect(page.getByRole('img', {name: 'Matematik için 1 sınav sonucu; puan grafiği'})).toHaveCount(0);
  await page.setViewportSize({width: 360, height: 800});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('different scales require optional normalization and different assessment types never imply a gain', async ({page}) => {
  const state = fixture(), education = state.education!;
  education.results = [
    {id: 'one', score: 16, scale: 20, assessment_type: 'Vize', exam_date: '2026-09-01'},
    {id: 'two', score: 80, scale: 100, assessment_type: 'Vize', exam_date: '2026-09-10'},
    {id: 'three', score: 90, scale: 100, assessment_type: 'Final', exam_date: '2026-09-20'},
  ].map(row => ({...row, course_id: education.courses[0].id, term_id: termId, course_name: 'Matematik', assessment_name: '', revision: 1, created_at: stamp, updated_at: stamp}));
  await openResults(page, state);
  await expect(page.getByText('Bu kayıtlarda farklı puan ölçekleri var.', {exact: false})).toBeVisible();
  await page.getByRole('combobox', {name: 'Grafik ölçeği', exact: true}).selectOption('percentage');
  await expect(page.getByText('Karşılaştırılabilir iki sonuç gerekli', {exact: true})).toBeVisible();
  await page.getByRole('combobox', {name: 'Sonuç türü', exact: true}).selectOption('Vize');
  await expect(page.getByText('yüzde puan', {exact: true})).toBeVisible();
  await expect(page.getByRole('img', {name: 'Matematik için 2 sınav sonucu; yüzde grafiği'})).toBeVisible();
  await page.getByLabel('Başlangıç tarihi', {exact: true}).fill('2026-09-02');
  await expect(page.getByText('Henüz yalnız bir sonuç var;', {exact: false})).toBeVisible();
});

test('study course filters separate assigned and unassigned records without course-specific zero marks', async ({page}) => {
  const state = fixture();
  state.sessions = [state.education!.courses[0].id, state.education!.courses[3].id, null].map((course_id, index) => ({id: `session-${index}`, course_id, subject: index === 1 ? 'İktisat' : 'Matematik', title: ['Matematik çalışması', 'İktisat çalışması', 'Eski kayıt'][index], study_type: 'Tekrar', task_id: null, topic_id: null, mode: 'stopwatch', target_seconds: null, status: 'finished', started_at: '2026-09-26T09:00:00Z', active_since: null, accumulated_seconds: (index + 1) * 60, finished_at: `2026-09-26T09:0${index + 1}:00Z`, revision: 1}));
  state.intervals = state.sessions.map(session => ({id: `${session.id}-interval`, session_id: session.id, started_at: session.started_at, ended_at: session.finished_at}));
  await openResults(page, state);
  await page.getByRole('navigation', {name: 'Ana gezinme'}).getByRole('button', {name: 'Çalışma İstatistikleri', exact: true}).click();
  const total = page.locator('.study-stats-metrics > div').nth(0).locator('strong');
  await expect(total).toHaveText('6 dk');
  await page.getByRole('combobox', {name: 'Çalışma dersi', exact: true}).selectOption(state.education!.courses[0].id);
  await expect(total).toHaveText('1 dk');
  await expect(page.getByRole('heading', {name: 'Bu seçimin çalışma kayıtları'})).toBeVisible();
  await page.getByText('Gün ayrıntıları', {exact: true}).click();
  await page.getByLabel('İncelenen gün', {exact: true}).fill('2026-09-25');
  await expect(page.getByRole('button', {name: '0 çalışma olarak doğrula', exact: true})).toHaveCount(0);
  await expect(page.locator('.study-day-detail').getByRole('button', {name: /^\d+ kayıt$/})).toHaveCount(0);
  await page.getByRole('combobox', {name: 'Çalışma dersi', exact: true}).selectOption('__unassigned__');
  await expect(total).toHaveText('3 dk');
});
