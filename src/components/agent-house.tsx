'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowDownToLine, ArrowUpRight, BookOpen, CalendarDays, ChevronDown, FileText, RefreshCw} from 'lucide-react';
import {agentHouseReportMaxBytes, agentHouseReportSchema, type AgentHouseAgentId, type AgentHouseRuns, type AgentHouseMode} from '@/lib/agent-house';
import {AgentHouseScene} from './agent-house-scene';
import {Analysis} from './analysis';
import styles from './agent-house.module.css';

const rooms: Record<AgentHouseAgentId, {name: string; title: string; description: string}> = {
  leader: {name: 'Lider', title: 'Büyük resim', description: 'Ekibin ortak değerlendirmesi, önceliklerin ve atacağın ilk adım.'},
  strategy: {name: 'YKS Stratejisti', title: 'Çalışmanın yönü', description: 'Hangi konuyu, neden ve nasıl çalışacağın; haftanın hedefleri ve dayanakları.'},
  tracking: {name: 'YKSİM Takipçisi', title: 'İlerlemenin kaydı', description: 'Çalışma sürelerin, konu ilerlemen ve denemelerin. Eksik kayıtlar ayrıca belirtilir.'},
  awareness: {name: 'Öz Farkındalık', title: 'Kendi ritmini keşfet', description: 'Odak, dinlenme ve günlük düzen için sana sunulan gözlemler ve küçük denemeler.'},
  daily: {name: 'Günlük Rehber', title: 'Günün akışı', description: 'Derslerin ve diğer işlerin, uygun saatlerine yerleştirilmiş hâli.'},
  discovery: {name: 'Keşif', title: 'Yeni bir pencere', description: 'Sana uygun fikirler, kaynaklar ve fırsatlar; neden seçildikleriyle birlikte.'},
};
const emptyRuns: AgentHouseRuns = {live: [], sample: []};
const statusLabels = {ready: 'Rapor hazır', no_data: 'Veri bekliyor', skipped: 'Bu akışta çalışmadı'};

function date(value: string, time = false) {
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium', ...(time ? {timeStyle: 'short' as const} : {}), timeZone: 'Europe/Istanbul',
  }).format(parsed) : value;
}

function responseError(body: unknown) {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = body.error;
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  }
  return 'Raporlara şu anda ulaşılamıyor. Yeniden deneyebilirsin.';
}

function parseRuns(value: unknown): AgentHouseRuns {
  if (!value || typeof value !== 'object' || !('runs' in value)) throw new Error('Rapor yanıtı okunamadı.');
  const candidate = value.runs;
  if (!candidate || typeof candidate !== 'object') throw new Error('Rapor yanıtı okunamadı.');
  const parsed: AgentHouseRuns = {live: [], sample: []};
  for (const mode of ['live', 'sample'] as const) {
    if (!(mode in candidate) || !Array.isArray(candidate[mode as keyof typeof candidate])) throw new Error('Rapor listesi okunamadı.');
    for (const item of candidate[mode as keyof typeof candidate] as unknown[]) {
      const report = agentHouseReportSchema.parse(item);
      if (report.mode !== mode) throw new Error('Raporun veri türü doğrulanamadı.');
      parsed[mode].push(report);
    }
  }
  return parsed;
}

