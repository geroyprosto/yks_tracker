'use client';

import {useMemo, useState} from 'react';
import {ArrowUpRight, CalendarDays, ChartNoAxesCombined, ChevronDown, PenLine, Plus, Trash2} from 'lucide-react';
import type {AppState, ExamFormat, ExamRecord} from '@/lib/domain/types';
import {examRange, examSeries, examValue, type ExamGrouping, type ExamPeriod} from '@/lib/exam-analysis';
import {calculateExamResults, calculatePerformanceScore, type AnswerCounts} from '@/lib/exam-results';
import {formatDay, localDate, type CommandFn} from '@/lib/ui';
import {Card, Empty} from './primitives';
import {Modal} from './modal';
import {MonthlyExamChart} from './monthly-exam-chart';
import {ExamPlot} from './exam-plot';
import styles from './exams-analysis.module.css';

const tr = (value: number) => new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 2}).format(value);
const codes = [['TYT', 'TYT genel'], ['AYT_SAYISAL', 'AYT sayısal'], ['BRANCH', 'Branş denemesi']] as const;
type EditorResult = {section_key: string; correct: number; wrong: number; blank?: number} | {section_key: string; net: number};
type SubjectOption = {value: string; label: string; sectionKey: string};

const branchSubjectValue = (label: string) => `branch:${label.trim().toLocaleLowerCase('tr-TR')}`;

