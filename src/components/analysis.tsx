'use client';

import {useEffect, useRef, useState} from 'react';
import {AlertCircle, ArrowRight, BookOpen, CalendarDays, Check, CircleHelp, Compass, FileText, Lightbulb, NotebookPen, RefreshCw, Sparkles, TrendingUp} from 'lucide-react';
import {REPORT_HEADINGS} from '@/lib/ai-report';
import {formatDay, localDate} from '@/lib/ui';
import styles from './analysis.module.css';

type InsightKey = 'topics' | 'regularity' | 'journal' | 'wins' | 'improvements' | 'timing';
type InsightEntry = {headline: string; text: string; evidence_ids: string[]; course_id: string | null};
type InsightReport = {schema_version: 3} & Record<InsightKey, InsightEntry>;
type LegacyReport = {
  schema_version: 2;
  overview: string;
  study_observations: {text: string}[];
  result_observations: {text: string}[];
  next_actions: {text: string}[];
  limitations: string[];
};
type ReportMetrics = {
  topics?: {completed?: number; progressed?: number};
  regularity?: {days?: {date: string; seconds: number | null; status: string}[]};
  journal?: {shared_day_count?: number};
  wins?: {current?: {observed_days?: number; study_seconds?: number}; previous?: {observed_days?: number; study_seconds?: number}};
  improvements?: {task_done?: number; task_count?: number};
  timing?: {month?: number; phase?: string; as_of?: string};
};
type ReportSummary = {
  source_days?: string[];
  data_days?: number;
  missing_days?: number;
  record_count?: number;
  structured_report?: unknown;
  report_metrics?: ReportMetrics;
  guidance_sources?: {title: string; url: string}[];
  guidance_as_of?: string;
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
  usage?: {input_tokens: number; output_tokens: number; estimated_cost_usd: number | null};
  summary?: ReportSummary;
};

type AnalysisResponse = {
  ok: true;
  configured: boolean;
  model: string | null;
  scheduler_ready: boolean;
  schedule: {enabled: boolean; start_date: string | null} | null;
  reports: Report[];
  limits: {monthly_requests: number; monthly_usd: number};
  used: {requests: number; estimated_cost_usd: number | null};
  resets_at?:string;
};

type Action =
  | {action: 'report'; start_date: string; end_date: string}
  | {action: 'schedule'; enabled: boolean; start_date: string};

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

function responseError(body: unknown, fallback: string) {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = body.error;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  }
  return fallback;
}

async function fetchAnalysis(signal?: AbortSignal): Promise<AnalysisResponse> {
  const response = await fetch('/api/analysis', {cache: 'no-store', signal});
  const body: unknown = await response.json();
  if (!response.ok || !body || typeof body !== 'object' || !('ok' in body) || body.ok !== true) {
    throw new Error(responseError(body, 'Analiz bilgileri yüklenemedi.'));
  }
  return body as AnalysisResponse;
}

function usd(value: number) {
  return new Intl.NumberFormat('tr-TR', {style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4}).format(value);
}

function ReportText({body, sourceDays, onOpenDay}: {body: string; sourceDays: string[]; onOpenDay: (date: string) => void}) {
  return <div className={styles.reportText}>{body.split('\n').map((line, lineIndex) => {
    const fragments = line.split(/(\b20\d{2}-\d{2}-\d{2}\b)/g);
    return <p key={lineIndex}>{fragments.map((fragment, index) => isDate(fragment) && sourceDays.includes(fragment)
      ? <button className={styles.sourceDay} key={index} type="button" onClick={() => onOpenDay(fragment)} title={`${dateLabel(fragment)} gün detayını aç`}>{fragment}<ArrowRight size={13} aria-hidden="true"/></button>
      : <span key={index}>{fragment}</span>)}</p>;
  })}</div>;
}

