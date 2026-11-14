'use client';

import {useRef, useState, type KeyboardEvent} from 'react';
import {ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, CalendarDays, ChevronDown, FileText, Layers3, Sparkles} from 'lucide-react';
import type {AgentHouseAgent} from '@/lib/agent-house';
import {AgentHousePlan, planDays} from './agent-house-plan';
import styles from './agent-house.module.css';

type SectionId = 'overview' | 'plan' | 'data' | 'sources';
const sections = {overview: {label: 'Özet', icon: Sparkles}, plan: {label: 'Program', icon: CalendarDays}, data: {label: 'Veriler', icon: Layers3}, sources: {label: 'Kaynaklar', icon: BookOpen}};

function Summary({text, allowCollapse}: {text: string; allowCollapse: boolean}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = allowCollapse && text.length > 420;
  const boundary = text.lastIndexOf(' ', 360);
  return <div className={styles.summary}>
    <span className={styles.eyebrow}>AJANIN DEĞERLENDİRMESİ</span>
    <p>{collapsible && !expanded ? `${text.slice(0, boundary > 0 ? boundary : 360)}…` : text}</p>
    {collapsible && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Özeti daralt' : 'Değerlendirmenin tamamını oku'}<ChevronDown size={16} aria-hidden="true"/></button>}
  </div>;
}

function Recommendations({items}: {items: string[]}) {
  if (!items.length) return null;
  return <section className={styles.recommendations} aria-label="Öneriler ve sonraki adımlar">
    <article className={styles.firstStep}>
      <div className={styles.firstStepHeading}><span><ArrowUpRight size={19} aria-hidden="true"/>İlk önerin</span><span>01 / {String(items.length).padStart(2, '0')}</span></div>
      <p>{items[0]}</p>
    </article>
    {items.length > 1 && <><div className={styles.recommendationHeading}><h3>Diğer adımlar</h3><span>{items.length - 1} öneri · açıp incele</span></div><ol className={styles.recommendationList} start={2}>
      {items.slice(1).map((item, index) => <li key={index}><details>
        <summary><span className={styles.suggestionNumber}>{String(index + 2).padStart(2, '0')}</span><span><strong>Öneri {index + 2}</strong><span>{item.length > 110 ? `${item.slice(0, 110).trimEnd()}…` : item}</span></span><ChevronDown size={18} aria-hidden="true"/></summary>
        <p>{item}</p>
      </details></li>)}
    </ol></>}
  </section>;
}

function ReportTable({table}: {table: AgentHouseAgent['tables'][number]}) {
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const current = table.rows.slice(page * pageSize, (page + 1) * pageSize);
  return <section className={styles.dataSection}>
    <div className={styles.tableHeading}><h3>{table.title}</h3><span>{table.rows.length} satır</span></div>
    <div className={styles.tableScroll} role="region" aria-label={table.title} tabIndex={0}><table><thead><tr>{table.columns.map((column, index) => <th key={index} scope="col">{column}</th>)}</tr></thead><tbody>{current.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>
    {!table.rows.length && <p className={styles.muted}>Bu tabloda henüz kayıt yok.</p>}
    {table.rows.length > pageSize && <div className={styles.pagination}><span>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, table.rows.length)} / {table.rows.length} satır</span><div><button type="button" aria-label="Önceki satırlar" disabled={page === 0} onClick={() => setPage(page - 1)}><ArrowLeft size={18} aria-hidden="true"/></button><button type="button" aria-label="Sonraki satırlar" disabled={(page + 1) * pageSize >= table.rows.length} onClick={() => setPage(page + 1)}><ArrowRight size={18} aria-hidden="true"/></button></div></div>}
  </section>;
}

function ReportData({tables}: {tables: AgentHouseAgent['tables']}) {
  const [selected, setSelected] = useState(0);
  const current = tables[selected] ?? tables[0];
  if (!current) return null;
  return <div>{tables.length > 1 && <div className={styles.tablePicker} aria-label="Rapor tabloları">{tables.map((table, index) => <button type="button" key={index} aria-pressed={current === table} onClick={() => setSelected(index)}><span>{String(index + 1).padStart(2, '0')}</span>{table.title}</button>)}</div>}<ReportTable key={selected} table={current}/></div>;
}