function subjectOptions(exams: ExamRecord[], formats: ExamFormat[], format: ExamRecord['format_code']): SubjectOption[] {
  const options = new Map<string, SubjectOption>();
  if (format === 'BRANCH') {
    for (const exam of exams) {
      if (exam.format_code !== 'BRANCH') continue;
      const label = exam.format_snapshot.sections.find(section => section.key === 'branch')?.label.trim();
      if (!label) continue;
      const value = branchSubjectValue(label);
      if (!options.has(value)) options.set(value, {value, label, sectionKey: 'branch'});
    }
    return [...options.values()].sort((a, b) => a.label.localeCompare(b.label, 'tr'));
  }
  const snapshots = [
    ...formats.filter(item => item.code === format).sort((a, b) => b.version - a.version),
    ...exams.filter(item => item.format_code === format).map(item => item.format_snapshot),
  ];
  for (const snapshot of snapshots) {
    for (const section of snapshot.sections) {
      if (!options.has(section.key)) options.set(section.key, {value: section.key, label: section.label, sectionKey: section.key});
    }
  }
  return [...options.values()];
}

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
  const [subject, setSubject] = useState('total');
  const subjects = useMemo(() => subjectOptions(exams, formats, format), [exams, formats, format]);
  const [previousSubjects, setPreviousSubjects] = useState(subjects);
  if (subjects !== previousSubjects) {
    setPreviousSubjects(subjects);
    if (subject !== 'total' && !subjects.some(item => item.value === subject)) setSubject('total');
  }
  const selectedSubject = subjects.find(item => item.value === subject);
  const activeSubject = selectedSubject?.value ?? 'total';
  const sectionKey = selectedSubject?.sectionKey ?? 'total';
  const selectedExams = format === 'BRANCH' && selectedSubject
    ? exams.filter(item => item.format_code === 'BRANCH' && branchSubjectValue(item.format_snapshot.sections.find(section => section.key === 'branch')?.label ?? '') === activeSubject)
    : exams;
  const {start, end} = examRange(period, localDate(), customStart, customEnd);
  const filtered = selectedExams.filter(item => item.format_code === format && item.exam_date >= start && item.exam_date <= end);
  const examCount = filtered.filter(item => examValue(item, sectionKey, 'net') !== null).length;
  const points = examSeries(selectedExams, {
    format, publisher: '', section: sectionKey, measure: 'net', grouping, start, end,
  });
  const valid = points.filter(point => point.value !== null);
  const latest = valid.at(-1);
  const previous = valid.at(-2);

  return <div className="exam-page">
    <div className="exam-intro">
      <div>
        <p className="eyebrow">{preview ? 'ÖRNEK ÖNİZLEME' : 'DENEME TAKİBİ'}</p>
        <h2>Deneme sonuçların</h2>
        <p>Derslerinin doğru ve yanlışlarını gir, net gelişimini zaman içinde gör.</p>
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
              <label>Tür<select value={format} onChange={event => {setFormat(event.target.value as typeof format); setSubject('total');}}>{codes.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
              <label>Ders<select value={activeSubject} onChange={event => setSubject(event.target.value)}><option value="total">Toplam net</option>{subjects.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label>Dönem<select value={period} onChange={event => setPeriod(event.target.value as ExamPeriod)}><option value="week">Bu hafta</option><option value="month">Bu ay</option><option value="two-months">Son iki ay</option><option value="all">Tüm geçmiş</option><option value="custom">Özel aralık</option></select></label>
              <label>Gösterim<select value={grouping} onChange={event => setGrouping(event.target.value as ExamGrouping)}><option value="exam">Tek denemeler</option><option value="week">Haftalık ortalama</option><option value="month">Aylık ortalama</option></select></label>
            </div>
            {period === 'custom' && <div className="exam-dates"><label>Başlangıç<input type="date" value={customStart} onChange={event => setCustomStart(event.target.value)}/></label><label>Bitiş<input type="date" value={customEnd} onChange={event => setCustomEnd(event.target.value)}/></label></div>}
            <div className="exam-chart-summary"><div><span>Son net</span><strong>{latest?.value === null || latest?.value === undefined ? '—' : tr(latest.value)}</strong></div><div><span>Önceki sonuca göre</span><strong>{latest?.value === null || latest?.value === undefined || previous?.value === null || previous?.value === undefined ? '—' : (latest.value - previous.value >= 0 ? '+' : '') + tr(latest.value - previous.value)}</strong></div><div><span>Deneme sayısı</span><strong>{examCount}</strong></div></div>
            {valid.length ? <ExamPlot key={[format, activeSubject, grouping, start, end].join('|')} points={points} measure="net" exams={filtered} grouping={grouping} sectionLabel={selectedSubject ? `${selectedSubject.label} net` : 'Toplam net'}/> : <Empty icon={<ChartNoAxesCombined/>} title="Bu seçimde sonuç yok" text={selectedSubject ? 'Bu dersin netlerini görmek için denemelerindeki ders sonuçlarını gir.' : 'İlk denemeni eklediğinde net grafiğin burada oluşacak.'}/>}
          </Card>
        </div>
      </div>
      <Card className="ambient-card exam-list-card" title="Deneme kayıtların" eyebrow="SONUÇ ARŞİVİ" action={<span className="pill">{exams.length} kayıt</span>}>
        {exams.length === 0 ? <Empty icon={<ChartNoAxesCombined/>} title="Henüz deneme kaydı yok" text="Derslerinin doğru ve yanlışlarını girerek ilk denemeni kaydet."/> : <div className="exam-records">{[...exams].sort((a, b) => b.exam_date.localeCompare(a.exam_date) || b.created_at.localeCompare(a.created_at)).map(exam => <article className="exam-record" key={exam.id}><div className="exam-record-main"><span className="exam-record-date">{formatDay(exam.exam_date, {day: 'numeric', month: 'short', year: 'numeric'})}</span><strong>{exam.name}</strong><small>{exam.format_snapshot.label}</small></div><div className="exam-record-score"><strong>{exam.total_net === null ? '—' : tr(exam.total_net)}</strong><span>toplam net</span>{exam.total_net !== null && exam.format_snapshot.total_questions > 0 && <small>{tr(calculatePerformanceScore(exam.total_net, exam.format_snapshot.total_questions))} deneme puanı</small>}{exam.score !== null && <small>{tr(exam.score)} kayıtlı puan</small>}</div><div className="exam-record-actions"><button className="icon-button" aria-label={exam.name + ' düzenle'} onClick={() => setEditing(exam)} disabled={busy || preview}><PenLine size={16}/></button><button className="icon-button" aria-label={exam.name + ' sil'} onClick={() => setDeleting(exam)} disabled={busy || preview}><Trash2 size={16}/></button></div></article>)}</div>}
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
  const [answers, setAnswers] = useState<Record<string, {correct: string; wrong: string}>>(() => Object.fromEntries(
    (record?.results ?? []).filter(row => row.correct !== null && row.wrong !== null).map(row => [row.section_key, {correct: String(row.correct), wrong: String(row.wrong)}]),
  ));
  const [touchedSections, setTouchedSections] = useState<string[]>([]);
  const [error, setError] = useState('');
  const selectedFormat = record?.format_snapshot ?? formats.filter(item => item.code === formatCode).sort((a, b) => b.version - a.version)[0];
  const branchQuestions = Number(branchCount);
  const format = selectedFormat && formatCode === 'BRANCH' && !record ? {
    ...selectedFormat,
    total_questions: branchQuestions,
    sections: [{key: 'branch', label: branchSubject.trim() || 'Branş', question_count: branchQuestions}],
  } : selectedFormat;
  const suggestedName = record?.name ?? String(examCount + 1) + '. deneme';
  const hasCompleteCounts = Boolean(record && record.results.length === record.format_snapshot.sections.length && record.results.every(row => row.correct !== null && row.wrong !== null));
  const answersEdited = touchedSections.length > 0;
  const hasInput = Boolean(format?.sections.some(section => {
    const value = answers[section.key];
    return value && (value.correct !== '' || value.wrong !== '');
  }));
  const counts = Object.fromEntries((format?.sections ?? []).map(section => [section.key, {
    correct: answers[section.key]?.correct ? Number(answers[section.key].correct) : 0,
    wrong: answers[section.key]?.wrong ? Number(answers[section.key].wrong) : 0,
  }])) as Record<string, AnswerCounts>;
  let calculation: ReturnType<typeof calculateExamResults> | null = null;
  let calculationError = '';
  if (format) {
    try { calculation = calculateExamResults(format, counts); }
    catch (cause) { calculationError = cause instanceof Error ? cause.message : 'Ders sonuçlarını kontrol et.'; }
  }
  const previewNet = !record ? hasInput ? calculation?.totalNet ?? null : null
    : !answersEdited ? record.total_net : format && calculation && format.sections.every(section =>
      touchedSections.includes(section.key) || record.results.some(row => row.section_key === section.key),
    ) ? format.sections.reduce((sum, section) => sum + (touchedSections.includes(section.key)
      ? calculation!.sections.find(row => row.section_key === section.key)!.net
      : record.results.find(row => row.section_key === section.key)!.net), 0) : null;
  const previewScore = previewNet !== null && format ? calculatePerformanceScore(previewNet, format.total_questions) : null;
  const requiresFullConversion = Boolean(record && record.reported_total_net !== null && format && record.results.length < format.sections.length);

  function changeAnswer(sectionKey: string, field: 'correct' | 'wrong', value: string) {
    setAnswers(current => ({...current, [sectionKey]: {...(current[sectionKey] ?? {correct: '', wrong: ''}), [field]: value}}));
    setTouchedSections(current => current.includes(sectionKey) ? current : [...current, sectionKey]);
    setError('');
  }

  return <Modal title={record ? 'Denemeyi düzenle' : 'Yeni deneme ekle'} onClose={onClose}>
    <form className="exam-editor" onSubmit={async event => {
      event.preventDefault();
      setError('');
      if (!examDate) {
        setError('Deneme tarihini seç.');
        return;
      }
      if (!format || calculationError || !calculation) {
        setError(calculationError || 'Deneme türünü ve soru sayısını kontrol et.');
        return;
      }
      if (!record && !hasInput) {
        setError('En az bir ders için doğru veya yanlış sayısı gir.');
        return;
      }
      if (record && answersEdited && requiresFullConversion && format.sections.some(section => {
        const value = answers[section.key];
        return !value || value.correct === '' && value.wrong === '';
      })) {
        setError('Bu eski toplam net kaydını yenilemek için her dersin doğru ve yanlışını gir. Girmediğin sayılar için 0 yazabilirsin.');
        return;
      }
      const form = new FormData(event.currentTarget);
      const name = String(form.get('name') ?? '').trim() || suggestedName;
      const payload: Record<string, unknown> = {
        name,
        exam_date: examDate,
        notes: String(form.get('notes') ?? '').trim(),
      };
      if (!record || answersEdited) {
        payload.results = !record ? calculation.sections.map(({section_key, correct, wrong}) => ({section_key, correct, wrong}))
          : format.sections.flatMap<EditorResult>(section => {
            const current = calculation.sections.find(row => row.section_key === section.key)!;
            if (touchedSections.includes(section.key)) return [{section_key: section.key, correct: current.correct, wrong: current.wrong}];
            const previous = record.results.find(row => row.section_key === section.key);
            if (!previous) return [];
            return previous.correct === null || previous.wrong === null
              ? [{section_key: section.key, net: previous.net}]
              : [{section_key: section.key, correct: previous.correct, wrong: previous.wrong, blank: previous.blank!}];
          });
      }
      if (record) {
        payload.id = record.id;
        payload.expected_revision = record.revision;
        if (answersEdited) payload.reported_total_net = null;
        await onSave('exam.update', payload);
      } else {
        payload.format_code = formatCode;
        payload.format_version = format?.version ?? 1;
        if (formatCode === 'BRANCH') {
          payload.branch_subject = branchSubject.trim();
          payload.branch_question_count = branchQuestions;
        }
        await onSave('exam.create', payload);
      }
    }}>
      <div className="exam-editor-top">
        <label>Tür<select value={formatCode} disabled={Boolean(record)} onChange={event => {setFormatCode(event.target.value as typeof formatCode); setAnswers({}); setTouchedSections([]); setError('');}}>{codes.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
        <details className="exam-editor-date"><summary><CalendarDays size={15}/><span>{examDate ? formatDay(examDate, {day: 'numeric', month: 'short', year: 'numeric'}) : 'Tarih seç'}</span><ChevronDown size={14}/></summary><label>Tarih<input name="exam_date" type="date" value={examDate} onChange={event => setExamDate(event.target.value)}/></label></details>
      </div>
      <label className="exam-editor-name">Deneme adı <span>İsteğe bağlı</span><input name="name" maxLength={240} defaultValue={record?.name ?? ''} placeholder={'Boşsa ' + suggestedName}/></label>
      {formatCode === 'BRANCH' && <div className="exam-editor-branch"><label>Branş<input value={branchSubject} disabled={Boolean(record)} onChange={event => setBranchSubject(event.target.value)} required maxLength={120} placeholder="Örn. Matematik"/></label><label>Soru sayısı<input type="number" min="1" max="500" value={branchCount} disabled={Boolean(record)} onChange={event => setBranchCount(event.target.value)} required/></label></div>}
      <section className="exam-editor-results" aria-labelledby="exam-subject-heading">
        <div className="exam-editor-results-heading"><h3 id="exam-subject-heading">Ders sonuçları</h3><span>{format?.wrong_divisor ?? 4} yanlış 1 doğruyu götürür</span></div>
        {record && !hasCompleteCounts && <p className="exam-editor-legacy">{requiresFullConversion ? 'Bu eski kaydın yalnız toplam neti var. Dersleri yenilemek için her satıra doğru ve yanlış sayısını gir; boşlar otomatik hesaplanır.' : 'Bu eski kaydın bazı ders sayıları yok. Dokunmadığın ders sonuçları korunur.'}</p>}
        <div className="exam-subject-list">
          {(format?.sections ?? []).map(section => {
            const values = answers[section.key] ?? {correct: '', wrong: ''};
            const result = calculation?.sections.find(row => row.section_key === section.key);
            const previous = record?.results.find(row => row.section_key === section.key);
            const showCountResult = !record || touchedSections.includes(section.key) || previous?.correct !== null && previous?.correct !== undefined;
            const invalid = Number(values.correct || 0) + Number(values.wrong || 0) > section.question_count;
            return <div className={'exam-subject-row' + (invalid ? ' exam-subject-row-invalid' : '')} key={section.key}>
              <div className="exam-subject-name"><strong>{section.label}</strong><span>{section.question_count} soru</span></div>
              <label>Doğru<input aria-label={section.label + ' doğru'} type="number" inputMode="numeric" min="0" max={section.question_count} step="1" value={values.correct} onChange={event => changeAnswer(section.key, 'correct', event.target.value)} placeholder="0"/></label>
              <label>Yanlış<input aria-label={section.label + ' yanlış'} type="number" inputMode="numeric" min="0" max={section.question_count} step="1" value={values.wrong} onChange={event => changeAnswer(section.key, 'wrong', event.target.value)} placeholder="0"/></label>
              <div className="exam-subject-calculated"><span>Boş {showCountResult && result ? result.blank : '—'}</span><strong>Net {showCountResult && result ? tr(result.net) : previous ? tr(previous.net) : '—'}</strong></div>
            </div>;
          })}
        </div>
        {formatCode === 'TYT' && format?.sections.some(section => section.key === 'din') && <p className="exam-editor-hint">Din Kültürü&apos;nden muafsan 5 ilave Felsefe sorusunu Din Kültürü satırına gir.</p>}
      </section>
      <div className="exam-editor-summary">
        <div><span>Toplam net</span><strong>{previewNet === null ? '—' : tr(previewNet)}</strong></div>
        <div><span>Tahmini deneme puanı</span><strong>{previewScore === null ? '—' : tr(previewScore)}</strong></div>
        <small>0–500 arası uygulama içi performans puanı: 100 + 400 × net / soru sayısı. ÖSYM sınav veya yerleştirme puanı değildir.</small>
      </div>
      <details className="exam-editor-notes"><summary>Not ekle <ChevronDown size={14}/></summary><label>Notların<textarea name="notes" maxLength={10000} defaultValue={record?.notes ?? ''} placeholder="Bu denemeyle ilgili kısa bir not"/></label></details>
      {(error || calculationError && hasInput) && <p className="error-text" role="alert">{error || calculationError}</p>}
      <div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>Vazgeç</button><button className="button primary" disabled={busy || !format || !Number.isInteger(format.total_questions) || format.total_questions < 1}>{busy ? 'Kaydediliyor…' : 'Denemeyi kaydet'}<ArrowUpRight size={16}/></button></div>
    </form>
  </Modal>;
}
