'use client';

import {useMemo, useState} from 'react';
import {ArrowUpRight, CalendarDays, ChartNoAxesCombined, ChevronDown, PenLine, Plus, Trash2} from 'lucide-react';
import type {AppState, ExamFormat, ExamRecord} from '@/lib/domain/types';
import {examRange, examSeries, type ExamGrouping, type ExamPeriod} from '@/lib/exam-analysis';
import {formatDay, localDate, type CommandFn} from '@/lib/ui';
import {Card, Empty} from './primitives';
import {Modal} from './modal';
import {MonthlyExamChart} from './monthly-exam-chart';
import {ExamPlot} from './exam-plot';
import styles from './exams-analysis.module.css';

const tr = (value: number) => new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 2}).format(value);
const codes = [['TYT', 'TYT genel'], ['AYT_SAYISAL', 'AYT sayısal'], ['BRANCH', 'Branş denemesi']] as const;

export function Exams({state, command, busy, preview = false, initialDate}: {
  state: AppState; command: CommandFn; busy: boolean; preview?: boolean; initialDate?: string;
}) {
  const exams = state.exams;
  const formats = state.exam_formats;
  const [analysisView, setAnalysisView] = useState<'monthly' | 'details'>(initialDate ? 'details' : 'monthly');
  const [editing, setEditing] = useState<ExamRecord | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<ExamRecord | null>(null);
  const [format, setFormat] = useState<'TYT' | 'AYT_SAYISAL' | 'BRANCH'>('TYT');
  const [period, setPeriod] = useState<ExamPeriod>(initialDate ? 'custom' : 'two-months');
  const [customStart, setCustomStart] = useState(initialDate ?? localDate());
  const [customEnd, setCustomEnd] = useState(initialDate ?? localDate());
  const [grouping, setGrouping] = useState<ExamGrouping>('exam');
  const {start, end} = examRange(period, localDate(), customStart, customEnd);
  const filtered = exams.filter(item => item.format_code === format && item.exam_date >= start && item.exam_date <= end);
  const points = useMemo(() => examSeries(exams, {
    format, publisher: '', section: 'total', measure: 'net', grouping, start, end,
  }), [exams, format, grouping, start, end]);
  const valid = points.filter(point => point.value !== null);
  const latest = valid.at(-1);
  const previous = valid.at(-2);

  return <div className="exam-page">
    <div className="exam-intro">
      <div>
        <p className="eyebrow">{preview ? 'ÖRNEK ÖNİZLEME' : 'DENEME TAKİBİ'}</p>
        <h2>Deneme sonuçların</h2>
        <p>Toplam netini kaydet, gelişimini zaman içinde gör.</p>
      </div>
      <button className="button primary" disabled={!state.authenticated} onClick={() => setEditing(null)}><Plus size={17}/>Deneme ekle</button>
    </div>
    {preview && <p className="practice-preview-note">Bu denemeler yalnız grafik önizlemesidir; gerçek sonuçlar değildir ve kaydedilmez.</p>}
    <div className="exam-overview">
      <div className={styles.analysis}>
        <div className={styles.tabs} role="tablist" aria-label="Deneme analizi görünümü" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? 'monthly' : event.key === 'End' ? 'details' : analysisView === 'monthly' ? 'details' : 'monthly';
          setAnalysisView(next);
          event.currentTarget.querySelector<HTMLButtonElement>('[aria-controls="exam-' + next + '-panel"]')?.focus();
        }}>
          <button type="button" role="tab" id="exam-monthly-tab" aria-controls="exam-monthly-panel" aria-selected={analysisView === 'monthly'} tabIndex={analysisView === 'monthly' ? 0 : -1} onClick={() => setAnalysisView('monthly')}>Aylık görünüm</button>
          <button type="button" role="tab" id="exam-details-tab" aria-controls="exam-details-panel" aria-selected={analysisView === 'details'} tabIndex={analysisView === 'details' ? 0 : -1} onClick={() => setAnalysisView('details')}>Ayrıntılı analiz</button>
        </div>
        <div className={styles.panel} role="tabpanel" id="exam-monthly-panel" aria-labelledby="exam-monthly-tab" hidden={analysisView !== 'monthly'}>
          <MonthlyExamChart exams={exams} preview={preview} onOpen={() => setAnalysisView('details')}/>
        </div>
        <div className={styles.panel} role="tabpanel" id="exam-details-panel" aria-labelledby="exam-details-tab" hidden={analysisView !== 'details'}>
          <Card className="ambient-card exam-chart-card" title="Net gelişimi" eyebrow="DENEME ANALİZİ" action={<ChartNoAxesCombined size={18}/> }>
            <div className="exam-filters">
              <label>Tür<select value={format} onChange={event => setFormat(event.target.value as typeof format)}>{codes.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
              <label>Dönem<select value={period} onChange={event => setPeriod(event.target.value as ExamPeriod)}><option value="week">Bu hafta</option><option value="month">Bu ay</option><option value="two-months">Son iki ay</option><option value="all">Tüm geçmiş</option><option value="custom">Özel aralık</option></select></label>
              <label>Gösterim<select value={grouping} onChange={event => setGrouping(event.target.value as ExamGrouping)}><option value="exam">Tek denemeler</option><option value="week">Haftalık ortalama</option><option value="month">Aylık ortalama</option></select></label>
            </div>
            {period === 'custom' && <div className="exam-dates"><label>Başlangıç<input type="date" value={customStart} onChange={event => setCustomStart(event.target.value)}/></label><label>Bitiş<input type="date" value={customEnd} onChange={event => setCustomEnd(event.target.value)}/></label></div>}
            <div className="exam-chart-summary"><div><span>Son net</span><strong>{latest?.value === null || latest?.value === undefined ? '—' : tr(latest.value)}</strong></div><div><span>Önceki sonuca göre</span><strong>{latest?.value === null || latest?.value === undefined || previous?.value === null || previous?.value === undefined ? '—' : (latest.value - previous.value >= 0 ? '+' : '') + tr(latest.value - previous.value)}</strong></div><div><span>Deneme sayısı</span><strong>{filtered.length}</strong></div></div>
            {valid.length ? <><ExamPlot key={[format, grouping, start, end].join('|')} points={points} measure="net" exams={filtered} grouping={grouping} sectionLabel="Toplam net"/><p className="exam-chart-note">{grouping === 'exam' ? 'Her nokta bir denemeyi gösterir.' : 'Boş dönemler sıfır olarak çizilmez.'} Ayrıntı için bir noktaya gel veya dokun.</p><div className="exam-point-table"><span>Dönem / tarih</span><span>Net</span><span>Deneme</span>{points.map(point => <div className="exam-point-row" key={point.key}><span>{point.label}</span><strong>{point.value === null ? '—' : tr(point.value)}</strong><span>{point.count || '—'}</span></div>)}</div></> : <Empty icon={<ChartNoAxesCombined/>} title="Bu seçimde sonuç yok" text="İlk denemeni eklediğinde net grafiğin burada oluşacak."/>}
            <p className="footnote">Farklı zorluktaki denemeler arasında net farkı tek başına kesin gelişim göstermez.</p>
          </Card>
        </div>
      </div>
      <Card className="ambient-card exam-list-card" title="Deneme kayıtların" eyebrow="SONUÇ ARŞİVİ" action={<span className="pill">{exams.length} kayıt</span>}>
        {exams.length === 0 ? <Empty icon={<ChartNoAxesCombined/>} title="Henüz deneme kaydı yok" text="Türü ve toplam netini girerek ilk denemeni kaydet."/> : <div className="exam-records">{[...exams].sort((a, b) => b.exam_date.localeCompare(a.exam_date) || b.created_at.localeCompare(a.created_at)).map(exam => <article className="exam-record" key={exam.id}><div className="exam-record-main"><span className="exam-record-date">{formatDay(exam.exam_date, {day: 'numeric', month: 'short', year: 'numeric'})}</span><strong>{exam.name}</strong><small>{exam.format_snapshot.label}</small></div><div className="exam-record-score"><strong>{exam.total_net === null ? '—' : tr(exam.total_net)}</strong><span>toplam net</span></div><div className="exam-record-actions"><button className="icon-button" aria-label={exam.name + ' düzenle'} onClick={() => setEditing(exam)} disabled={busy || preview}><PenLine size={16}/></button><button className="icon-button" aria-label={exam.name + ' sil'} onClick={() => setDeleting(exam)} disabled={busy || preview}><Trash2 size={16}/></button></div></article>)}</div>}
      </Card>
    </div>
    {editing !== undefined && <ExamEditor key={editing?.id ?? 'new'} record={editing} formats={formats} examCount={preview ? 0 : exams.length} busy={busy} onClose={() => setEditing(undefined)} onSave={async (type, payload) => {if (await command(type, payload)) setEditing(undefined);}}/>}
    {deleting && <Modal title="Denemeyi sil" onClose={() => setDeleting(null)}><div className="exam-delete-dialog"><p><strong>{deleting.name}</strong> kaydı ve grafiklerdeki sonucu silinecek.</p><div className="form-actions"><button className="button secondary" onClick={() => setDeleting(null)}>Vazgeç</button><button className="button primary" disabled={busy} onClick={async () => {if (await command('exam.delete', {id: deleting.id, expected_revision: deleting.revision})) setDeleting(null);}}>Kaydı sil</button></div></div></Modal>}
  </div>;
}

