'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowDownToLine, ArrowUpRight, ChevronDown, ChevronRight, FileText, House, RefreshCw} from 'lucide-react';
import {agentHouseReportMaxBytes, agentHouseReportSchema, type AgentHouseAgentId, type AgentHouseRuns, type AgentHouseMode} from '@/lib/agent-house';
import {AgentHouseScene} from './agent-house-scene';
import {AgentHouseReport} from './agent-house-report';
import {agentRooms, reportDate} from './agent-house-meta';
import {Analysis} from './analysis';
import styles from './agent-house.module.css';

const emptyRuns: AgentHouseRuns = {live: [], sample: []};
const statusLabels = {ready: 'Rapor hazır', no_data: 'Veri bekliyor', skipped: 'Bu akışta çalışmadı'};
const roomOrder: AgentHouseAgentId[] = ['leader', 'daily', 'strategy', 'tracking', 'awareness', 'discovery'];

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
  const [showHouse, setShowHouse] = useState(true);
  const house = useRef<HTMLDetailsElement>(null);
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
  const room = agentRooms[selected];
  const RoomIcon = room.icon;
  const readyIds = report?.agents.filter(item => item.status === 'ready').map(item => item.id) ?? [];

  const selectRoom = (id: AgentHouseAgentId) => {
    setSelected(id);
    setShowHouse(false);
    requestAnimationFrame(() => heading.current?.focus());
  };
  const returnToHouse = () => {
    setShowHouse(true);
    requestAnimationFrame(() => {
      const buttons = house.current?.querySelectorAll<HTMLButtonElement>(`[data-room-id="${selected}"]`);
      Array.from(buttons ?? []).find(button => button.getClientRects().length > 0)?.focus();
    });
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
    <div className={styles.studioBar}>
      <div className={styles.studioLabel}><span className={styles.studioMark}><House size={19} aria-hidden="true"/></span><div><strong>{report ? `${reportDate(report.week_start)} haftası` : 'Kişisel çalışma stüdyon'}</strong><span>{report ? `${report.agents.length} oda · Tek bir bakış` : 'Ekibinle bir sonraki adımını bul'}</span></div></div>
      <button type="button" className={styles.refresh} disabled={loading} onClick={() => void load()}><RefreshCw size={16} aria-hidden="true" className={loading ? styles.spinning : ''}/>{loading ? 'Yükleniyor' : 'Yenile'}</button>
    </div>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    <div className={styles.toolbar}>
      <div className={styles.modes} aria-label="Rapor türü">{(['live', 'sample'] as const).map(value => <button type="button" key={value} aria-pressed={activeMode === value} onClick={() => {setMode(value); setRunId('');}}>{value === 'live' ? 'Benim raporlarım' : 'Örnek akış'}</button>)}</div>
      {available.length > 0 && <label className={styles.history}>Rapor<select value={report?.run_id ?? ''} onChange={event => setRunId(event.target.value)}>{available.map(run => <option key={run.run_id} value={run.run_id}>{reportDate(run.week_start)} haftası · {reportDate(run.generated_at, true)}</option>)}</select></label>}
    </div>
    {activeMode === 'sample' && <p className={styles.sampleNotice}><span>ÖRNEK VERİ</span> Bu bölüm, ajan akışının nasıl göründüğünü gösterir. Kişisel çalışma kaydın değildir.</p>}
    <details ref={house} className={styles.house} open={showHouse} onToggle={event => setShowHouse(event.currentTarget.open)}>
      <summary><span className={styles.housePreview} aria-hidden="true"><House size={29}/><i/><i/><i/></span><span><strong>Ajan evin</strong><small>Bir odaya dokun, ajanının raporunu aç.</small></span><span className={styles.houseReady}>{readyIds.length} odada rapor hazır</span><ChevronDown size={20} aria-hidden="true"/></summary>
      {showHouse && <AgentHouseScene selected={selected} onSelect={selectRoom} readyIds={readyIds}/>}
    </details>
    <div className={styles.studio}>
      <aside className={styles.roomRail} aria-label="Ajan evinin odaları">
        <div className={styles.railHeading}><span>EKİBİN</span><span>{roomOrder.length} oda</span></div>
        <nav className={styles.roomNav} aria-label="Ajan odaları">{roomOrder.map(id => {
          const info = agentRooms[id]; const Icon = info.icon; const data = report?.agents.find(item => item.id === id);
          return <button type="button" key={id} data-room-id={id} data-room={id} aria-label={`${info.name} odası`} aria-pressed={selected === id} onClick={() => selectRoom(id)}>
            <span className={styles.roomIcon}><Icon size={21} aria-hidden="true"/></span><span className={styles.roomText}><strong>{info.name}</strong><small>{info.short}</small></span><span className={styles.roomDot} data-ready={data?.status === 'ready'} aria-label={data ? statusLabels[data.status] : 'Rapor bekliyor'}/><ChevronRight className={styles.roomArrow} size={15} aria-hidden="true"/>
          </button>;
        })}</nav>
        <div className={styles.railNote}><span className={styles.noteLine}/><p>Bir oda seç.<br/><strong>Kendine yeni bir açıdan bak.</strong></p></div>
      </aside>
      <section className={styles.report} data-room={selected} aria-labelledby="agent-report-heading" data-testid="agent-room-report">
        <div className={styles.reportTopline}>
          <button type="button" onClick={returnToHouse}><House size={16} aria-hidden="true"/>Eve dön</button>
          <span className={styles.status} data-status={agent?.status ?? 'waiting'}><i aria-hidden="true"/>{agent ? statusLabels[agent.status] : loading ? 'Yükleniyor' : 'Rapor bekliyor'}</span>
        </div>
        <header className={styles.reportHeader}>
          <div className={styles.reportTitle}><span className={styles.reportAvatar}><RoomIcon size={27} aria-hidden="true"/></span><div><span className={styles.eyebrow}>{room.name}</span><h2 ref={heading} tabIndex={-1} id="agent-report-heading">{room.title}</h2></div></div>
        </header>
        <p className={styles.reportDescription}>{room.description}</p>
        {agent ? <AgentHouseReport key={`${activeMode}:${report?.run_id}:${selected}`} agent={agent}/> : loading ? <div className={styles.skeleton} role="status" aria-label="Raporlar getiriliyor"><span/><span/><span/><div/><span/><span/></div> : <div className={styles.empty}><span><FileText size={28} aria-hidden="true"/></span><h3>Bu odanın raporu henüz gelmedi</h3><p>Liderle konuşup bir değerlendirme veya program hazırlattığında, buraya kaydedilen sonucu bu odada göreceksin.</p>{activeMode === 'live' && runs.sample.length > 0 && <button type="button" onClick={() => {setMode('sample'); setRunId('');}}>Örnek akışı incele <ArrowUpRight size={17} aria-hidden="true"/></button>}</div>}
        {agent && <footer className={styles.reportFooter}><FileText size={15} aria-hidden="true"/><span>{report?.title}<br/><time>{report && reportDate(report.generated_at, true)}</time></span></footer>}
      </section>
    </div>
    <div className={styles.utilities}>
      <button type="button" aria-expanded={showLegacy} aria-controls="previous-analysis" onClick={() => setShowLegacy(!showLegacy)}><FileText size={16} aria-hidden="true"/>Çalışma ölçütleri ve önceki analizler<ChevronDown size={15} aria-hidden="true"/></button>
      <details className={styles.import}><summary><ArrowDownToLine size={16} aria-hidden="true"/>Hazır rapor aktar</summary><p>Liderin hazırladığı rapor dosyasını hesabına ekleyebilirsin.</p><label>{importing ? 'Kaydediliyor…' : 'Rapor dosyasını seç'}<input type="file" accept="application/json,.json" aria-label="Rapor dosyasını seç" disabled={importing} onChange={event => {const file = event.target.files?.[0]; if (file) void importReport(file); event.target.value = '';}}/></label></details>
    </div>
    {showLegacy && <section id="previous-analysis" className={styles.legacy}><h2>Çalışma ölçütleri ve önceki analizler</h2><Analysis {...props}/></section>}
  </div>;
}
