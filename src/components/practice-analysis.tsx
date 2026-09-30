'use client';

import { useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import type { AppState, PracticeEntry } from '@/lib/domain/types';
import { practicePeriod, practiceTrend, summarizePractice, type PracticePeriod } from '@/lib/practice-summary';
import { localDate, type CommandFn } from '@/lib/ui';
import { Card } from './primitives';
import { Modal } from './modal';
import { PracticeEntryForm } from './practice-entry-form';

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

      <Card className="practice-exams" eyebrow="ÇÖZÜM DAĞILIMI" title="Sınav dağılımı" action={<BarChart3 size={19} aria-hidden="true" />}>
        <div className="practice-exam-list">
          {summary.examRows.map(row => <div className="practice-exam-row" key={row.exam}>
            <div><strong>{row.exam}</strong><span>{count(row.questionCount, 'soru')} · {count(row.testCount, 'test')}</span></div>
            <PracticeShareBars context={row.exam} questions={row.questionCount} tests={row.testCount} totalQuestions={summary.totalQuestions} totalTests={summary.totalTests} />
          </div>)}
        </div>
        <p className="practice-card-note">TYT, AYT ve derssiz veya okul derslerine ait kayıtlar. Soru ve test payları ayrı gösterilir.</p>
      </Card>
    </div>

    <div className="practice-details">
      <Card className="practice-subjects" eyebrow="DERS BAZINDA" title="Hangi dersten kaç soru?" action={<span className="pill">{summary.subjectRows.length} grup</span>}>
        {summary.subjectRows.length === 0 ? <div className="practice-empty"><p>Bu dönemde derslere ait çözüm kaydı yok.</p><small>Bir kayıt eklediğinde her dersin soru ve test sayısı burada görünecek.</small></div> :
          <div className="practice-subject-list">{summary.subjectRows.map(row => <div className="practice-subject-row" key={row.key}>
            <div className="practice-subject-head"><span><small>{row.exam ?? (row.subject === 'Ders seçilmedi' ? 'Genel' : 'Okul')}</small><strong>{row.subject}</strong></span><b>{count(row.questionCount, 'soru')} <i>·</i> {count(row.testCount, 'test')}</b></div>
            <PracticeShareBars context={`${row.exam ? row.exam + ' ' : ''}${row.subject}`} questions={row.questionCount} tests={row.testCount} totalQuestions={summary.totalQuestions} totalTests={summary.totalTests} />
          </div>)}</div>}
      </Card>

      <Card className="practice-records" eyebrow="KAYIT GEÇMİŞİ" title="Çözüm kayıtların" action={<span className="pill">{summary.entryCount} kayıt</span>}>
        {summary.records.length === 0 ? <div className="practice-empty"><p>Seçili dönemde kayıt bulunmuyor.</p><small>Önceki döneme geçebilir veya yeni bir kayıt ekleyebilirsin.</small></div> :
          <div className="practice-record-list">{summary.records.map(entry => <div className="practice-row" key={entry.id}>
            <div className="practice-row-date"><strong>{shortDate.format(dateObject(entry.practice_date))}</strong><span>{entry.exam ?? (entry.subject ? 'Okul' : 'Genel')}</span></div>
            <div className="practice-row-main"><strong>{entry.subject || 'Ders seçilmedi'}</strong><span>{count(entry.question_count, 'soru')} · {count(entry.test_count, 'test')}</span></div>
            <div className="practice-row-actions"><button type="button" className="icon-button" disabled={!writable || busy} onClick={() => setEditing(entry)} aria-label={`${entry.exam ? entry.exam + ' ' : ''}${entry.subject || 'Ders seçilmedi'} kaydını düzenle`}><Pencil size={16} /></button><button type="button" className="icon-button" disabled={!writable || busy} onClick={() => setDeleting(entry)} aria-label={`${entry.exam ? entry.exam + ' ' : ''}${entry.subject || 'Ders seçilmedi'} kaydını sil`}><Trash2 size={16} /></button></div>
          </div>)}</div>}
      </Card>
    </div>

    {editing !== false && <Modal title={editing ? 'Çözüm kaydını düzenle' : 'Yeni çözüm kaydı'} onClose={() => setEditing(false)}>
      <PracticeEntryForm key={editing?.id ?? 'new'} state={state} entry={editing || null} date={defaultEntryDate} today={today} busy={busy} writable={writable} onCancel={() => setEditing(false)} onSave={async payload => {
        const action = editing ? 'practice.update' : 'practice.create';
        const data = editing ? { ...payload, id: editing.id, expected_revision: editing.revision } : payload;
        if (await command(action, data)) setEditing(false);
      }} />
    </Modal>}

    {deleting && <Modal title="Çözüm kaydını sil" onClose={() => setDeleting(null)}>
      <div className="practice-delete-confirm"><p><strong>{deleting.exam ? deleting.exam + ' · ' : ''}{deleting.subject || 'Ders seçilmedi'}</strong> için {fullDate.format(dateObject(deleting.practice_date))} tarihli {count(deleting.question_count, 'soru')} ve {count(deleting.test_count, 'test')} kaydı silinecek.</p><p>Bu işlem grafikleri ve dönem toplamlarını günceller.</p><div className="form-actions"><button type="button" className="button secondary" onClick={() => setDeleting(null)}>Vazgeç</button><button type="button" className="button practice-delete-button" disabled={busy || !writable} onClick={async () => { if (await command('practice.delete', { id: deleting.id, expected_revision: deleting.revision })) setDeleting(null); }}>Kaydı sil</button></div></div>
    </Modal>}
  </div>;
}

function PracticeShareBars({ context, questions, tests, totalQuestions, totalTests }: {
  context: string; questions: number; tests: number; totalQuestions: number; totalTests: number;
}) {
  return <div className="practice-share-bars">
    {totalQuestions > 0 && <div className="practice-share-row"><small>Soru</small><div className="practice-meter" role="img" aria-label={`${context}: ${questions} soru, soruların yüzde ${Math.round(questions / totalQuestions * 100)}'i`}><span style={{ width: `${questions / totalQuestions * 100}%` }} /></div></div>}
    {totalTests > 0 && <div className="practice-share-row practice-share-test"><small>Test</small><div className="practice-meter" role="img" aria-label={`${context}: ${tests} test, testlerin yüzde ${Math.round(tests / totalTests * 100)}'i`}><span style={{ width: `${tests / totalTests * 100}%` }} /></div></div>}
  </div>;
}