function Sources({sources}: {sources: AgentHouseAgent['sources']}) {
  return <section className={styles.sources}><div className={styles.sectionIntro}><div><span className={styles.eyebrow}>BİLGİNİN İZİNİ SÜR</span><h3>Kaynaklar ve dayanaklar</h3></div><span className={styles.softBadge}>{sources.length} kaynak</span></div><ul>{sources.map((source, index) => <li key={index}>
    <div className={styles.sourceTop}><span>{String(index + 1).padStart(2, '0')}</span><small>{source.url ? new URL(source.url).hostname.replace(/^www\./, '') : 'Kayıt notu'}</small>{source.url ? <ArrowUpRight size={18} aria-hidden="true"/> : <FileText size={17} aria-hidden="true"/>}</div>
    {source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}<span className="sr-only"> (yeni sekmede açılır)</span></a> : <strong>{source.title}</strong>}{source.note && <p>{source.note}</p>}
  </li>)}</ul></section>;
}

export function AgentHouseReport({agent}: {agent: AgentHouseAgent}) {
  const [selected, setSelected] = useState<SectionId>('overview');
  const tabs = useRef<Partial<Record<SectionId, HTMLButtonElement | null>>>({});
  const days = planDays(agent);
  const available: SectionId[] = ['overview', ...(days.length ? ['plan' as const] : []), ...(agent.tables.length ? ['data' as const] : []), ...(agent.sources.length ? ['sources' as const] : [])];
  const active = available.includes(selected) ? selected : 'overview';
  const selectByKey = (event: KeyboardEvent<HTMLButtonElement>, id: SectionId) => {
    const index = available.indexOf(id);
    const next = event.key === 'ArrowRight' ? (index + 1) % available.length : event.key === 'ArrowLeft' ? (index - 1 + available.length) % available.length : event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); setSelected(available[next]); tabs.current[available[next]]?.focus();
  };
  return <>
    <div className={styles.reportTabs} role="tablist" aria-label="Rapor bölümleri">{available.map(id => {
      const Icon = sections[id].icon;
      return <button key={id} type="button" role="tab" id={`agent-tab-${id}`} aria-controls={`agent-panel-${id}`} aria-selected={active === id} tabIndex={active === id ? 0 : -1} ref={element => {tabs.current[id] = element;}} onClick={() => setSelected(id)} onKeyDown={event => selectByKey(event, id)}><Icon size={17} aria-hidden="true"/>{sections[id].label}{id === 'sources' && <span>{agent.sources.length}</span>}</button>;
    })}</div>
    {available.map(id => <div key={id} role="tabpanel" id={`agent-panel-${id}`} aria-labelledby={`agent-tab-${id}`} tabIndex={0} hidden={active !== id} className={styles.reportPanel}>
      {active === id && id === 'overview' && <><Summary text={agent.summary} allowCollapse={agent.status === 'ready'}/>{days.length > 0 && <button className={styles.planShortcut} type="button" onClick={() => {setSelected('plan'); tabs.current.plan?.focus();}}><span><CalendarDays size={20} aria-hidden="true"/><span><strong>Programına göz at</strong><small>{days.length} günün çalışma blokları bir arada</small></span></span><ArrowRight size={20} aria-hidden="true"/></button>}<Recommendations items={agent.recommendations}/>{!agent.recommendations.length && agent.tables.length > 0 && <button type="button" className={styles.textAction} onClick={() => {setSelected('data'); tabs.current.data?.focus();}}>Kayıtları ve tabloları incele <ArrowDown size={17} aria-hidden="true"/></button>}</>}
      {active === id && id === 'plan' && <AgentHousePlan days={days}/>}
      {active === id && id === 'data' && <ReportData tables={agent.tables}/>}
      {active === id && id === 'sources' && <Sources sources={agent.sources}/>}
    </div>)}
  </>;
}