const insightKeys: InsightKey[] = ['topics', 'regularity', 'journal', 'wins', 'improvements', 'timing'];
const insightIcons = [BookOpen, CalendarDays, NotebookPen, TrendingUp, Lightbulb, Compass];
const legacyHeadings = ['Genel Durum', 'Çalışma Düzeni', 'Sınav Sonuçları ve Dersler', 'Önümüzdeki 7 Gün İçin Adımlar', 'Verinin Sınırları'];
const phaseLabels: Record<string, string> = {
  'sinav-tarihi-belirsiz': 'Sınav tarihi belirtilmemiş',
  'temel-ve-duzen': 'Temel ve düzen',
  'konu-ve-ilk-denemeler': 'Konu çalışması ve ilk denemeler',
  'deneme-ve-hedefli-tekrar': 'Deneme ve hedefli tekrar',
  'sinav-provalari': 'Sınav provaları',
  'son-hafta': 'Son hafta',
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInsightReport(value: unknown): value is InsightReport {
  return isObject(value) && value.schema_version === 3 && insightKeys.every(key => {
    const item = value[key];
    return isObject(item) && typeof item.headline === 'string' && typeof item.text === 'string'
      && Array.isArray(item.evidence_ids) && (typeof item.course_id === 'string' || item.course_id === null);
  });
}

function isLegacyReport(value: unknown): value is LegacyReport {
  return isObject(value) && value.schema_version === 2 && typeof value.overview === 'string'
    && ['study_observations', 'result_observations', 'next_actions'].every(key =>
      Array.isArray(value[key]) && value[key].every((item: unknown) => isObject(item) && typeof item.text === 'string'))
    && Array.isArray(value.limitations) && value.limitations.every((item: unknown) => typeof item === 'string');
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function chartWidth(value: number, maximum: number) {
  return `${maximum > 0 ? Math.max(0, Math.min(100, value / maximum * 100)) : 0}%`;
}

function minutesLabel(seconds: number) {
  return new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 1}).format(seconds / 60);
}

function dayChartLabel(day: {seconds: number | null; status: string}) {
  if (day.status === 'rest') return 'Dinlenme günü';
  if (day.seconds !== null) return `${minutesLabel(day.seconds)} dakika`;
  if (day.status === 'ongoing') return 'Gün devam ediyor';
  return 'Çalışma süresi kaydı yok';
}

function ChartUnavailable() {
  return <p className={styles.chartUnavailable}>Grafik için yeterli kayıt yok.</p>;
}

function MetricBar({label, value, maximum, displayValue}: {label: string; value: number; maximum: number; displayValue?: string}) {
  return <div className={styles.metricBar}>
    <span>{label}</span><div className={styles.metricTrack} aria-hidden="true"><span style={{width: chartWidth(value, maximum)}}/></div>
    <strong>{displayValue ?? new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 1}).format(value)}</strong>
  </div>;
}

