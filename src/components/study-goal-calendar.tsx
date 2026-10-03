'use client';

import {useMemo, useState, type CSSProperties} from 'react';
import {CalendarDays, ChevronLeft, ChevronRight, Target, Trophy} from 'lucide-react';
import type {AppState} from '@/lib/domain/types';
import {buildStudyReport, type StudyDay} from '@/lib/study-report';
import {duration, formatDay, localDate} from '@/lib/ui';
import {Card} from './primitives';

const weekdays = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const statusText: Record<StudyDay['status'], string> = {
  ongoing: 'Bugün devam ediyor',
  worked: 'Çalışma kaydı var',
  rest: 'Dinlenme günü',
  zero: '0 çalışma olarak doğrulandı',
  'planned-missing': 'Plan var, süre kaydı yok',
  missing: 'Süre kaydı yok; çalışma durumu bilinmiyor',
};

function shiftMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return date.toISOString().slice(0, 7);
}

function recordedMonthFloor(state: AppState, today: string, timezone: string) {
  const dates = [
    ...state.day_plans.map(plan => plan.plan_date),
    ...(state.day_marks ?? []).map(mark => mark.mark_date),
    ...state.sessions.map(session => session.started_at),
    ...(state.manual_study_entries ?? []).map(entry => entry.study_date),
    ...state.intervals.map(interval => interval.started_at),
  ];
  const validDates = dates.map(value => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const time = Date.parse(value);
    return Number.isFinite(time) ? localDate(time, timezone) : null;
  }).filter((value): value is string => value !== null && value <= today);
  return validDates.length ? validDates.reduce((earliest, value) => value < earliest ? value : earliest).slice(0, 7) : today.slice(0, 7);
}

function dayLabel(day: StudyDay) {
  const goal = day.targetMinutes !== null && day.targetMinutes > 0 ? `Hedef ${day.targetMinutes} dk` : 'Kayıtlı hedef yok';
  const work = day.seconds > 0 ? duration(day.seconds) : day.status === 'zero' ? 'Doğrulanmış 0 dk' : 'Süre belirtilmemiş';
  const reached = day.goalMet ? ' · Hedefe ulaşıldı' : '';
  return `${formatDay(day.date)} · ${work} · ${goal} · ${statusText[day.status]}${reached}`;
}

