'use client';

import { useState, type FormEvent } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import type { AppState, PracticeEntry } from '@/lib/domain/types';
import { practicePeriod, practiceTrend, summarizePractice, type PracticePeriod } from '@/lib/practice-summary';
import { localDate, type CommandFn } from '@/lib/ui';
import { Card } from './primitives';
import { Modal } from './modal';

type Props = { state: AppState; command: CommandFn; busy: boolean; preview: boolean };
const periodOptions: { id: PracticePeriod; label: string }[] = [
  { id: 'day', label: 'Günlük' },
  { id: 'week', label: 'Haftalık' },
  { id: 'month', label: 'Aylık' },
];
const numberFormat = new Intl.NumberFormat('tr-TR');
const fullDate = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekday = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', timeZone: 'UTC' });
function dateObject(day: string) { return new Date(day + 'T12:00:00.000Z'); }
function count(value: number, word: string) { return numberFormat.format(value) + ' ' + word; }
function comparisonText(delta: number, word: string) { return (delta > 0 ? '+' : delta < 0 ? '−' : '') + numberFormat.format(Math.abs(delta)) + ' ' + word; }
function comparisonClass(delta: number) { return delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : 'is-flat'; }
function trendDateLabel(start: string, end: string) { return fullDate.format(dateObject(start)) + (start === end ? '' : ' – ' + fullDate.format(dateObject(end))); }

