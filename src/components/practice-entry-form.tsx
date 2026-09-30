'use client';

import { useState, type FormEvent } from 'react';
import type { AppState, PracticeEntry } from '@/lib/domain/types';
import { CourseSelector } from './course-selector';

export function PracticeEntryForm({ state, entry, date, today, busy, writable, onCancel, onSave }: {
  state: AppState;
  entry: PracticeEntry | null;
  date: string;
  today: string;
  busy: boolean;
  writable: boolean;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [courseId, setCourseId] = useState(entry?.course_id ?? '');
  const [courseTouched, setCourseTouched] = useState(false);
  const [error, setError] = useState('');
  const legacy = Boolean(entry?.exam && entry.subject && !entry.course_id);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const questions = Number(form.get('question_count') || 0);
    const tests = Number(form.get('test_count') || 0);
    if (questions === 0 && tests === 0) {
      setError('En az bir soru veya test sayısı gir.');
      return;
    }
    setError('');
    const payload: Record<string, unknown> = {
      practice_date: form.get('practice_date'), question_count: questions, test_count: tests,
    };
    if (legacy && !courseTouched) {
      payload.exam = entry!.exam;
      payload.subject = entry!.subject;
    } else {
      payload.course_id = courseId || null;
    }
    await onSave(payload);
  };

  return <form className="form-grid practice-form" onSubmit={submit}>
    <label className="span-2">Tarih<input type="date" name="practice_date" required max={today} defaultValue={entry?.practice_date ?? date} /></label>
    <div className="span-2"><CourseSelector state={state} value={courseId} onChange={id => { setCourseId(id); setCourseTouched(true); }} label="Ders (isteğe bağlı)" disabled={busy} initialFocus /></div>
    {legacy && !courseTouched && <p className="practice-legacy-note span-2">Eski kayıt: {entry!.exam} · {entry!.subject}. Ders seçmezsen bu bilgi korunur.</p>}
    <label>Çözülen soru<input type="number" name="question_count" min="0" max="100000" step="1" inputMode="numeric" defaultValue={entry?.question_count || ''} placeholder="0" /></label>
    <label>Bitirilen test<input type="number" name="test_count" min="0" max="10000" step="1" inputMode="numeric" defaultValue={entry?.test_count || ''} placeholder="0" /></label>
    <p className="footnote span-2">Ders seçmek isteğe bağlı. Soru, test veya ikisini birlikte girebilirsin. Bu kayıt çalışma sürene eklenmez.</p>
    {error && <p className="error-text span-2" role="alert">{error}</p>}
    <div className="form-actions span-2"><button type="button" className="button secondary" onClick={onCancel}>Vazgeç</button><button type="submit" className="button primary" disabled={busy || !writable}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</button></div>
  </form>;
}