function ExamEditor({record, formats, examCount, busy, onClose, onSave}: {
  record: ExamRecord | null; formats: ExamFormat[]; examCount: number; busy: boolean;
  onClose: () => void; onSave: (type: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  const [formatCode, setFormatCode] = useState<'TYT' | 'AYT_SAYISAL' | 'BRANCH'>(record?.format_code ?? 'TYT');
  const [branchSubject, setBranchSubject] = useState(record?.format_code === 'BRANCH' ? record.format_snapshot.sections[0]?.label ?? '' : '');
  const [branchCount, setBranchCount] = useState(record?.format_code === 'BRANCH' ? String(record.format_snapshot.total_questions) : '40');
  const [examDate, setExamDate] = useState(record?.exam_date ?? localDate());
  const [error, setError] = useState('');
  const format = record?.format_snapshot ?? formats.find(item => item.code === formatCode);
  const totalQuestions = formatCode === 'BRANCH' && !record ? Number(branchCount) || 0 : format?.total_questions ?? 0;
  const minNet = totalQuestions && format ? -totalQuestions / format.wrong_divisor : undefined;
  const suggestedName = record?.name ?? String(examCount + 1) + '. deneme';
  const hasCompleteLegacyResults = Boolean(record && record.results.length > 0 && record.results.length === record.format_snapshot.sections.length);

  return <Modal title={record ? 'Denemeyi düzenle' : 'Yeni deneme ekle'} onClose={onClose}>
    <form className="exam-editor" onSubmit={async event => {
      event.preventDefault();
      setError('');
      if (!examDate) {
        setError('Deneme tarihini seç.');
        return;
      }
      const form = new FormData(event.currentTarget);
      const netText = String(form.get('reported_total_net') ?? '').trim();
      const net = netText ? Number(netText.replace(',', '.')) : null;
      if ((!netText && record?.total_net !== null) || (net !== null && (!Number.isFinite(net) || net < (minNet ?? 0) || net > totalQuestions))) {
        setError('Toplam neti kontrol et.');
        return;
      }
      const name = String(form.get('name') ?? '').trim() || suggestedName;
      const payload: Record<string, unknown> = {
        name,
        exam_date: examDate,
        notes: String(form.get('notes') ?? '').trim(),
      };
      if (record) {
        payload.id = record.id;
        payload.expected_revision = record.revision;
        if (net !== null && net !== record.total_net) payload.reported_total_net = net;
        await onSave('exam.update', payload);
      } else {
        payload.format_code = formatCode;
        payload.format_version = format?.version ?? 1;
        payload.reported_total_net = net;
        payload.results = [];
        if (formatCode === 'BRANCH') {
          payload.branch_subject = branchSubject.trim();
          payload.branch_question_count = Number(branchCount);
        }
        await onSave('exam.create', payload);
      }
    }}>
      <div className="exam-editor-top">
        <label>Tür<select value={formatCode} disabled={Boolean(record)} onChange={event => setFormatCode(event.target.value as typeof formatCode)}>{codes.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
        <details className="exam-editor-date"><summary><CalendarDays size={15}/><span>{examDate ? formatDay(examDate, {day: 'numeric', month: 'short', year: 'numeric'}) : 'Tarih seç'}</span><ChevronDown size={14}/></summary><label>Tarih<input name="exam_date" type="date" value={examDate} onChange={event => setExamDate(event.target.value)}/></label></details>
      </div>
      <label className="exam-editor-name">Deneme adı <span>İsteğe bağlı</span><input name="name" maxLength={240} defaultValue={record?.name ?? ''} placeholder={'Boşsa ' + suggestedName}/></label>
      {formatCode === 'BRANCH' && <div className="exam-editor-branch"><label>Branş<input value={branchSubject} disabled={Boolean(record)} onChange={event => setBranchSubject(event.target.value)} required maxLength={120} placeholder="Örn. Matematik"/></label><label>Soru sayısı<input type="number" min="1" max="500" value={branchCount} disabled={Boolean(record)} onChange={event => setBranchCount(event.target.value)} required/></label></div>}
      <label className="exam-editor-net">Toplam net<input name="reported_total_net" type="number" inputMode="decimal" step="0.01" min={minNet} max={totalQuestions || undefined} required={record?.total_net !== null} readOnly={hasCompleteLegacyResults} defaultValue={record?.total_net ?? ''} placeholder="Örn. 72,5"/><small>{hasCompleteLegacyResults ? 'Bu eski kaydın ders ayrıntıları korunur; toplam neti burada değiştirilemez.' : record?.total_net === null ? 'Bu eski kayıtta toplam net yok; boş bırakabilirsin.' : 'Denemedeki toplam net sonucunu gir.'}</small></label>
      <details className="exam-editor-notes"><summary>Not ekle <ChevronDown size={14}/></summary><label>Notların<textarea name="notes" maxLength={10000} defaultValue={record?.notes ?? ''} placeholder="Bu denemeyle ilgili kısa bir not"/></label></details>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>Vazgeç</button><button className="button primary" disabled={busy || !format || !totalQuestions}>{busy ? 'Kaydediliyor…' : 'Denemeyi kaydet'}<ArrowUpRight size={16}/></button></div>
    </form>
  </Modal>;
}
