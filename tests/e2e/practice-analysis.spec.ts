import { expect, test } from '@playwright/test';
import { emptyState, type AppState } from '../../src/lib/domain/types';
import { defaultModules, emptyEducation } from '../../src/lib/education';

// Browser contract only: both API routes are intercepted, so no real account or DB is touched.
test('authenticated practice form creates, edits, and deletes a record with revised totals', async ({ page }) => {
  const stamp = '2026-09-24T09:00:00.000Z';
  const day = '2026-09-24';
  const mathematicsId = '10000000-0000-4000-8000-000000000101';
  const biologyId = '10000000-0000-4000-8000-000000000102';
  const education = emptyEducation();
  education.can_commit = true;
  education.profile = { education_level: 'graduate', yks_goal: true, grade: null, department: '', university_year: '', yks_track: 'undecided', modules: { ...defaultModules }, active_term_id: null, onboarding_completed_at: stamp, revision: 1 };
  education.courses = [
    { id: mathematicsId, term_id: null, name: 'Matematik', normalized_name: 'matematik', context: 'yks', exam: 'TYT', archived: false, revision: 1, created_at: stamp, updated_at: stamp },
    { id: biologyId, term_id: null, name: 'Biyoloji', normalized_name: 'biyoloji', context: 'yks', exam: 'AYT', archived: false, revision: 1, created_at: stamp, updated_at: stamp },
  ];
  const state: AppState = { ...emptyState(true), authenticated: true, server_now: stamp, education };
  const sent: { type: string; payload: Record<string, unknown> }[] = [];
  await page.clock.setFixedTime(new Date(stamp));
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/command', async route => {
    const request = route.request().postDataJSON() as { type: string; payload: Record<string, unknown> };
    sent.push(request);
    if (request.type === 'practice.create') {
      state.practice_entries = [{ id: 'mock-practice-1', practice_date: String(request.payload.practice_date), course_id: mathematicsId, exam: 'TYT', subject: 'Matematik', question_count: Number(request.payload.question_count), test_count: Number(request.payload.test_count), revision: 1, created_at: stamp, updated_at: stamp } as AppState['practice_entries'][number]];
    } else if (request.type === 'practice.update') {
      const current = state.practice_entries[0];
      state.practice_entries = [{ ...current, practice_date: String(request.payload.practice_date), course_id: biologyId, exam: 'AYT', subject: 'Biyoloji', question_count: Number(request.payload.question_count), test_count: Number(request.payload.test_count), revision: 2, updated_at: stamp }];
    } else if (request.type === 'practice.delete') {
      state.practice_entries = [];
    } else {
      await route.abort();
      throw new Error('Unexpected command: ' + request.type);
    }
    await route.fulfill({ json: { ok: true, state } });
  });

  await page.goto('/');
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('button', { name: 'Çalışma İstatistikleri', exact: true }).click();
  await page.getByRole('group', { name: 'İstatistik görünümü' }).getByRole('button', { name: 'Soru ve test', exact: true }).click();
  const metrics = page.locator('.practice-metrics > div');
  await expect(metrics.nth(0).locator('strong')).toHaveText('0');
  await expect(metrics.nth(1).locator('strong')).toHaveText('0');

  await page.getByRole('button', { name: 'Kayıt ekle', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Yeni çözüm kaydı' });
  await expect(dialog.getByLabel('Tarih')).toHaveValue(day);
  await dialog.getByRole('button', { name: /Ders seç/ }).click();
  await dialog.getByRole('button', { name: 'Matematik', exact: true }).click();
  await dialog.getByLabel('Çözülen soru').fill('45');
  await dialog.getByLabel('Bitirilen test').fill('3');
  await dialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ type: 'practice.create', payload: { practice_date: day, course_id: mathematicsId, question_count: 45, test_count: 3 } });
  await expect(metrics.nth(0).locator('strong')).toHaveText('45');
  await expect(metrics.nth(1).locator('strong')).toHaveText('3');
  await expect(page.locator('.practice-subject-row')).toContainText('Matematik');

  await page.getByRole('button', { name: 'TYT Matematik kaydını düzenle' }).click();
  dialog = page.getByRole('dialog', { name: 'Çözüm kaydını düzenle' });
  await dialog.getByRole('button', { name: /Ders.*Matematik/ }).click();
  await dialog.getByRole('button', { name: 'Biyoloji', exact: true }).click();
  await dialog.getByLabel('Çözülen soru').fill('60');
  await dialog.getByLabel('Bitirilen test').fill('4');
  await dialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(sent).toHaveLength(2);
  expect(sent[1]).toMatchObject({ type: 'practice.update', payload: { id: 'mock-practice-1', expected_revision: 1, practice_date: day, course_id: biologyId, question_count: 60, test_count: 4 } });
  await expect(metrics.nth(0).locator('strong')).toHaveText('60');
  await expect(metrics.nth(1).locator('strong')).toHaveText('4');
  await expect(page.locator('.practice-subject-row')).toContainText('Biyoloji');

  await page.getByRole('button', { name: 'AYT Biyoloji kaydını sil' }).click();
  dialog = page.getByRole('dialog', { name: 'Çözüm kaydını sil' });
  await expect(dialog).toContainText('60 soru');
  await dialog.getByRole('button', { name: 'Kaydı sil', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(sent).toHaveLength(3);
  expect(sent[2]).toMatchObject({ type: 'practice.delete', payload: { id: 'mock-practice-1', expected_revision: 2 } });
  expect(Object.keys(sent[2].payload).sort()).toEqual(['expected_revision', 'id']);
  await expect(metrics.nth(0).locator('strong')).toHaveText('0');
  await expect(metrics.nth(1).locator('strong')).toHaveText('0');
  await expect(page.locator('.practice-record-list .practice-row')).toHaveCount(0);
});