export function StudyGoalCalendar({state, now, initialMonth, onSelectDate}: {state: AppState; now: number; initialMonth?: string; onSelectDate?: (date: string) => void}) {
  const timezone = state.settings?.timezone ?? 'Europe/Istanbul';
  const today = localDate(now, timezone);
  const currentMonth = today.slice(0, 7);
  const earliestMonth = useMemo(() => {
    const recorded = recordedMonthFloor(state, today, timezone);
    return initialMonth && initialMonth < recorded ? initialMonth : recorded;
  }, [state, today, timezone, initialMonth]);
  const [requestedMonth, setRequestedMonth] = useState(initialMonth ?? currentMonth);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const month = requestedMonth < earliestMonth ? earliestMonth : requestedMonth > currentMonth ? currentMonth : requestedMonth;
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const end = month === currentMonth ? today : `${month}-${String(lastDay).padStart(2, '0')}`;
  const report = useMemo(() => buildStudyReport(state, {start: `${month}-01`, end}, now), [state, month, end, now]);
  const firstWeekday = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const visibleDays = new Map(report.days.map(day => [day.date, day]));
  const selected = report.days.find(day => day.date === selectedDate) ?? report.days.at(-1);
  const selectedTarget = selected?.targetMinutes !== null && selected?.targetMinutes !== undefined && selected.targetMinutes > 0 ? selected.targetMinutes : null;
  const selectedPercentage = selected && selectedTarget ? Math.max(0, selected.seconds / (selectedTarget * 60) * 100) : null;
  const selectedHasRecordedTime = selected && (selected.seconds > 0 || selected.status === 'zero' || selected.status === 'ongoing');
  const monthTitle = new Intl.DateTimeFormat('tr-TR', {month: 'long', year: 'numeric', timeZone: 'UTC'}).format(new Date(`${month}-01T12:00:00Z`));

  function navigate(amount: number) {
    setRequestedMonth(shiftMonth(month, amount));
    setSelectedDate(null);
  }

  return <Card className="study-panel study-goal-calendar">
    <header className="sgc-heading">
      <span className="sgc-heading-icon" aria-hidden="true"><Target size={28}/></span>
      <div><h2>Aylık ilerim</h2><p>Hedeflerine ne kadar yaklaştın?</p></div>
      <span className="sgc-total"><span>Aylık odaklanma</span><strong>{duration(report.totalSeconds)}</strong><small>net süre</small></span>
    </header>
    <div className="sgc-body">
    <div className="sgc-calendar">
    <div className="sgc-month-nav">
      <button type="button" aria-label="Önceki ay" disabled={month <= earliestMonth} onClick={() => navigate(-1)}><ChevronLeft size={16}/></button>
      <strong aria-live="polite">{monthTitle}</strong>
      <button type="button" aria-label="Sonraki ay" disabled={month >= currentMonth} onClick={() => navigate(1)}><ChevronRight size={16}/></button>
    </div>
    <div className="sgc-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
    <div className="sgc-grid" role="group" aria-label={`${monthTitle} çalışma hedefi takvimi`}>
      {Array.from({length: firstWeekday}, (_, index) => <span className="sgc-day-spacer" key={`empty-${index}`} aria-hidden="true"/>)}
      {Array.from({length: lastDay}, (_, index) => {
        const date = `${month}-${String(index + 1).padStart(2, '0')}`;
        const day = visibleDays.get(date);
        if (!day) return <span className="sgc-day sgc-day-future" key={date} aria-hidden="true"><span>{index + 1}</span></span>;
        const hasTarget = day.targetMinutes !== null && day.targetMinutes > 0;
        const percentage = hasTarget ? Math.min(100, Math.max(0, day.seconds / (day.targetMinutes! * 60) * 100)) : 0;
        const classes = `sgc-day status-${day.status}${day.goalMet ? ' is-goal-met' : ''}${date === today ? ' is-today' : ''}${hasTarget ? ' has-target' : ''}`;
        return <button key={date} type="button" className={classes} aria-label={dayLabel(day)} aria-pressed={selected?.date === date} title={dayLabel(day)} onClick={() => {setSelectedDate(date);onSelectDate?.(date);}} style={{'--sgc-progress': percentage} as CSSProperties}>
          <svg viewBox="0 0 44 44" aria-hidden="true"><circle className="sgc-ring-track" cx="22" cy="22" r="18"/><circle className="sgc-ring-progress" cx="22" cy="22" r="18" pathLength="100"/></svg>
          <time dateTime={date}>{index + 1}</time>
          {day.seconds > 0 && !hasTarget && <i className="sgc-worked-dot" aria-hidden="true"/>}
        </button>;
      })}
    </div>
    <div className="sgc-legend" aria-label="Takvim göstergeleri"><span><i className="goal"/>Hedef</span><span><i className="recorded"/>Kayıtlı</span><span><i className="rest"/>Dinlenme</span><span><i className="zero"/>Doğrulanmış 0</span><span><i className="missing"/>Kayıt yok</span></div>
    </div>
    <div className="sgc-rail">
      <div className="sgc-summary" aria-label="Ay özeti">
        <div className="sgc-summary-worked"><span className="sgc-summary-icon" aria-hidden="true"><CalendarDays size={20}/></span><div><strong>{report.workedDays}</strong><span>çalışılan gün</span></div></div>
        <div className="sgc-summary-goals"><span className="sgc-summary-icon" aria-hidden="true"><Trophy size={20}/></span><div><strong>{report.goalMetDays}</strong><span>hedefe ulaşılan</span></div></div>
      </div>
      {selected && <div className="sgc-selected" aria-live="polite">
        <div className="sgc-selected-top"><strong>{formatDay(selected.date)}</strong><strong className="sgc-selected-duration">{selected.seconds > 0 ? duration(selected.seconds) : selected.status === 'zero' ? '0 dk' : '—'}</strong></div>
        <div className="sgc-selected-details"><span>{statusText[selected.status]}</span><span>{selectedTarget ? `Hedef ${duration(selectedTarget * 60)}${selected.goalMet ? ' · tamamlandı' : ''}` : 'Hedef kaydı yok'}</span></div>
        {selectedPercentage !== null && selectedHasRecordedTime && <div className="sgc-selected-progress"><div className={`sgc-progress${selected.goalMet ? ' is-goal-met' : ''}`} role="progressbar" aria-label="Seçilen günün hedef ilerlemesi" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(selectedPercentage))} aria-valuetext={`%${Math.round(selectedPercentage)}`}><span style={{width: `${Math.min(100, selectedPercentage)}%`}}/></div><strong>%{Math.round(selectedPercentage)}</strong></div>}
      </div>}
    </div>
    </div>
    <p className="sgc-note">Boş günler sıfır çalışma veya başarısız hedef sayılmaz. Bugünkü halka geçicidir.</p>
  </Card>;
}

