'use client';

import {useState} from 'react';
import {ArrowLeft, ArrowRight} from 'lucide-react';
import type {AgentHouseAgent} from '@/lib/agent-house';
import {AgentHousePlan, planDays} from './agent-house-plan';
import styles from './agent-house.module.css';

// Keep the stored report intact. The house reads one complete note at a time;
// provenance and raw tables belong to the underlying report, not this view.
export function AgentHouseReport({agent}: {agent: AgentHouseAgent}) {
  const days = planDays(agent);
  const [showPlan, setShowPlan] = useState(days.length > 0);
  const [page, setPage] = useState(0);
  const notes = agent.recommendations.length ? agent.recommendations : [agent.summary];
  return <>
    {days.length > 0 && <div className={styles.noteViews} aria-label="Not defteri görünümü">
      <button type="button" aria-pressed={showPlan} onClick={() => setShowPlan(true)}>Program</button>
      <button type="button" aria-pressed={!showPlan} onClick={() => setShowPlan(false)}>Notlar</button>
    </div>}
    {showPlan ? <AgentHousePlan days={days}/> : <section className={styles.noteBody} aria-label="Ajanın notu">
      {agent.status !== 'ready' && <p className={styles.quietLabel}>{agent.status === 'no_data' ? 'Henüz yeterli bilgi yok' : 'Bu hafta bir not bırakmadı'}</p>}
      <div className={styles.noteText} aria-live="polite" aria-atomic="true"><p key={page}>{notes[page] ?? notes[0]}</p></div>
      {notes.length > 1 && <nav className={styles.notePager} aria-label="Notlar arasında gezin">
        <button type="button" aria-label="Önceki not" disabled={page === 0} onClick={() => setPage(page - 1)}><ArrowLeft size={18} aria-hidden="true"/></button>
        <span>{page + 1} / {notes.length}</span>
        <button type="button" aria-label="Sonraki not" disabled={page === notes.length - 1} onClick={() => setPage(page + 1)}><ArrowRight size={18} aria-hidden="true"/></button>
      </nav>}
    </section>}
  </>;
}
