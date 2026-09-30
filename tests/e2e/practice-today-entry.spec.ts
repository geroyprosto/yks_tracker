import { expect, test, type Page } from '@playwright/test';
import { emptyState, type AppState, type PracticeEntry } from '../../src/lib/domain/types';
import { defaultModules, emptyEducation } from '../../src/lib/education';

const stamp = '2026-09-24T09:00:00.000Z';
const today = '2026-09-24';
const termId = '10000000-0000-4000-8000-000000000201';
const tytId = '10000000-0000-4000-8000-000000000202';
const aytId = '10000000-0000-4000-8000-000000000203';
const schoolId = '10000000-0000-4000-8000-000000000204';

function fixture(): AppState {
  const education = emptyEducation();
  education.can_commit = true;
  education.profile = { education_level: 'high_school', yks_goal: true, grade: 12, department: '', university_year: '', yks_track: 'undecided', modules: { ...defaultModules }, active_term_id: termId, onboarding_completed_at: stamp, revision: 1 };
  education.terms = [{ id: termId, academic_year: '2026–2027', name: 'Güz', starts_on: null, ends_on: null, archived: false, revision: 1, created_at: stamp }];
  education.courses = [
    { id: tytId, term_id: null, name: 'Matematik', normalized_name: 'matematik', context: 'yks', exam: 'TYT', archived: false, revision: 1, created_at: stamp, updated_at: stamp },
    { id: aytId, term_id: null, name: 'Matematik', normalized_name: 'matematik', context: 'yks', exam: 'AYT', archived: false, revision: 1, created_at: stamp, updated_at: stamp },
    { id: schoolId, term_id: termId, name: 'Matematik', normalized_name: 'matematik', context: 'school', exam: null, archived: false, revision: 1, created_at: stamp, updated_at: stamp },
  ];
  return { ...emptyState(true), authenticated: true, server_now: stamp, education };
}

async function openToday(page: Page, state: AppState, sent: { type: string; payload: Record<string, unknown> }[]) {
  await page.clock.setFixedTime(new Date(stamp));
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/calendar/today', route => route.fulfill({ json: { connected: false, date: today, timezone: 'Europe/Istanbul', events: [], refreshedAt: null } }));
  await page.route('**/api/command', async route => {
    const request = route.request().postDataJSON() as { type: string; payload: Record<string, unknown> };
    sent.push(request);
    if (request.type !== 'practice.create') throw new Error('Unexpected command: ' + request.type);
    const course = state.education?.courses.find(item => item.id === request.payload.course_id);
    state.practice_entries.push({
      id: `mock-practice-${sent.length}`,
      practice_date: String(request.payload.practice_date),
      course_id: course?.id ?? null,
      exam: course?.exam ?? null,
      subject: course?.name ?? '',
      question_count: Number(request.payload.question_count),
      test_count: Number(request.payload.test_count),
      revision: 1,
      created_at: stamp,
      updated_at: stamp,
    } as PracticeEntry);
    await route.fulfill({ json: { ok: true, state } });
  });
  await page.goto('/');
}

