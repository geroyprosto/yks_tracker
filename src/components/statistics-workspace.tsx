'use client';

import {useRef} from 'react';
import {BarChart3, BookOpen, Timer} from 'lucide-react';
import type {AppState} from '@/lib/domain/types';
import type {CommandFn} from '@/lib/ui';
import type {PageId} from './dashboard';
import {PracticeAnalysis} from './practice-analysis';
import {SessionHistory} from './session-history';
import {StudyStatistics} from './study-statistics';
import styles from './statistics-workspace.module.css';

export type StatisticsView = 'study' | 'practice' | 'sessions';

const views = [
  {id: 'study', label: 'Çalışma analizi', icon: BarChart3},
  {id: 'practice', label: 'Soru ve test', icon: BookOpen},
  {id: 'sessions', label: 'Kayıtlar', icon: Timer},
] as const;

type Props = {
  state: AppState;
  practiceState: AppState;
  preview: boolean;
  command: CommandFn;
  busy: boolean;
  go: (page: PageId, date?: string) => void;
  view: StatisticsView;
  initialDate?: string | null;
  onViewChange: (view: StatisticsView) => void;
};

export function StatisticsWorkspace({state, practiceState, preview, command, busy, go, view, initialDate, onViewChange}: Props) {
  const viewsRef = useRef<HTMLDivElement>(null);
  const goFromReport = (page: PageId, date?: string) => {
    if (page === 'stats') {
      onViewChange('sessions');
      requestAnimationFrame(() => viewsRef.current?.querySelector<HTMLButtonElement>('[aria-pressed=true]')?.focus());
    }
    else go(page, date);
  };

  return <div className={styles.workspace} data-statistics-view={view}>
    <div ref={viewsRef} className={styles.views} role="group" aria-label="İstatistik görünümü">
      {views.map(({id, label, icon: Icon}) => <button key={id} type="button" aria-pressed={view === id} onClick={() => onViewChange(id)}>
        <Icon size={16} aria-hidden="true"/>
        <span>{label}</span>
      </button>)}
    </div>
    {view === 'study' && <StudyStatistics key={initialDate ?? 'default'} initialDate={initialDate} state={preview ? practiceState : state} command={command} busy={busy} go={goFromReport}/>}
    {view === 'practice' && <PracticeAnalysis state={practiceState} command={command} busy={busy} preview={preview}/>}
    {view === 'sessions' && <SessionHistory state={state} command={command} busy={busy}/>}
  </div>;
}