export function PracticeAnalysis({ state, command, busy, preview }: Props) {
  const timezone = state.settings?.timezone ?? 'Europe/Istanbul';

  const today = localDate(Date.parse(state.server_now), timezone);
  const [anchor, setAnchor] = useState(today);
  const [period, setPeriod] = useState<PracticePeriod>('week');
  const [editing, setEditing] = useState<PracticeEntry | null | false>(false);
  const [deleting, setDeleting] = useState<PracticeEntry | null>(null);
  const entries = state.practice_entries ?? [];
  const summary = summarizePractice(entries, anchor, period);
  const trend = practiceTrend(entries, anchor, period);
  const range = practicePeriod(anchor, period);
  const previous = summarizePractice(entries, range.previousAnchor, period);
  const comparedWith = period === 'day' ? 'önceki güne göre' : period === 'week' ? 'önceki haftaya göre' : 'önceki aya göre';
  const maxQuestions = Math.max(1, ...trend.map(row => row.questionCount));
  const maxTests = Math.max(1, ...trend.map(row => row.testCount));
  const writable = state.authenticated && !preview;
  const defaultEntryDate = anchor > today ? today : anchor;

  return <div className="practice-analysis">
    <div className="practice-controls">
      <div className="practice-tabs" role="group" aria-label="Analiz dönemi">
        {periodOptions.map(option => <button key={option.id} type="button" aria-pressed={period === option.id} onClick={() => setPeriod(option.id)}>{option.label}</button>)}
      </div>
      <div className="practice-period">
        <button type="button" className="icon-button" onClick={() => setAnchor(range.previousAnchor)} aria-label="Önceki dönem"><ChevronLeft size={18} /></button>
        <strong aria-live="polite">{range.label}</strong>
        <button type="button" className="icon-button" onClick={() => setAnchor(range.nextAnchor)} disabled={range.nextAnchor > today} aria-label="Sonraki dönem"><ChevronRight size={18} /></button>
        <label className="practice-date-picker">Tarih seç<input type="date" value={anchor} max={today} onChange={event => { if (event.target.value) setAnchor(event.target.value); }} /></label>
      </div>
    </div>

    {preview && <p className="practice-preview-note" role="status">Örnek veriler gösteriliyor. Gerçek kayıt oluşturmak için hesap kurulumunu tamamla.</p>}

    <div className="practice-overview">
      <Card className="practice-hero" eyebrow="SORU ÇÖZÜMÜ" title="Çözüm ritmin" action={<button type="button" className="button primary small" disabled={!writable || busy} onClick={() => setEditing(null)}><Plus size={16} />Kayıt ekle</button>}>
        <div className="practice-metrics">
          <div><span>Çözülen soru</span><strong>{numberFormat.format(summary.totalQuestions)}</strong><small className={comparisonClass(summary.totalQuestions - previous.totalQuestions)}>{comparisonText(summary.totalQuestions - previous.totalQuestions, 'soru')} · {comparedWith}</small></div>
          <div><span>Bitirilen test</span><strong>{numberFormat.format(summary.totalTests)}</strong><small className={comparisonClass(summary.totalTests - previous.totalTests)}>{comparisonText(summary.totalTests - previous.totalTests, 'test')} · {comparedWith}</small></div>
          <div><span>Çalışılan gün</span><strong>{numberFormat.format(summary.activeDays)}</strong><small>Soru veya test kaydı olan</small></div>
        </div>
        <div className="practice-trend-heading"><h3>{period === 'month' ? 'Ayın haftaları' : period === 'week' ? 'Haftanın günleri' : 'Son 7 gün'}</h3><div className="practice-trend-legend"><span className="practice-legend-question">Soru</span><span className="practice-legend-test">Test</span></div></div>
        <ol className={'practice-trend ' + (period === 'month' ? 'practice-trend-month' : '')} aria-label={period === 'month' ? 'Haftalara göre çözülen soru ve test sayısı' : 'Günlere göre çözülen soru ve test sayısı'}>
          {trend.map(row => <li key={row.date} className={'practice-trend-day ' + (row.date <= anchor && anchor <= row.end ? 'is-selected' : '')} aria-label={`${trendDateLabel(row.date, row.end)}: ${count(row.questionCount, 'soru')}, ${count(row.testCount, 'test')}`}>
            <span className="practice-trend-value">{row.questionCount > 0 ? numberFormat.format(row.questionCount) : '–'}</span>
            <div className="practice-trend-bars" aria-hidden="true"><span className="practice-trend-questions" style={{ height: `${row.questionCount / maxQuestions * 100}%` }} /><span className="practice-trend-tests" style={{ height: `${row.testCount / maxTests * 100}%` }} /></div>
            <span className="practice-trend-label">{period === 'month' ? row.label : weekday.format(dateObject(row.date))}</span>
          </li>)}
        </ol>
        <p className="practice-chart-note">{summary.entryCount === 0 ? 'Bu dönemde kayıt yok. İlk kaydınla grafik dolacak.' : 'Soru ve test sütunları kendi ölçekleriyle gösterilir; kesin sayılar aşağıda yer alır.'} Kayıt olmayan günler çalışmadığın anlamına gelmez.</p>
      </Card>

      <Card className="practice-exams" eyebrow="TYT + AYT" title="Sınav dağılımı" action={<BarChart3 size={19} aria-hidden="true" />}>
        <div className="practice-exam-list">
          {summary.examRows.map(row => <div className="practice-exam-row" key={row.exam}>
            <div><strong>{row.exam}</strong><span>{count(row.questionCount, 'soru')} · {count(row.testCount, 'test')}</span></div>
            <div className="practice-meter" role="img" aria-label={`${row.exam}: toplam soruların yüzde ${summary.totalQuestions ? Math.round(row.questionCount / summary.totalQuestions * 100) : 0}'i`}><span style={{ width: `${summary.totalQuestions ? row.questionCount / summary.totalQuestions * 100 : 0}%` }} /></div>
          </div>)}
        </div>
        <p className="practice-card-note">Dönem içindeki tüm TYT ve AYT soru kayıtları.</p>
      </Card>
    </div>

    <div className="practice-details">
      <Card className="practice-subjects" eyebrow="DERS BAZINDA" title="Hangi dersten kaç soru?" action={<span className="pill">{summary.subjectRows.length} ders</span>}>
        {summary.subjectRows.length === 0 ? <div className="practice-empty"><p>Bu dönemde derslere ait çözüm kaydı yok.</p><small>Bir kayıt eklediğinde her dersin soru ve test sayısı burada görünecek.</small></div> :
          <div className="practice-subject-list">{summary.subjectRows.map(row => <div className="practice-subject-row" key={row.exam + ':' + row.subject}>
            <div className="practice-subject-head"><span><small>{row.exam}</small><strong>{row.subject}</strong></span><b>{count(row.questionCount, 'soru')} <i>·</i> {count(row.testCount, 'test')}</b></div>
            <div className="practice-meter" role="img" aria-label={`${row.exam} ${row.subject}: ${count(row.questionCount, 'soru')}, ${count(row.testCount, 'test')}`}><span style={{ width: `${summary.totalQuestions ? row.questionCount / summary.totalQuestions * 100 : 0}%` }} /></div>
          </div>)}</div>}
      </Card>

      <Card className="practice-records" eyebrow="KAYIT GEÇMİŞİ" title="Çözüm kayıtların" action={<span className="pill">{summary.entryCount} kayıt</span>}>
        {summary.records.length === 0 ? <div className="practice-empty"><p>Seçili dönemde kayıt bulunmuyor.</p><small>Önceki döneme geçebilir veya yeni bir kayıt ekleyebilirsin.</small></div> :
          <div className="practice-record-list">{summary.records.map(entry => <div className="practice-row" key={entry.id}>
            <div className="practice-row-date"><strong>{shortDate.format(dateObject(entry.practice_date))}</strong><span>{entry.exam}</span></div>
            <div className="practice-row-main"><strong>{entry.subject}</strong><span>{count(entry.question_count, 'soru')} · {count(entry.test_count, 'test')}</span></div>
            <div className="practice-row-actions"><button type="button" className="icon-button" disabled={!writable || busy} onClick={() => setEditing(entry)} aria-label={`${entry.exam} ${entry.subject} kaydını düzenle`}><Pencil size={16} /></button><button type="button" className="icon-button" disabled={!writable || busy} onClick={() => setDeleting(entry)} aria-label={`${entry.exam} ${entry.subject} kaydını sil`}><Trash2 size={16} /></button></div>
          </div>)}</div>}
      </Card>
    </div>

    {editing !== false && <Modal title={editing ? 'Çözüm kaydını düzenle' : 'Yeni çözüm kaydı'} onClose={() => setEditing(false)}>
      <PracticeForm key={editing?.id ?? 'new'} entry={editing || null} date={defaultEntryDate} today={today} busy={busy} writable={writable} subjects={[...new Set([...state.topics.map(topic => topic.subject), ...entries.map(entry => entry.subject)])]} onCancel={() => setEditing(false)} onSave={async payload => {
        const action = editing ? 'practice.update' : 'practice.create';
        const data = editing ? { ...payload, id: editing.id, expected_revision: editing.revision } : payload;
        if (await command(action, data)) setEditing(false);
      }} />
    </Modal>}

    {deleting && <Modal title="Çözüm kaydını sil" onClose={() => setDeleting(null)}>
      <div className="practice-delete-confirm"><p><strong>{deleting.exam} {deleting.subject}</strong> için {fullDate.format(dateObject(deleting.practice_date))} tarihli {count(deleting.question_count, 'soru')} ve {count(deleting.test_count, 'test')} kaydı silinecek.</p><p>Bu işlem grafikleri ve dönem toplamlarını günceller.</p><div className="form-actions"><button type="button" className="button secondary" onClick={() => setDeleting(null)}>Vazgeç</button><button type="button" className="button practice-delete-button" disabled={busy || !writable} onClick={async () => { if (await command('practice.delete', { id: deleting.id, expected_revision: deleting.revision })) setDeleting(null); }}>Kaydı sil</button></div></div>
    </Modal>}
  </div>;
}