function ReportChart({kind, metrics, startDate, endDate}: {kind: InsightKey; metrics?: ReportMetrics; startDate: string; endDate: string}) {
  const periodDays = isDate(startDate) && isDate(endDate) ? (Date.parse(endDate) - Date.parse(startDate)) / 86400000 + 1 : 0;
  const content = (() => {
    if (kind === 'topics') {
      const value = metrics?.topics;
      if (!isCount(value?.completed) || !isCount(value?.progressed)) return <ChartUnavailable/>;
      const maximum = Math.max(value.completed, value.progressed);
      return <div className={styles.metricBars}>
        <MetricBar label="Tamamlanan" value={value.completed} maximum={maximum}/>
        <MetricBar label="İlerleyen (bitenler dahil)" value={value.progressed} maximum={maximum}/>
      </div>;
    }
    if (kind === 'regularity') {
      const days = metrics?.regularity?.days;
      if (!Array.isArray(days) || days.length === 0 || !days.every(day =>
        isObject(day) && typeof day.date === 'string' && isDate(day.date)
        && typeof day.status === 'string' && (day.seconds === null || isCount(day.seconds)))) return <ChartUnavailable/>;
      const maximum = Math.max(...days.map(day => day.seconds ?? 0));
      return <div className={styles.dailyChart}>{days.map(day => <div className={styles.dayColumn} key={day.date} role="group" aria-label={`${dateLabel(day.date)}: ${dayChartLabel(day)}`} title={`${dateLabel(day.date)}: ${dayChartLabel(day)}`}>
        <span className={styles.dayValue} aria-hidden="true">{day.status === 'rest' ? 'Din.' : day.seconds === null ? '—' : minutesLabel(day.seconds)}</span>
        <span className={styles.dayTrack} aria-hidden="true"><span style={{height: chartWidth(day.seconds ?? 0, maximum)}}/></span>
        <span className={styles.dayLabel} aria-hidden="true">{new Intl.DateTimeFormat('tr-TR', {weekday: 'short', timeZone: 'UTC'}).format(new Date(`${day.date}T12:00:00Z`))}</span>
      </div>)}</div>;
    }
    if (kind === 'journal') {
      const count = metrics?.journal?.shared_day_count;
      if (!isCount(count) || periodDays <= 0) return <ChartUnavailable/>;
      return <div className={styles.singleMetric}><strong>{count} <span>/ {periodDays} gün</span></strong><div className={styles.metricTrack} aria-hidden="true"><span style={{width: chartWidth(count, periodDays)}}/></div></div>;
    }
    if (kind === 'wins') {
      const current = metrics?.wins?.current, previous = metrics?.wins?.previous;
      if (!isCount(current?.study_seconds) || !isCount(previous?.study_seconds) || !isCount(current?.observed_days) || !isCount(previous?.observed_days)
        || current.observed_days === 0 || previous.observed_days === 0) return <ChartUnavailable/>;
      const maximum = Math.max(current.study_seconds, previous.study_seconds);
      return <div className={styles.metricBars}>
        <MetricBar label={`Bu dönem · ${current.observed_days} kayıtlı gün`} value={current.study_seconds} maximum={maximum} displayValue={`${minutesLabel(current.study_seconds)} dk`}/>
        <MetricBar label={`Önceki dönem · ${previous.observed_days} kayıtlı gün`} value={previous.study_seconds} maximum={maximum} displayValue={`${minutesLabel(previous.study_seconds)} dk`}/>
      </div>;
    }
    if (kind === 'improvements') {
      const value = metrics?.improvements;
      if (!isCount(value?.task_done) || !isCount(value?.task_count) || value.task_count === 0) return <ChartUnavailable/>;
      return <div className={styles.singleMetric}><strong>{value.task_done} <span>/ {value.task_count} görev</span></strong><div className={styles.metricTrack} aria-hidden="true"><span style={{width: chartWidth(value.task_done, value.task_count)}}/></div></div>;
    }
    const timing = metrics?.timing;
    if (!isCount(timing?.month) || !Number.isInteger(timing.month) || timing.month < 1 || timing.month > 12) return <ChartUnavailable/>;
    return <div className={styles.monthChart}>
      <div className={styles.monthTrack} aria-hidden="true">{Array.from({length: 12}, (_, index) => <span key={index} className={index + 1 === timing.month ? styles.monthActive : undefined}/>)}</div>
      <div className={styles.monthLabels}><span>Ocak</span><strong>{new Intl.DateTimeFormat('tr-TR', {month: 'long', timeZone: 'UTC'}).format(new Date(Date.UTC(2026, timing.month - 1, 1)))}</strong><span>Aralık</span></div>
      {timing.phase && <p className={styles.phaseLabel}>{phaseLabels[timing.phase] ?? timing.phase}</p>}
    </div>;
  })();
  const captions: Record<InsightKey, string> = {
    topics: 'Konu kayıtları', regularity: 'Son günlerde çalışma · dakika', journal: 'Analize alınan günlük günleri',
    wins: 'Kayıtlı çalışma süresi', improvements: 'Tamamlanan görevler', timing: 'Önerinin hazırlandığı ay',
  };
  return <figure className={styles.reportChart} data-testid={`report-chart-${kind}`}><figcaption>{captions[kind]}</figcaption>{content}</figure>;
}

