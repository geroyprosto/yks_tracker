'use client';

import {useEffect, useRef, useState} from 'react';
import {AlertCircle, ArrowRight, Check, ChevronDown, FileText, RefreshCw, Settings2} from 'lucide-react';
import {formatDay, localDate} from '@/lib/ui';
import {AnalysisCoachingPanel, type CoachingView} from './analysis-coaching';
import styles from './analysis.module.css';

type ReportSummary = {
  schema_version?: number;
  source_days?: string[];
  data_days?: number;
  missing_days?: number;
  record_count?: number;
  structured_report?: unknown;
  coaching?: unknown;
};

type Report = {
  id: string;
  start_date: string;
  end_date: string;
  status: 'completed' | 'failed' | 'running' | 'pending' | 'uncertain';
  body: string | null;
  created_at: string;
  stale: boolean;
  error_message?: string | null;
  summary?: ReportSummary;
};

type AnalysisResponse = {
  ok: true;
  configured: boolean;
  model: string | null;
  reports: Report[];
  limits: {monthly_requests: number; monthly_usd: number};
  used: {requests: number; estimated_cost_usd: number | null};
  current_coaching?: unknown;
  current_repetition_results?: unknown;
  current_repetition_cutoff?: string | null;
};

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function isDate(value: string) {
  const parsed = new Date(`${value}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateLabel(value: string) {
  return isDate(value) ? formatDay(value, {day: 'numeric', month: 'long', year: 'numeric'}) : value;
}

function timestampLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('tr-TR', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul'}).format(date)
    : 'Tarih belirtilmedi';
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function coachingFrom(value: unknown): CoachingView | null {
  const outer = record(value);
  if (!outer) return null;
  const metrics = record(outer.metrics) ?? outer;
  const priority = record(metrics.priority_summary);
  const exam = record(metrics.weekly_exam);
  const tyt = record(exam?.TYT), ayt = record(exam?.AYT);
  if (metrics.schema_version !== 1 || typeof record(metrics.context)?.current_cutoff !== 'string'
    || !record(priority?.high) || !record(priority?.all) || !record(priority?.overdue) || !Array.isArray(priority?.by_subject)
    || !record(metrics.study) || !Array.isArray(tyt?.exams) || !Array.isArray(tyt?.warnings)
    || !Array.isArray(ayt?.exams) || !Array.isArray(ayt?.warnings)
    || !Array.isArray(metrics.retrospective_changes) || !Array.isArray(metrics.diary_insights)) return null;
  return {...metrics, directions: Array.isArray(outer.directions) ? outer.directions : [],
    repetition_results: Array.isArray(outer.repetition_results) ? outer.repetition_results : [],
    homework_results: Array.isArray(outer.homework_results) ? outer.homework_results : []} as CoachingView;
}

function reportDirections(report: Report | undefined): unknown[] {
  const coaching = record(report?.summary?.coaching);
  if (Array.isArray(coaching?.directions)) return coaching.directions;
  const structured = record(report?.summary?.structured_report);
  return Array.isArray(structured?.directions) ? structured.directions : [];
}

function reportRepetitions(report: Report | undefined): unknown[] {
  const coaching = record(report?.summary?.coaching);
  return Array.isArray(coaching?.repetition_results) ? coaching.repetition_results : [];
}

function responseError(body: unknown, fallback: string) {
  const value = record(body);
  const error = value?.error;
  if (typeof error === 'string') return error;
  const detail = record(error);
  return typeof detail?.message === 'string' ? detail.message : fallback;
}

async function fetchAnalysis(signal?: AbortSignal): Promise<AnalysisResponse> {
  const response = await fetch('/api/analysis', {cache: 'no-store', signal});
  const body: unknown = await response.json();
  if (!response.ok || record(body)?.ok !== true) throw new Error(responseError(body, 'Analiz bilgileri yüklenemedi.'));
  return body as AnalysisResponse;
}

function usd(value: number) {
  return new Intl.NumberFormat('tr-TR', {style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4}).format(value);
}

function legacyText(value: string) {
  return value.split('\n').filter(line => !/\b20\s*soru\b/i.test(line)).join('\n')
    .replace(/\b(\d{1,3}(?:\.\d{3})+|\d+)\s*saniye\b/gi, (_, value: string) => {
      const minutes = Math.round(Number(value.replaceAll('.', '')) / 60);
      return minutes >= 60 ? `${Math.floor(minutes / 60)} sa ${minutes % 60} dk` : `${minutes} dk`;
    }).trim();
}

function ReportText({body, sourceDays, onOpenDay}: {body: string; sourceDays: string[]; onOpenDay: (date: string) => void}) {
  return <div className={styles.reportText}>{body.split('\n').map((line, lineIndex) => {
    const fragments = line.split(/(\b20\d{2}-\d{2}-\d{2}\b)/g);
    return <p key={lineIndex}>{fragments.map((fragment, index) => isDate(fragment) && sourceDays.includes(fragment)
      ? <button className={styles.sourceDay} key={index} type="button" onClick={() => onOpenDay(fragment)} title={`${dateLabel(fragment)} gün detayını aç`}>{fragment}<ArrowRight size={13} aria-hidden="true"/></button>
      : <span key={index}>{fragment}</span>)}</p>;
  })}</div>;
}

function LegacyContext({report, onOpenDay}: {report: Report; onOpenDay: (date: string) => void}) {
  const structured = record(report.summary?.structured_report);
  let paragraphs: string[] = [];
  if (structured?.schema_version === 2) {
    paragraphs = [structured.overview, ...(Array.isArray(structured.study_observations) ? structured.study_observations : []),
      ...(Array.isArray(structured.result_observations) ? structured.result_observations : []),
      ...(Array.isArray(structured.limitations) ? structured.limitations : [])].map(item => typeof item === 'string' ? item : record(item)?.text)
      .filter((item): item is string => typeof item === 'string' && !!item.trim()).map(legacyText).filter(Boolean);
  } else if (structured?.schema_version === 3) {
    paragraphs = ['journal', 'wins'].flatMap(key => {
      const entry = record(structured[key]);
      return [entry?.headline, entry?.text].filter((item): item is string => typeof item === 'string' && !!item.trim());
    }).map(legacyText).filter(Boolean);
  }
  const safeBody = report.body ? legacyText(report.body) : '';
  return <section className={styles.legacyContext} aria-label="Kaydedilmiş eski rapor">
    <h4>Kaydedilmiş değerlendirme · eski rapor biçimi</h4>
    <small>Bu tarihî kayıtta yalnız gözlemler gösterilir. Eski yönlendirme alanları güncel koçluk değerlendirmesine uymaz.</small>
    {paragraphs.length ? paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)
      : structured?.schema_version === 3 ? <p>Bu eski raporda gösterilebilecek günlük veya çalışma gözlemi yok.</p>
        : safeBody ? <ReportText body={safeBody} sourceDays={report.summary?.source_days ?? []} onOpenDay={onOpenDay}/>
        : <p>Bu raporda okunabilir değerlendirme bulunmuyor.</p>}
  </section>;
}

export function Analysis({onOpenDay, onOpenTasks, onOpenJournal, journalAnalysisEnabled}: {
  onOpenDay: (date: string) => void;
  onOpenTasks?: () => void;
  onOpenJournal?: () => void;
  journalAnalysisEnabled: boolean;
}) {
  const day = localDate();
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [startDate, setStartDate] = useState(shiftDate(day, -13));
  const [endDate, setEndDate] = useState(day);
  const retryIds = useRef(new Map<string, string>());

  const load = async () => {
    setRefreshing(true);
    setError('');
    try {setData(await fetchAnalysis());}
    catch (cause) {setError(cause instanceof Error ? cause.message : 'Analiz bilgileri yüklenemedi.');}
    finally {setLoading(false); setRefreshing(false);}
  };

  useEffect(() => {
    const controller = new AbortController();
    void fetchAnalysis(controller.signal).then(incoming => {
      if (!controller.signal.aborted) setData(incoming);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Analiz bilgileri yüklenemedi.');
    }).finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, []);

  const submit = async () => {
    if (busy) return;
    const action = {action: 'report', start_date: startDate, end_date: endDate};
    const fingerprint = JSON.stringify(action);
    const requestId = retryIds.current.get(fingerprint) ?? crypto.randomUUID();
    retryIds.current.set(fingerprint, requestId);
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/analysis', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...action, request_id: requestId})});
      const body: unknown = await response.json();
      if (!response.ok || record(body)?.ok !== true) {
        if (response.status < 500) retryIds.current.delete(fingerprint);
        throw new Error(responseError(body, 'Rapor oluşturulamadı.'));
      }
      retryIds.current.delete(fingerprint);
      setData(body as AnalysisResponse);
      setMessage('Rapor isteği kaydedildi. Güncel durumu aşağıda görebilirsin.');
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'Rapor oluşturulamadı.');}
    finally {setBusy(false);}
  };

  const rangeValid = isDate(startDate) && isDate(endDate) && startDate <= endDate && endDate <= day
    && [7, 14, 30].includes((Date.parse(endDate) - Date.parse(startDate)) / 86400000 + 1);
  const reports = [...(data?.reports ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const latest = reports.find(report => report.status === 'completed');
  const saved = coachingFrom(latest?.summary?.coaching);
  const live = coachingFrom(data?.current_coaching);
  const topMetrics = live ?? saved;
  const currentRepetitions = Array.isArray(data?.current_repetition_results) ? data.current_repetition_results : null;
  const savedDirections = latest?.summary?.schema_version === 4 ? reportDirections(latest) : [];
  const topDirections = savedDirections.length ? savedDirections : live?.directions ?? [];
  const savedNotes = latest?.summary?.schema_version === 4 ? saved : null;

  return <div className={styles.workspace}>
    <div className={styles.intro}><p><strong>Kaydedilmiş çalışmaların, görevlerin ve denemelerin</strong> birlikte değerlendiriliyor. {journalAnalysisEnabled ? 'Paylaştığın günlük alanları da analize dahil.' : 'Günlük analizi hesap ayarında kapalı.'}</p></div>
    {error && <div className={styles.alert} role="alert"><AlertCircle size={18} aria-hidden="true"/><span>{error}</span></div>}
    {message && <div className={styles.success} role="status"><Check size={18} aria-hidden="true"/><span>{message}</span></div>}
    {loading && <div className={styles.loading} role="status">Analiz durumu yükleniyor…</div>}
    {!loading && !data && <button type="button" className={styles.secondaryButton} onClick={() => void load()} disabled={refreshing}>Yeniden dene</button>}
    {!loading && data && <>
      {topMetrics ? <AnalysisCoachingPanel metrics={topMetrics} live={Boolean(live)} savedCutoff={savedDirections.length || savedNotes?.journal_note || savedNotes?.exam_note ? latest?.created_at : null}
        directions={topDirections} repetitionResults={currentRepetitions ?? reportRepetitions(latest)}
        repetitionCutoff={currentRepetitions ? data.current_repetition_cutoff : latest?.created_at}
        homeworkResults={live?.homework_results?.length ? live.homework_results : saved?.homework_results}
        journalNote={savedNotes?.journal_note} examNote={savedNotes?.exam_note}
        onOpenTasks={onOpenTasks} onOpenJournal={onOpenJournal}/>
        : <div className={styles.emptyHistory}><strong>Güncel koçluk ölçütleri henüz hazır değil.</strong><span>{latest ? 'En son kaydedilmiş değerlendirmeyi rapor geçmişinde açabilirsin.' : 'İlk analizini oluşturduğunda burada görev, günlük ve deneme verilerini birlikte göreceksin.'}</span></div>}

      <details className={styles.controls} data-testid="analysis-controls"><summary><Settings2 size={17} aria-hidden="true"/> Rapor oluştur ve analiz ayarları <ChevronDown size={16} aria-hidden="true"/></summary><div className={styles.controlsInner}>
        <div><h3>Yeni dönem raporu</h3><p>7, 14 veya 30 günlük kayıtlarını analiz et. Yeni istek aylık kullanımına eklenir.</p></div>
        <form className={styles.dateForm} onSubmit={event => {event.preventDefault(); if (rangeValid) void submit();}}>
          <label>Rapor dönemi<select value={Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1} onChange={event => {setEndDate(day); setStartDate(shiftDate(day, 1 - Number(event.target.value)));}}>{[7, 14, 30].map(days => <option key={days} value={days}>Son {days} gün</option>)}</select></label>
          <label>Başlangıç<input type="date" value={startDate} max={endDate || day} onChange={event => setStartDate(event.target.value)} required/></label>
          <label>Bitiş<input type="date" value={endDate} min={startDate || undefined} max={day} onChange={event => setEndDate(event.target.value)} required/></label>
          {!rangeValid && <p className={styles.formHint} role="alert">7, 14 veya 30 günlük bir tarih aralığı seç.</p>}
          <button className={styles.primaryButton} type="submit" disabled={!data.configured || !rangeValid || busy}>{busy ? 'Rapor hazırlanıyor…' : 'Rapor oluştur'} <ArrowRight size={16} aria-hidden="true"/></button>
        </form>
        <div className={styles.technical}><span>Bağlantı: <strong>{data.configured ? 'Hazır' : 'Kurulum bekliyor'}</strong></span><span>Model: <strong>{data.model ?? 'Belirtilmedi'}</strong></span><span>Bu ay: <strong>{data.used.requests} / {data.limits.monthly_requests} istek</strong></span><span>Tahmini API maliyeti: <strong>{data.used.estimated_cost_usd === null ? 'Hesaplanamadı' : usd(data.used.estimated_cost_usd)}</strong></span></div>
      </div></details>

      <section className={styles.history} aria-labelledby="report-history-title"><div className={styles.historyHeader}><h3 id="report-history-title">Rapor geçmişi <span>{reports.length}</span></h3><button type="button" className={styles.refreshButton} onClick={() => void load()} disabled={refreshing || busy}><RefreshCw size={15} aria-hidden="true"/>{refreshing ? 'Yenileniyor…' : 'Yenile'}</button></div>
        {reports.length === 0 ? <div className={styles.emptyHistory}><strong>Henüz rapor yok</strong><span>İlk dönem raporunu oluşturduğunda sonucu burada göreceksin.</span></div>
          : <div className={styles.reportList}>{reports.map((report, index) => {
            const coaching = coachingFrom(report.summary?.coaching);
            return <details className={styles.reportCard} data-testid="report-card" key={report.id} open={index === 0 && coaching ? true : undefined}><summary><FileText size={18} aria-hidden="true"/><span className={styles.reportTitle}><strong>{dateLabel(report.start_date)} – {dateLabel(report.end_date)}</strong><small>{timestampLabel(report.created_at)}</small></span><span className={`${styles.pill} ${report.status === 'completed' ? styles.ready : report.status === 'failed' ? styles.failed : styles.waiting}`}>{report.status === 'completed' ? 'Tamamlandı' : report.status === 'failed' ? 'Hata' : report.status === 'uncertain' ? 'Kontrol gerekli' : 'Hazırlanıyor'}</span></summary>
              <div className={styles.reportBody}>
                {report.stale && <p className={styles.staleNotice}>Bu rapordan sonra kayıtlar değişti; değerlendirme güncel olmayabilir.</p>}
                {report.status === 'failed' && <p className={styles.failedText}>{report.error_message || 'Rapor hazırlanamadı.'}</p>}
                {report.status === 'uncertain' && <p className={styles.failedText}>Son isteğin sonucu doğrulanamadı. Yenile ile durumunu kontrol et.</p>}
                {(report.status === 'running' || report.status === 'pending') && <p className={styles.runningText}>Rapor hazırlanıyor. Bir süre sonra yenile.</p>}
                {report.status === 'completed' && (coaching
                  ? <AnalysisCoachingPanel metrics={coaching} live={false} directions={reportDirections(report)} repetitionResults={reportRepetitions(report)} repetitionCutoff={coaching.context.current_cutoff} homeworkResults={coaching.homework_results} journalNote={coaching.journal_note} examNote={coaching.exam_note} onOpenTasks={onOpenTasks} onOpenJournal={onOpenJournal}/>
                  : <LegacyContext report={report} onOpenDay={onOpenDay}/>)}
                {Boolean(report.summary?.source_days?.length) && <div className={styles.sourceDays}><strong>Kaynak günler</strong><div>{report.summary?.source_days?.filter(isDate).map(sourceDay => <button key={sourceDay} type="button" onClick={() => onOpenDay(sourceDay)}>{dateLabel(sourceDay)} <ArrowRight size={12} aria-hidden="true"/></button>)}</div></div>}
              </div>
            </details>;
          })}</div>}
      </section>
    </>}
  </div>;
}