test('Today card accepts questions only, tests only, or both without a lesson', async ({ page }) => {
  const state = fixture();
  const sent: { type: string; payload: Record<string, unknown> }[] = [];
  await openToday(page, state, sent);
  const card = page.locator('.today-practice-card');
  await expect(card.getByRole('heading', { name: 'Soru ve testlerin' })).toBeVisible();
  await card.getByRole('button', { name: 'Kayıt ekle', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Yeni çözüm kaydı' });
  await dialog.getByRole('button', { name: /Ders seç/ }).click();
  await expect(dialog.getByRole('button', { name: 'Ders seçmeden devam et' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Ders seçmeden devam et' }).click();

  await dialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(/soru.*test/i);
  expect(sent).toHaveLength(0);

  await dialog.getByLabel('Çözülen soru').fill('24');
  await dialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(sent[0]).toMatchObject({ type: 'practice.create', payload: { practice_date: today, question_count: 24, test_count: 0 } });
  expect(sent[0].payload.course_id ?? null).toBeNull();
  await expect(card.locator('.practice-overview-totals')).toHaveAttribute('aria-label', 'Bugün 24 soru ve 0 test');

  await card.getByRole('button', { name: 'Kayıt ekle', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Yeni çözüm kaydı' });
  await dialog.getByLabel('Bitirilen test').fill('2');
  await dialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(sent[1]).toMatchObject({ type: 'practice.create', payload: { question_count: 0, test_count: 2 } });
  expect(sent[1].payload.course_id ?? null).toBeNull();
  await expect(card.locator('.practice-overview-totals')).toHaveAttribute('aria-label', 'Bugün 24 soru ve 2 test');

  await card.getByRole('button', { name: 'Kayıt ekle', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Yeni çözüm kaydı' });
  await dialog.getByLabel('Çözülen soru').fill('6');
  await dialog.getByLabel('Bitirilen test').fill('1');
  await dialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(sent[2]).toMatchObject({ type: 'practice.create', payload: { question_count: 6, test_count: 1 } });
  expect(sent[2].payload.course_id ?? null).toBeNull();
  await expect(card.locator('.practice-overview-totals')).toHaveAttribute('aria-label', 'Bugün 30 soru ve 3 test');
});

test('a test-only record has visible test share bars and counts as an unassigned group', async ({ page }) => {
  const state = fixture();
  const sent: { type: string; payload: Record<string, unknown> }[] = [];
  await openToday(page, state, sent);
  const card = page.locator('.today-practice-card');
  await card.getByRole('button', { name: 'Kayıt ekle', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Yeni çözüm kaydı' });
  await dialog.getByLabel('Bitirilen test').fill('2');
  await dialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(sent[0]).toMatchObject({ type: 'practice.create', payload: { question_count: 0, test_count: 2 } });

  const todayTestBar = card.getByRole('img', { name: /test/i });
  await expect(todayTestBar).toBeVisible();
  expect(await todayTestBar.evaluate(element => [...element.querySelectorAll('span')].some(fill => fill.getBoundingClientRect().width > 0))).toBe(true);

  await card.getByRole('button', { name: 'Gün · hafta · ay analizi' }).click();
  const subjectCard = page.locator('.practice-subjects');
  await expect(subjectCard.locator('.pill')).toContainText('grup');
  await expect(subjectCard.locator('.pill')).not.toContainText('1 ders');
  const analysisTestBar = subjectCard.getByRole('img', { name: /test/i });
  await expect(analysisTestBar).toBeVisible();
  expect(await analysisTestBar.evaluate(element => [...element.querySelectorAll('span')].some(fill => fill.getBoundingClientRect().width > 0))).toBe(true);
});

test('TYT, AYT and school lessons with the same name stay distinct in practice analysis', async ({ page }) => {
  const state = fixture();
  const sent: { type: string; payload: Record<string, unknown> }[] = [];
  await openToday(page, state, sent);
  const card = page.locator('.today-practice-card');
  for (const [group, courseId, questions] of [
    ['TYT', tytId, '11'],
    ['AYT', aytId, '12'],
    ['Okul / Üniversite', schoolId, '13'],
  ]) {
    await card.getByRole('button', { name: 'Kayıt ekle', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Yeni çözüm kaydı' });
    await dialog.getByRole('button', { name: /Ders seç/ }).click();
    await dialog.getByRole('region', { name: group }).getByRole('button', { name: 'Matematik', exact: true }).click();
    await dialog.getByLabel('Çözülen soru').fill(questions);
    await dialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(sent.at(-1)).toMatchObject({ type: 'practice.create', payload: { course_id: courseId, question_count: Number(questions), test_count: 0 } });
  }
  await expect(card.locator('.practice-overview-totals')).toHaveAttribute('aria-label', 'Bugün 36 soru ve 0 test');
  await card.getByRole('button', { name: 'Gün · hafta · ay analizi' }).click();
  await expect(page.locator('.practice-subject-row')).toHaveCount(3);
  await expect(page.locator('.practice-subject-row')).toContainText(['Matematik', 'Matematik', 'Matematik']);
});