function ReportInsights({report, summary, startDate, endDate}: {report: InsightReport; summary?: ReportSummary; startDate: string; endDate: string}) {
  const sources = (Array.isArray(summary?.guidance_sources) ? summary.guidance_sources : [])
    .filter(source => source && typeof source.title === 'string' && typeof source.url === 'string' && /^https:\/\//i.test(source.url));
  return <div className={styles.reportInsights}>{insightKeys.map((key, index) => {
    const Icon = insightIcons[index];
    const item = report[key];
    return <section key={key} className={styles.insightCard} data-testid={`report-insight-${key}`}>
      <div className={styles.insightTop}><span className={styles.insightNumber}>{String(index + 1).padStart(2, '0')}</span><h4>{REPORT_HEADINGS[index]}</h4><Icon size={17} aria-hidden="true"/></div>
      <strong className={styles.insightHeadline}>{item.headline}</strong>
      <p className={styles.insightText}>{item.text}</p>
      <ReportChart kind={key} metrics={summary?.report_metrics} startDate={startDate} endDate={endDate}/>
      {key === 'timing' && sources.length > 0 && <div className={styles.guidanceSources}><strong>Dayanaklar</strong><div>{sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<ArrowRight size={12} aria-hidden="true"/></a>)}</div>{summary?.guidance_as_of && isDate(summary.guidance_as_of) && <small>Öneri tarihi: {dateLabel(summary.guidance_as_of)}</small>}</div>}
    </section>;
  })}</div>;
}

function LegacyReportCards({report}:{report:LegacyReport}) {
  const sections=[[report.overview],report.study_observations.map(x=>x.text),report.result_observations.map(x=>x.text),report.next_actions.map(x=>x.text),report.limitations];
  return <div className={styles.fiveCards}>{sections.map((items,index)=><section key={legacyHeadings[index]} className={styles.reportSection}>
    <h4>{legacyHeadings[index]}</h4>{items.length?items.map((text,i)=><p key={i}>{text}</p>):<p>Bu başlık için yeterli kayıt yok.</p>}
  </section>)}</div>;
}

