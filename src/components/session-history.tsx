'use client';

import {useState} from 'react';
import {Timer, PenLine, CalendarDays} from 'lucide-react';
import type {AppState, StudySession} from '@/lib/domain/types';
import {duration, formatDay, localDate, type CommandFn} from '@/lib/ui';
import {Card, Empty} from './primitives';
import {Modal} from './modal';

export function SessionHistory({state, command, busy}: {state: AppState; command: CommandFn; busy: boolean}) {
  const [edit, setEdit] = useState<StudySession | null>(null);
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
            <button className="icon-button" aria-label={session.title + ' süreyi düzelt'} disabled={busy} onClick={() => setEdit(session)}><PenLine size={17}/></button>
          </div>)}
        </div>}
      <p className="footnote">Sayaç oturumlarında yalnız etkin aralıklar sayılır; bildirdiğin süreler seçtiğin tarihe eklenir. Molalar ve takvim etkinlikleri süreye eklenmez.</p>
    </Card>
    {edit && <Modal title="Hatalı süreyi düzelt" onClose={() => setEdit(null)}>
      <form className="form-grid" onSubmit={async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (await command('timer.correct', {id: edit.id, expected_revision: edit.revision,
          confirmed_seconds: Number(form.get('seconds')), reason: form.get('reason')})) setEdit(null);
      }}>
        <p className="soft-copy span-2">Açık unutulan oturumun süresini azaltabilirsin. Önceki kayıt ve düzeltme nedeni denetim geçmişinde korunur.</p>
        <label className="span-2">Gerçek net süre (saniye)<input type="number" name="seconds" min="0" max={edit.accumulated_seconds} required defaultValue={edit.accumulated_seconds}/><small>1 dakika = 60 saniye · mevcut: {duration(edit.accumulated_seconds)}</small></label>
        <label className="span-2">Düzeltme nedeni<textarea name="reason" minLength={3} maxLength={1000} required placeholder="Örn. Sayacı kapatmayı unuttum."/></label>
        <div className="form-actions span-2"><button className="button secondary" type="button" onClick={() => setEdit(null)}>Vazgeç</button><button className="button primary" disabled={busy}>Düzeltmeyi kaydet</button></div>
      </form>
    </Modal>}
  </>;
}
