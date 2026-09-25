'use client';

import {ArrowUpRight, Clock3, Flag, NotebookPen} from 'lucide-react';
import type {AppState} from '@/lib/domain/types';
import type {StudyDay} from '@/lib/study-report';
import {duration, formatDay, localDate, type CommandFn} from '@/lib/ui';
import type {PageId} from './dashboard';
import {Card} from './primitives';

const statusLabel: Record<StudyDay['status'], string> = {
  ongoing: 'Bugün henüz tamamlanmadı',
  worked: 'Çalışma kaydı var',
  rest: 'Dinlenme günü',
  zero: '0 çalışma olarak doğrulandı',
  'planned-missing': 'Plan var, süre kaydı yok',
  missing: 'Kayıt yok',
};

export function StudyDayDetail({state, selected, today, command, busy, go}: {
  state: AppState;
  selected: StudyDay | undefined;
  today: string;
  command: CommandFn;
  busy: boolean;
  go: (page: PageId, date?: string) => void;
}) {
  const mark = selected ? state.day_marks.find(item => item.mark_date === selected.date) : undefined;
  const selectedTasks = selected ? state.tasks.filter(item => item.plan_date === selected.date) : [];
  const selectedSessions = selected ? state.sessions.filter(item => localDate(Date.parse(item.started_at), state.settings?.timezone ?? 'Europe/Istanbul') === selected.date) : [];
  const selectedManualEntries = selected ? (state.manual_study_entries ?? []).filter(item => item.study_date === selected.date) : [];
  const selectedExams = selected ? state.exams.filter(item => item.exam_date === selected.date) : [];
  const selectedJournal = selected ? state.journal_entries.find(item => item.journal_date === selected.date) : undefined;

  return <Card className="study-panel study-day-detail" title={selected ? formatDay(selected.date) : 'Gün ayrıntısı'} eyebrow="SEÇİLEN GÜN" action={<Clock3 size={19}/>}>
    {selected && <>
      <div className="study-day-heading"><strong>{duration(selected.seconds)}</strong><span>{statusLabel[selected.status]}</span></div>
      <div className="study-day-meta"><span>Hedef: {selected.targetMinutes === null ? 'kayıtlı değil' : `${selected.targetMinutes} dk`}</span><span>{selected.goalMet ? 'Hedefe ulaşıldı' : selected.targetMinutes ? 'Hedefe ulaşılmadı' : 'Hedef durumu yok'}</span></div>
      <div className="study-day-links"><button onClick={() => go('tasks')}>{selectedTasks.length} görev<ArrowUpRight size={14}/></button><button onClick={() => go('stats')}>{selectedSessions.length + selectedManualEntries.length} kayıt<ArrowUpRight size={14}/></button><button onClick={() => go('exams', selected.date)}>{selectedExams.length} deneme<ArrowUpRight size={14}/></button><button onClick={() => go('journal', selected.date)}>{selectedJournal ? 'Günlük var' : 'Günlük yok'}<NotebookPen size={14}/></button></div>
      {selectedTasks.length > 0 && <p className="study-day-sample">Görevler: {selectedTasks.slice(0, 3).map(item => item.title).join(' · ')}{selectedTasks.length > 3 ? '…' : ''}</p>}
      {selected.seconds === 0 && selected.date < today && <div className="study-day-actions"><button className="button secondary" disabled={busy || !state.authenticated} aria-pressed={mark?.kind === 'rest'} onClick={() => void command('day.mark', {mark_date: selected.date, kind: 'rest'})}><Flag size={14}/>Dinlenme günü</button><button className="button secondary" disabled={busy || !state.authenticated} aria-pressed={mark?.kind === 'zero'} onClick={() => void command('day.mark', {mark_date: selected.date, kind: 'zero'})}>0 çalışma olarak doğrula</button>{mark && <button className="text-button" disabled={busy} onClick={() => void command('day.unmark', {id: mark.id, expected_revision: mark.revision})}>İşareti kaldır</button>}</div>}
    </>}
    <p className="footnote">İşaretlenmemiş ve süre kaydı olmayan günler başarısızlık veya sıfır çalışma olarak yorumlanmaz.</p>
  </Card>;
}