function PracticeForm({ entry, date, today, busy, writable, subjects, onCancel, onSave }: {
  entry: PracticeEntry | null; date: string; today: string; busy: boolean; writable: boolean; subjects: string[];
  onCancel: () => void; onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const subject = String(form.get('subject') ?? '').trim();
    const questions = Number(form.get('question_count'));
    const tests = Number(form.get('test_count'));
    if (!subject) { setError('Ders adını gir.'); return; }
    if (questions === 0 && tests === 0) { setError('En az bir soru veya test sayısı gir.'); return; }
    setError('');
    await onSave({ practice_date: form.get('practice_date'), exam: form.get('exam'), subject, question_count: questions, test_count: tests });
  };
  return <form className="form-grid practice-form" onSubmit={submit}>
    <label>Tarih<input type="date" name="practice_date" required max={today} defaultValue={entry?.practice_date ?? date} /></label>
    <label>Sınav<select name="exam" defaultValue={entry?.exam ?? 'TYT'}><option value="TYT">TYT</option><option value="AYT">AYT</option></select></label>
    <label className="span-2">Ders<input name="subject" list="practice-subject-options" required maxLength={120} defaultValue={entry?.subject ?? ''} placeholder="Örn. Matematik" autoComplete="off" /><datalist id="practice-subject-options">{subjects.filter(Boolean).map(subject => <option key={subject} value={subject} />)}</datalist></label>
    <label>Çözülen soru<input type="number" name="question_count" min="0" max="100000" step="1" required defaultValue={entry?.question_count ?? 0} /></label>
    <label>Bitirilen test<input type="number" name="test_count" min="0" max="10000" step="1" required defaultValue={entry?.test_count ?? 0} /></label>
    <p className="footnote span-2">Soru ve test sayılarını ayrı ayrı yaz. Bu kayıt çalışma sürene eklenmez.</p>
    {error && <p className="error-text span-2" role="alert">{error}</p>}
    <div className="form-actions span-2"><button type="button" className="button secondary" onClick={onCancel}>Vazgeç</button><button type="submit" className="button primary" disabled={busy || !writable}>{busy ? 'Kaydediliyor…' : 'Kaydet'}</button></div>
  </form>;
}
