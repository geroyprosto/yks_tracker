'use client';

import {Timer, CalendarDays} from 'lucide-react';
import type {AppState} from '@/lib/domain/types';
import {duration, formatDay, localDate, type CommandFn} from '@/lib/ui';
import {Card, Empty} from './primitives';

export function SessionHistory({state}: {state: AppState; command: CommandFn; busy: boolean}) {
  const sessions = state.sessions.filter(session => session.status === 'finished');
  const manualEntries = state.manual_study_entries ?? [];
  const empty = sessions.length === 0 && manualEntries.length === 0;

  return <>
    <Card className={empty ? 'ambient-card' : ''} title="Çalışma kayıtları" eyebrow="NET ÇALIŞMA">
      {empty ? <Empty icon={<Timer/>} title="Henüz çalışma kaydı yok" text="Tamamladığın sayaç oturumları ve bildirdiğin süreler burada görünür."/> :
        <div className="session-list">
          {manualEntries.map(entry => <div className="session-row" key={'manual-' + entry.id}>
            <CalendarDays size={18}/>
            <div><strong>{entry.subject}</strong><small>{formatDay(entry.study_date)} · Bildirilen süre</small></div>
            <strong>{duration(entry.duration_seconds)}</strong>
          </div>)}
          {sessions.map(session => <div className="session-row" key={session.id}>
            <Timer size={18}/>
            <div><strong>{session.title}</strong><small>{formatDay(localDate(new Date(session.started_at), state.settings?.timezone))} · {session.study_type}</small></div>
            <strong>{duration(session.accumulated_seconds)}</strong>
          </div>)}
        </div>}
      <p className="footnote">Kesinleşmiş çalışma süreleri değiştirilemez. Sayaçta yalnız etkin aralıklar sayılır; molalar ve takvim etkinlikleri eklenmez.</p>
    </Card>
  </>;
}
