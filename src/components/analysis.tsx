'use client';

import {useEffect, useRef, useState} from 'react';
import {AlertCircle, ArrowRight, Check, CircleHelp, FileText, RefreshCw, Sparkles} from 'lucide-react';
import {REPORT_HEADINGS,type StructuredReport} from '@/lib/ai-report';
import {formatDay, localDate} from '@/lib/ui';
import styles from './analysis.module.css';

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
  summary?: {source_days?: string[]; data_days?: number; missing_days?: number;record_count?:number;structured_report?:StructuredReport};
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

function ReportCards({report}:{report:StructuredReport}) {
  const sections=[[report.overview],report.study_observations.map(x=>x.text),report.result_observations.map(x=>x.text),report.next_actions.map(x=>x.text),report.limitations];
  return <div className={styles.fiveCards}>{sections.map((items,index)=><section key={REPORT_HEADINGS[index]} className={styles.reportSection}>
    <h4>{REPORT_HEADINGS[index]}</h4>{items.length?items.map((text,i)=><p key={i}>{text}</p>):<p>Bu başlık için yeterli kayıt yok.</p>}
  </section>)}</div>;
}

export function Analysis({onOpenDay}: {onOpenDay: (date: string) => void}) {
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
        <p>Çalışma süren, görevlerin, denemelerin ve analize izin verdiğin günlük alanları seçtiğin dönem için değerlendirilir.</p>
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
          <div className={styles.cardTop}><span className={styles.cardIcon}><Sparkles size={18} aria-hidden="true"/></span><span className={`${styles.pill} ${data.configured ? styles.ready : styles.waiting}`}>{data.configured ? 'Sunucu ayarlı' : 'Kurulum bekliyor'}</span></div>
          <h3>Yapay zekâ analizi</h3>
          <p>{data.configured ? `Model ayarı: ${data.model ?? 'belirtilmedi'}. Model erişimi ilk gerçek istekte sınanır.` : 'Sunucuda OpenAI anahtarı ve model ayarı henüz tamamlanmadı. Kayıtların bu sırada normal çalışır.'}</p>
        </section>
        <section className={styles.statusCard} aria-label="Aylık kullanım">
          <div className={styles.cardTop}><span className={styles.cardIcon}><CircleHelp size={18} aria-hidden="true"/></span><span className={styles.mutedBadge}>Bu ay</span></div>
          <h3>Kullanım sınırı</h3>
          <div className={styles.usageLine}><span>İstek</span><strong>{requestsUsed} / {requestsLimit}</strong></div>
          <div className={styles.meter} role="progressbar" aria-label="Aylık istek kullanımı" aria-valuenow={requestsUsed} aria-valuemin={0} aria-valuemax={Math.max(requestsLimit, 1)}><span style={{width: `${requestsLimit > 0 ? Math.min(100, requestsUsed / requestsLimit * 100) : 0}%`}}/></div>
          <div className={styles.usageLine}><span>Tahmini API maliyeti</span><strong>{costUsed === null ? 'Hesaplanamadı' : usd(costUsed)}</strong></div>
          <p className={styles.tinyNote}>ChatGPT aboneliğinden ayrı API kullanımıdır.</p>
          {data.resets_at&&<p className={styles.tinyNote}>Yenilenme: {new Intl.DateTimeFormat('tr-TR',{dateStyle:'long',timeZone:'Europe/Istanbul'}).format(new Date(data.resets_at))} · İstanbul saati</p>}
        </section>
      </div>

      <div className={styles.actionGrid}>
        <section className={styles.actionCard} aria-labelledby="manual-report-title">
          <div className={styles.sectionHeader}><span className={styles.sectionIcon}><FileText size={19} aria-hidden="true"/></span><div><p className={styles.eyebrow}>İSTEĞE BAĞLI</p><h3 id="manual-report-title">Dönem raporu</h3></div></div>
          <p className={styles.cardDescription}>İncelemek istediğin tarih aralığını seç. Yeni analiz isteği API kullanımı doğurabilir.</p>
          <form className={styles.dateForm} onSubmit={event => {event.preventDefault(); if (rangeValid) void submit({action: 'report', start_date: startDate, end_date: endDate});}}>
            <label>Rapor dönemi<select value={Math.round((Date.parse(endDate)-Date.parse(startDate))/86400000)+1} onChange={event=>{setEndDate(day);setStartDate(shiftDate(day,1-Number(event.target.value)));}}>{[7,14,30].map(days=><option key={days} value={days}>Son {days} gün</option>)}</select></label>
            <label>Başlangıç<input type="date" value={startDate} max={endDate || day} onChange={event => setStartDate(event.target.value)} required/></label>
            <label>Bitiş<input type="date" value={endDate} min={startDate || undefined} max={day} onChange={event => setEndDate(event.target.value)} required/></label>
            {!rangeValid && <p className={styles.formHint} role="alert">7, 14 veya 30 günlük bir tarih aralığı seç.</p>}
            <button className={styles.primaryButton} type="submit" disabled={!data.configured || !rangeValid || busyAction !== null}>{busyAction === 'report' ? 'Rapor hazırlanıyor…' : 'Rapor oluştur'}<ArrowRight size={16} aria-hidden="true"/></button>
          </form>
        </section>

        <section className={styles.actionCard}><h3>Kontrol sende</h3><p>Beş bölüm tek raporda hazırlanır ve bir AI kullanımı sayılır. Kayıtlı raporu tekrar açmak ücretsizdir. Arka planda rapor üretilmez.</p><p>Öneriler takvimine kendiliğinden görev eklemez.</p></section>
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
              {report.status==='completed'&&(report.summary?.structured_report?<ReportCards report={report.summary.structured_report}/>:report.body&&<ReportText body={report.body} sourceDays={report.summary?.source_days??[]} onOpenDay={onOpenDay}/>)}
              {Boolean(report.summary?.source_days?.length) && <div className={styles.sourceDays}><strong>Kaynak günler</strong><div>{report.summary?.source_days?.map(sourceDay => <button key={sourceDay} type="button" onClick={() => onOpenDay(sourceDay)}>{dateLabel(sourceDay)} <ArrowRight size={12} aria-hidden="true"/></button>)}</div></div>}
              {report.usage && <p className={styles.reportUsage}>API kullanımı: {report.usage.input_tokens.toLocaleString('tr-TR')} giriş + {report.usage.output_tokens.toLocaleString('tr-TR')} çıkış tokenı{report.usage.estimated_cost_usd !== null ? ` · yaklaşık ${usd(report.usage.estimated_cost_usd)}` : ' · maliyet hesaplanamadı'}</p>}
            </div>
          </details>)}</div>}
      </section>
    </>}
  </div>;
}
