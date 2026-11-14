'use client';

import {useState} from 'react';
import {ArrowLeft, ArrowRight, ChevronDown} from 'lucide-react';
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
  const current = days[selection] ?? days[0];
  if (!current) return null;
  return <section className={styles.plan} data-testid="agent-plan" aria-label="Günlük program">
    <div className={styles.dayPicker}>
      <button className={styles.dayArrow} type="button" aria-label="Önceki gün" disabled={selection === 0} onClick={() => setSelection(selection - 1)}><ArrowLeft size={16} aria-hidden="true"/></button>
      <select aria-label="Program günü" value={selection} onChange={event => setSelection(Number(event.target.value))}>{days.map((day, index) => <option key={day.label} value={index}>{day.label}</option>)}</select>
      <button className={styles.dayArrow} type="button" aria-label="Sonraki gün" disabled={selection === days.length - 1} onClick={() => setSelection(selection + 1)}><ArrowRight size={16} aria-hidden="true"/></button>
    </div>
    <ol key={current.label} className={styles.timeline} data-testid="agent-plan-day">
      {current.blocks.map((block, index) => <li key={index}>
        {block.detail ? <details><summary className={styles.blockHeading}><strong>{block.title}</strong><span className={styles.blockTiming}>{block.timing}</span><ChevronDown size={14} aria-hidden="true"/></summary><p className={styles.blockDetail}>{block.detail}</p></details> : <div className={styles.blockHeading}><strong>{block.title}</strong><span className={styles.blockTiming}>{block.timing}</span></div>}
      </li>)}
    </ol>
  </section>;
}