export function AgentHouse(props: Parameters<typeof Analysis>[0]) {
  const [runs, setRuns] = useState<AgentHouseRuns>(emptyRuns);
  const [mode, setMode] = useState<AgentHouseMode | null>(null);
  const [runId, setRunId] = useState('');
  const [selected, setSelected] = useState<AgentHouseAgentId>('leader');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [importing, setImporting] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/agent-house', {cache: 'no-store', signal: controller.signal});
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(responseError(body));
      const incoming = parseRuns(body);
      if (!controller.signal.aborted) setRuns(incoming);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Raporlar yüklenemedi.');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    void fetch('/api/agent-house', {cache: 'no-store', signal: controller.signal})
      .then(async response => {
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(responseError(body));
        return parseRuns(body);
      }).then(incoming => {if (!controller.signal.aborted) setRuns(incoming);})
      .catch(cause => {if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Raporlar yüklenemedi.');})
      .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => request.current?.abort();
  }, []);
  const activeMode = mode ?? (runs.live.length ? 'live' : runs.sample.length ? 'sample' : 'live');
  const available = runs[activeMode];
  const report = available.find(run => run.run_id === runId) ?? available[0];
  const agent = report?.agents.find(item => item.id === selected);
  const room = rooms[selected];
  const readyIds = report?.agents.filter(item => item.status === 'ready').map(item => item.id) ?? [];

  const selectRoom = (id: AgentHouseAgentId) => {
    setSelected(id);
    requestAnimationFrame(() => heading.current?.focus({preventScroll: true}));
  };
  const importReport = async (file: File) => {
    setImporting(true); setNotice(''); setError('');
    try {
      if (file.size > agentHouseReportMaxBytes) throw new Error('Rapor dosyası 128 KB sınırını aşıyor.');
      const parsed = agentHouseReportSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error('Bu dosya geçerli bir Ajan Evi raporu değil.');
      const response = await fetch('/api/agent-house', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(parsed.data)});
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(responseError(body));
      const saved = agentHouseReportSchema.safeParse(body && typeof body === 'object' && 'run' in body ? body.run : null);
      if (!saved.success || saved.data.run_id !== parsed.data.run_id || saved.data.mode !== parsed.data.mode) throw new Error('Raporun kaydı doğrulanamadı. Yenile ile kontrol edebilirsin.');
      request.current?.abort();
      setLoading(false);
      const incoming = saved.data;
      setRuns(previous => ({...previous, [incoming.mode]: [incoming, ...previous[incoming.mode].filter(run => run.run_id !== incoming.run_id)]}));
      setMode(incoming.mode); setRunId(incoming.run_id);
      setNotice('Rapor hesabına kaydedildi. Odalardan inceleyebilirsin.');
    } catch (cause) {setError(cause instanceof SyntaxError ? 'Dosya okunamadı. Geçerli bir rapor dosyası seç.' : cause instanceof Error ? cause.message : 'Rapor kaydedilemedi.');}
    finally {setImporting(false);}
  };

  return <div className={styles.workspace} data-testid="agent-house">
    <header className={styles.intro}>
      <div><span className={styles.eyebrow}>SANA AİT BİR ÇALIŞMA ALANI</span><p>Her odada, hayatının bir alanına açılan bir pencere.</p></div>
      <button type="button" className={styles.refresh} disabled={loading} onClick={() => void load()}><RefreshCw size={15} aria-hidden="true"/>{loading ? 'Yükleniyor' : 'Yenile'}</button>
    </header>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    <div className={styles.toolbar}>
      <div className={styles.modes} aria-label="Rapor türü">{(['live', 'sample'] as const).map(value => <button type="button" key={value} aria-pressed={activeMode === value} onClick={() => {setMode(value); setRunId('');}}>{value === 'live' ? 'Benim raporlarım' : 'Örnek akış'}</button>)}</div>
      {available.length > 0 && <label className={styles.history}>Rapor<select value={report?.run_id ?? ''} onChange={event => setRunId(event.target.value)}>{available.map(run => <option key={run.run_id} value={run.run_id}>{date(run.week_start)} haftası · {date(run.generated_at, true)}</option>)}</select></label>}
    </div>
    {activeMode === 'sample' && <p className={styles.sampleNotice}><span>ÖRNEK VERİ</span> Bu bölüm, ajan akışının nasıl göründüğünü gösterir. Kişisel çalışma kaydın değildir.</p>}
    <section className={styles.house} aria-label="Ajan evinin odaları">
      <div className={styles.houseHeading}><span>EVİM</span><span>İncelemek için bir odaya dokun</span></div>
      <AgentHouseScene selected={selected} onSelect={selectRoom} readyIds={readyIds}/>
      <div className={styles.houseFoot}><span><i aria-hidden="true"/>{readyIds.length} odada rapor hazır</span><span>{report ? `${date(report.week_start)} haftası` : 'İlk raporun için hazır'}</span></div>
    </section>
    <section className={styles.report} aria-labelledby="agent-report-heading" data-testid="agent-room-report">
      <header className={styles.reportHeader}><div><span className={styles.eyebrow}>{room.name}</span><h2 ref={heading} tabIndex={-1} id="agent-report-heading">{room.title}</h2><p>{room.description}</p></div><span className={styles.status}>{agent ? statusLabels[agent.status] : loading ? 'Yükleniyor' : 'Rapor bekliyor'}</span></header>
      {agent ? <>
        <div className={styles.summary}><p>{agent.summary}</p></div>
        {agent.recommendations.length > 0 && <section className={styles.recommendations}><h3>Öneriler ve sonraki adımlar</h3><ol>{agent.recommendations.map((item, index) => <li key={index}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><p>{item}</p></li>)}</ol></section>}
        {agent.schedule.length > 0 && <section className={styles.schedule}><h3><CalendarDays size={18} aria-hidden="true"/>Programın</h3>{[...new Set(agent.schedule.map(block => block.date))].sort().map(day => <div className={styles.scheduleDay} key={day}><h4>{date(day)}</h4><ol>{agent.schedule.filter(block => block.date === day).toSorted((a, b) => a.start.localeCompare(b.start)).map((block, index) => <li key={index}><time>{block.start}–{block.end}</time><div><strong>{block.title}</strong>{block.detail && <p>{block.detail}</p>}</div></li>)}</ol></div>)}</section>}
        {agent.tables.map((table, index) => <section className={styles.dataSection} key={index}><h3>{table.title}</h3><div className={styles.tableScroll} role="region" aria-label={table.title} tabIndex={0}><table><thead><tr>{table.columns.map((column, columnIndex) => <th key={columnIndex} scope="col">{column}</th>)}</tr></thead><tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>{!table.rows.length && <p className={styles.muted}>Bu tabloda henüz kayıt yok.</p>}</section>)}
        {agent.sources.length > 0 && <section className={styles.sources}><h3><BookOpen size={17} aria-hidden="true"/>Kaynaklar ve dayanaklar</h3><ul>{agent.sources.map((source, index) => <li key={index}>{source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<ArrowUpRight size={14} aria-hidden="true"/></a> : <strong>{source.title}</strong>}{source.note && <p>{source.note}</p>}</li>)}</ul></section>}
        <footer className={styles.reportFooter}><FileText size={14} aria-hidden="true"/><span>{report?.title} · {report && date(report.generated_at, true)}</span></footer>
      </> : <div className={styles.empty}><FileText size={25} aria-hidden="true"/><h3>{loading ? 'Raporlar getiriliyor…' : 'Bu odanın raporu henüz gelmedi'}</h3><p>Liderle konuşup bir değerlendirme veya program hazırlattığında, buraya kaydedilen sonucu bu odada göreceksin.</p>{!loading && activeMode === 'live' && runs.sample.length > 0 && <button type="button" onClick={() => {setMode('sample'); setRunId('');}}>Örnek akışı incele <ArrowUpRight size={15} aria-hidden="true"/></button>}</div>}
    </section>
    <div className={styles.utilities}>
      <button type="button" aria-expanded={showLegacy} aria-controls="previous-analysis" onClick={() => setShowLegacy(!showLegacy)}><FileText size={16} aria-hidden="true"/>Çalışma ölçütleri ve önceki analizler<ChevronDown size={15} aria-hidden="true"/></button>
      <details className={styles.import}><summary><ArrowDownToLine size={15} aria-hidden="true"/>Hazır rapor aktar</summary><p>Liderin hazırladığı rapor dosyasını hesabına ekleyebilirsin.</p><label>{importing ? 'Kaydediliyor…' : 'Rapor dosyasını seç'}<input type="file" accept="application/json,.json" aria-label="Rapor dosyasını seç" disabled={importing} onChange={event => {const file = event.target.files?.[0]; if (file) void importReport(file); event.target.value = '';}}/></label></details>
    </div>
    {showLegacy && <section id="previous-analysis" className={styles.legacy}><h2>Çalışma ölçütleri ve önceki analizler</h2><Analysis {...props}/></section>}
  </div>;
}