export function Analysis({onOpenDay,journalAnalysisEnabled}: {onOpenDay: (date: string) => void;journalAnalysisEnabled: boolean}) {
  const day = localDate();
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<Action['action'] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [startDate, setStartDate] = useState(shiftDate(day, -13));
  const [endDate, setEndDate] = useState(day);
  const retryIds = useRef(new Map<string, string>());

  const applyData = (incoming: AnalysisResponse) => {
    setData(incoming);
  };

  const load = async () => {
    setRefreshing(true);
    setError('');
    try {
      applyData(await fetchAnalysis());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Analiz bilgileri yüklenemedi.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void fetchAnalysis(controller.signal).then(incoming => {
      if (controller.signal.aborted) return;
      setData(incoming);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Analiz bilgileri yüklenemedi.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  const submit = async (action: Action) => {
    if (busyAction) return;
    const fingerprint = JSON.stringify(action);
    const requestId = retryIds.current.get(fingerprint) ?? crypto.randomUUID();
    retryIds.current.set(fingerprint, requestId);
    setBusyAction(action.action);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/analysis', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...action, request_id: requestId}),
      });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== 'object' || !('ok' in body) || body.ok !== true) {
        if (response.status < 500) retryIds.current.delete(fingerprint);
        throw new Error(responseError(body, 'İşlem tamamlanamadı.'));
      }
      retryIds.current.delete(fingerprint);
      applyData(body as AnalysisResponse);
      setMessage(action.action === 'report' ? 'Rapor isteği kaydedildi. Güncel durumu aşağıda görebilirsin.' : 'İki haftalık rapor ayarı kaydedildi.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'İşlem tamamlanamadı.');
    } finally {
      setBusyAction(null);
    }
  };

  const rangeValid = isDate(startDate) && isDate(endDate) && startDate <= endDate && endDate <= day
    && [7,14,30].includes((Date.parse(endDate) - Date.parse(startDate)) / 86400000 + 1);
  const requestsLimit = data?.limits.monthly_requests ?? 0;
  const requestsUsed = data?.used.requests ?? 0;
  const costUsed = data?.used.estimated_cost_usd ?? null;

  return <div className={styles.workspace}>
    <section className={styles.hero} aria-labelledby="analysis-intro-title">
      <div className={styles.heroIcon}><Sparkles size={24} aria-hidden="true"/></div>
      <div>
        <p className={styles.eyebrow}>KAYITLARINDAN GÖZLEMLER</p>
        <h2 id="analysis-intro-title">Dönemini birlikte incele.</h2>
        <p>Çalışma süren, görevlerin ve denemelerin seçtiğin dönem için değerlendirilir. {journalAnalysisEnabled?'Günlük metnin ve doldurduğun alanlar da analize eklenir.':'Günlük içeriği hesap ayarında kapalı olduğu için analize eklenmez.'}</p>
      </div>
      <span className={styles.heroAccent} aria-hidden="true"/>
    </section>

    {error && <div className={styles.alert} role="alert"><AlertCircle size={18} aria-hidden="true"/><span>{error}</span></div>}
    {message && <div className={styles.success} role="status"><Check size={18} aria-hidden="true"/><span>{message}</span></div>}
    {loading && <div className={styles.loading} role="status">Analiz durumu yükleniyor…</div>}
    {!loading && !data && <button type="button" className={styles.secondaryButton} onClick={() => void load()} disabled={refreshing}>Yeniden dene</button>}

    {!loading && data && <>
      <div className={styles.statusGrid}>
        <section className={styles.statusCard} aria-label="Yapay zekâ bağlantı durumu">
          <div className={styles.cardTop}><span className={styles.cardIcon}><Sparkles size={18} aria-hidden="true"/></span><h3>Yapay zekâ analizi</h3><span className={`${styles.pill} ${data.configured ? styles.ready : styles.waiting}`}>{data.configured ? 'Sunucu ayarlı' : 'Kurulum bekliyor'}</span></div>
          <p>{data.configured ? `Model ayarı: ${data.model ?? 'belirtilmedi'}. Model erişimi ilk gerçek istekte sınanır.` : 'Sunucuda OpenAI anahtarı ve model ayarı henüz tamamlanmadı. Kayıtların bu sırada normal çalışır.'}</p>
        </section>
        <section className={styles.statusCard} aria-label="Aylık kullanım">
          <div className={styles.cardTop}><span className={styles.cardIcon}><CircleHelp size={18} aria-hidden="true"/></span><h3>Kullanım sınırı</h3><span className={styles.mutedBadge}>Bu ay</span></div>
          <div className={styles.usageLine}><span>İstek</span><strong>{requestsUsed} / {requestsLimit}</strong></div>
          <div className={styles.meter} role="progressbar" aria-label="Aylık istek kullanımı" aria-valuenow={requestsUsed} aria-valuemin={0} aria-valuemax={Math.max(requestsLimit, 1)}><span style={{width: `${requestsLimit > 0 ? Math.min(100, requestsUsed / requestsLimit * 100) : 0}%`}}/></div>
          <div className={styles.usageLine}><span>Tahmini API maliyeti</span><strong>{costUsed === null ? 'Hesaplanamadı' : usd(costUsed)}</strong></div>
        </section>
      </div>

      <div className={styles.actionGrid}>
        <section className={styles.actionCard} aria-labelledby="manual-report-title">
          <div className={styles.sectionHeader}><span className={styles.sectionIcon}><FileText size={19} aria-hidden="true"/></span><div><p className={styles.eyebrow}>İSTEĞE BAĞLI</p><h3 id="manual-report-title">Dönem raporu</h3></div></div>
          <p className={styles.cardDescription}>İncelemek istediğin tarih aralığını seç. Altı başlık tek raporda hazırlanır; yeni analiz isteği API kullanımı doğurabilir.</p>
          <form className={styles.dateForm} onSubmit={event => {event.preventDefault(); if (rangeValid) void submit({action: 'report', start_date: startDate, end_date: endDate});}}>
            <label>Rapor dönemi<select value={Math.round((Date.parse(endDate)-Date.parse(startDate))/86400000)+1} onChange={event=>{setEndDate(day);setStartDate(shiftDate(day,1-Number(event.target.value)));}}>{[7,14,30].map(days=><option key={days} value={days}>Son {days} gün</option>)}</select></label>
            <label>Başlangıç<input type="date" value={startDate} max={endDate || day} onChange={event => setStartDate(event.target.value)} required/></label>
            <label>Bitiş<input type="date" value={endDate} min={startDate || undefined} max={day} onChange={event => setEndDate(event.target.value)} required/></label>
            {!rangeValid && <p className={styles.formHint} role="alert">7, 14 veya 30 günlük bir tarih aralığı seç.</p>}
            <button className={styles.primaryButton} type="submit" disabled={!data.configured || !rangeValid || busyAction !== null}>{busyAction === 'report' ? 'Rapor hazırlanıyor…' : 'Rapor oluştur'}<ArrowRight size={16} aria-hidden="true"/></button>
          </form>
        </section>
      </div>

      <section className={styles.history} aria-labelledby="report-history-title">
        <div className={styles.historyHeader}><div><p className={styles.eyebrow}>KAYITLI SONUÇLAR</p><h3 id="report-history-title">Rapor geçmişi <span>{data.reports.length}</span></h3></div><button type="button" className={styles.refreshButton} onClick={() => void load()} disabled={refreshing || busyAction !== null}><RefreshCw size={16} aria-hidden="true"/> {refreshing ? 'Yenileniyor…' : 'Yenile'}</button></div>
        {data.reports.length === 0 ? <div className={styles.emptyHistory}><FileText size={25} aria-hidden="true"/><strong>Henüz rapor yok</strong><p>İlk dönem raporunu oluşturduğunda sonucu ve geçmişini burada göreceksin.</p></div>
          : <div className={styles.reportList}>{data.reports.map(report => <details className={styles.reportCard} key={report.id} >
            <summary><span className={styles.reportMarker}><FileText size={17} aria-hidden="true"/></span><span className={styles.reportTitle}><strong>{dateLabel(report.start_date)} – {dateLabel(report.end_date)}</strong><small>{new Intl.DateTimeFormat('tr-TR', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul'}).format(new Date(report.created_at))}</small></span><span className={`${styles.pill} ${report.status === 'completed' ? styles.ready : report.status === 'failed' ? styles.failed : styles.waiting}`}>{report.status === 'completed' ? 'Tamamlandı' : report.status === 'failed' ? 'Hata' : report.status === 'uncertain' ? 'Kontrol gerekli' : 'Hazırlanıyor'}</span></summary>
            <div className={styles.reportBody}>
              {report.stale && <p className={styles.staleNotice}><AlertCircle size={16} aria-hidden="true"/>Bu rapordan sonra kayıtların değişti; yorumlar artık güncel olmayabilir.</p>}
              {report.summary && <div className={styles.reportFacts}>{typeof report.summary.data_days === 'number' && <span>Verili gün: <strong>{report.summary.data_days}</strong></span>}{typeof report.summary.missing_days === 'number' && <span>Eksik gün: <strong>{report.summary.missing_days}</strong></span>}</div>}
              {report.status === 'failed' && <p className={styles.failedText}>{report.error_message || 'Rapor hazırlanamadı. Durumu daha sonra yenileyebilirsin.'}</p>}
              {report.status === 'uncertain' && <p className={styles.failedText}>Son isteğin sonucu doğrulanamadı. Yeni ücretli istek gönderilmez; destek için işlem durumunu kontrol et.</p>}
              {(report.status === 'running' || report.status === 'pending') && <p className={styles.runningText}>Rapor sunucuda hazırlanıyor. Bir süre sonra yenile.</p>}
              {typeof report.summary?.record_count==='number'&&<p>Hesaplanan kayıt sayısı: {report.summary.record_count}</p>}
              {report.status === 'completed' && (isInsightReport(report.summary?.structured_report)
                ? <ReportInsights report={report.summary.structured_report} summary={report.summary} startDate={report.start_date} endDate={report.end_date}/>
                : isLegacyReport(report.summary?.structured_report)
                  ? <LegacyReportCards report={report.summary.structured_report}/>
                  : report.body && <ReportText body={report.body} sourceDays={report.summary?.source_days ?? []} onOpenDay={onOpenDay}/>)}
              {Boolean(report.summary?.source_days?.length) && <div className={styles.sourceDays}><strong>Kaynak günler</strong><div>{report.summary?.source_days?.map(sourceDay => <button key={sourceDay} type="button" onClick={() => onOpenDay(sourceDay)}>{dateLabel(sourceDay)} <ArrowRight size={12} aria-hidden="true"/></button>)}</div></div>}
              {report.usage && <p className={styles.reportUsage}>API kullanımı: {report.usage.input_tokens.toLocaleString('tr-TR')} giriş + {report.usage.output_tokens.toLocaleString('tr-TR')} çıkış tokenı{report.usage.estimated_cost_usd !== null ? ` · yaklaşık ${usd(report.usage.estimated_cost_usd)}` : ' · maliyet hesaplanamadı'}</p>}
            </div>
          </details>)}</div>}
      </section>
    </>}
  </div>;
}
