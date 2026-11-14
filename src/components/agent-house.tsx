'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {Ellipsis, RefreshCw} from 'lucide-react';
import {agentHouseReportMaxBytes, agentHouseReportSchema, type AgentHouseAgentId, type AgentHouseRuns, type AgentHouseMode} from '@/lib/agent-house';
import {AgentHouseScene} from './agent-house-scene';
import {AgentHouseReport} from './agent-house-report';
import {AgentHouseRoom} from './agent-house-room';
import {reportDate} from './agent-house-meta';
import {Analysis} from './analysis';
import styles from './agent-house.module.css';

const emptyRuns: AgentHouseRuns = {live: [], sample: []};

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
  const [openRoom, setOpenRoom] = useState(false);
  const house = useRef<HTMLDivElement>(null);
  const options = useRef<HTMLDetailsElement>(null);
  const roomTrigger = useRef<HTMLButtonElement | null>(null);
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
  const readyIds = report?.agents.filter(item => item.status === 'ready').map(item => item.id) ?? [];

  const selectRoom = (id: AgentHouseAgentId) => {
    roomTrigger.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
    options.current?.removeAttribute('open');
    setSelected(id);
    setOpenRoom(true);
  };
  const returnToHouse = () => {
    setOpenRoom(false);
    requestAnimationFrame(() => {
      if (roomTrigger.current?.isConnected) {roomTrigger.current.focus(); return;}
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
      <div className={styles.tools}>
        <button type="button" className={styles.iconButton} aria-label="Yenile" title="Yenile" disabled={loading} onClick={() => void load()}><RefreshCw size={17} aria-hidden="true" className={loading ? styles.spinning : ''}/></button>
        <details ref={options} className={styles.options}>
          <summary aria-label="Ev seçenekleri" title="Ev seçenekleri"><Ellipsis size={22} aria-hidden="true"/></summary>
          <div className={styles.optionsPanel}>
            <span className={styles.weekLabel}>{report ? `${reportDate(report.week_start)} haftası` : 'Birlikte, adım adım.'}</span>
            <div className={styles.modes} aria-label="Rapor türü">{(['live', 'sample'] as const).map(value => <button type="button" key={value} aria-pressed={activeMode === value} onClick={() => {setMode(value); setRunId(''); options.current?.removeAttribute('open');}}>{value === 'live' ? 'Benim raporlarım' : 'Örnek akış'}</button>)}</div>
            {available.length > 0 && <label className={styles.history}>Rapor<select value={report?.run_id ?? ''} onChange={event => setRunId(event.target.value)}>{available.map(run => <option key={run.run_id} value={run.run_id}>{reportDate(run.week_start)} haftası · {reportDate(run.generated_at, true)}</option>)}</select></label>}
            <label className={styles.import}>{importing ? 'Kaydediliyor…' : 'Hazır rapor aktar'}<input type="file" accept="application/json,.json" aria-label="Rapor dosyasını seç" disabled={importing} onChange={event => {const file = event.target.files?.[0]; if (file) void importReport(file); event.target.value = '';}}/></label>
            <button type="button" aria-expanded={showLegacy} aria-controls="previous-analysis" onClick={() => setShowLegacy(!showLegacy)}>Önceki analizler</button>
          </div>
        </details>
      </div>
    </div>
    <div className={styles.messages}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {activeMode === 'sample' && <p className={styles.sampleNotice}>Örnek ev · Kişisel kayıtların değil.</p>}
    </div>
    <div ref={house} className={styles.house}>
      <AgentHouseScene selected={selected} onSelect={selectRoom} readyIds={readyIds} reduceMotion={openRoom}/>
      <p className={styles.houseHint}><span>Bir arkadaşına dokun, notunu oku.</span><span className={styles.panHint}>Diğer odalar için evi yana kaydır.</span></p>
    </div>
    {openRoom && <AgentHouseRoom selected={selected} sample={activeMode === 'sample'} onClose={returnToHouse}>
      {agent ? <AgentHouseReport key={`${activeMode}:${report?.run_id}:${selected}`} agent={agent}/> : loading ? <div className={styles.skeleton} role="status" aria-label="Raporlar getiriliyor"><span/><span/><span/></div> : <div className={styles.empty}><h3>Henüz bir not yok.</h3><p>Raporun hazır olduğunda burada olacak.</p></div>}
    </AgentHouseRoom>}
    {showLegacy && <section id="previous-analysis" className={styles.legacy}><h2>Önceki analizler</h2><Analysis {...props}/></section>}
  </div>;
}
