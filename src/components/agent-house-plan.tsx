'use client';

import {useRef, useState} from 'react';
import {ArrowRight, CalendarDays, Clock3} from 'lucide-react';
import type {AgentHouseAgent} from '@/lib/agent-house';
import {reportDate} from './agent-house-meta';
import styles from './agent-house.module.css';

type PlanBlock = {order: string; title: string; timing: string; detail: string};
type PlanDay = {label: string; blocks: PlanBlock[]};
const planColumns = ['Gün', 'Sıra', 'Çalışma', 'Süre', 'Nasıl yapacaksın?'];

export function planDays(agent: AgentHouseAgent): PlanDay[] {
  if (agent.schedule.length) {
    return [...new Set(agent.schedule.map(block => block.date))].sort().map(day => ({
      label: reportDate(day),
      blocks: agent.schedule.filter(block => block.date === day).toSorted((a, b) => a.start.localeCompare(b.start)).map((block, index) => ({
        order: String(index + 1), title: block.title, timing: `${block.start}–${block.end}`, detail: block.detail ?? '',
      })),
    }));
  }
  const table = agent.tables.find(table => table.rows.length > 0 && table.columns.length === planColumns.length && table.columns.every((column, index) => column.trim() === planColumns[index]));
  if (!table?.rows.length) return [];
  return [...new Set(table.rows.map(row => row[0]))].map(day => ({
    label: day,
    blocks: table.rows.filter(row => row[0] === day).map(row => ({order: row[1], title: row[2], timing: row[3], detail: row[4]})),
  }));
}

export function AgentHousePlan({days}: {days: PlanDay[]}) {
  const [selection, setSelection] = useState(0);
  const dayButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const current = days[selection] ?? days[0];
  if (!current) return null;
  return <section className={styles.plan} data-testid="agent-plan">
    <div className={styles.sectionIntro}><div><span className={styles.eyebrow}>ADIM ADIM İLERLE</span><h3>Haftanın akışı</h3></div><span className={styles.softBadge}><CalendarDays size={15} aria-hidden="true"/>{days.length} gün</span></div>
    <div className={styles.days} aria-label="Program günleri">
      {days.map((day, index) => <button type="button" key={day.label} aria-pressed={current.label === day.label} aria-label={day.label} ref={element => {dayButtons.current[index] = element;}} onClick={() => setSelection(index)}>
        <span>{day.label}</span><small>{day.blocks.length} blok</small><i aria-hidden="true"/>
      </button>)}
    </div>
    <div key={current.label} className={styles.dayContent} data-testid="agent-plan-day">
      <div className={styles.dayTitle}><h4>{current.label}</h4><span>{current.blocks.length} çalışma bloğu</span></div>
      <ol className={styles.timeline}>
        {current.blocks.map((block, index) => <li key={index}>
          <span className={styles.blockNumber} aria-label={`Sıra ${block.order}`}>{block.order}</span>
          <div className={styles.blockCard}><div className={styles.blockHeading}><h5>{block.title}</h5><span><Clock3 size={14} aria-hidden="true"/>{block.timing}</span></div>{block.detail && <p>{block.detail}</p>}</div>
        </li>)}
      </ol>
    </div>
    {selection < days.length - 1 && <button className={styles.nextDay} type="button" onClick={() => {setSelection(selection + 1); dayButtons.current[selection + 1]?.focus();}}>Sonraki gün <ArrowRight size={17} aria-hidden="true"/></button>}
  </section>;
}
