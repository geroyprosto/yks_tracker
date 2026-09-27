'use client';

import {useMemo, useState, type CSSProperties} from 'react';
import {CalendarDays, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Clock3} from 'lucide-react';
import type {AppState} from '@/lib/domain/types';
import {buildStudyReport, studyReportRange, type StudyReportPeriod} from '@/lib/study-report';
import {buildStudyChartBuckets, type StudyChartBucket} from '@/lib/study-statistics-buckets';
import {buildStudyStatisticsSummary} from '@/lib/study-statistics-summary';
import {duration, formatDay, localDate, type CommandFn} from '@/lib/ui';
import type {PageId} from './dashboard';
import {StudyDayDetail} from './study-day-detail';
import {StudyDistribution} from './study-distribution';
import {StudyGoalCalendar} from './study-goal-calendar';
import {StudyStatsCharts} from './study-stats-charts';
import {Card} from './primitives';

type Period = StudyReportPeriod | 'all';
const periods: {id: Period; label: string}[] = [
  {id: 'day', label: 'Bugün'}, {id: 'week', label: '1 hafta'},
  {id: 'month', label: '1 ay'}, {id: 'year', label: '1 yıl'},
  {id: 'all', label: 'Tümü'}, {id: 'custom', label: 'Özel aralık'},
];
const unitNames = {day: 'gün', week: 'hafta', month: 'ay', year: 'yıl'} as const;
const dateObject = (value: string) => new Date(value + 'T12:00:00Z');
function shiftDay(value: string, amount: number) {
  const date = dateObject(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function shiftPeriod(value: string, period: Period, amount: number) {
  if (period === 'day' || period === 'week') return shiftDay(value, amount * (period === 'week' ? 7 : 1));
  const date = dateObject(value);
  date.setUTCDate(1);
  if (period === 'month') date.setUTCMonth(date.getUTCMonth() + amount);
  else date.setUTCFullYear(date.getUTCFullYear() + amount);
  return date.toISOString().slice(0, 10);
}
function earliestDate(state: AppState, today: string, timezone: string) {
  const dates = [
    ...state.intervals.map(item => localDate(Date.parse(item.started_at), timezone)),
    ...(state.manual_study_entries ?? []).map(item => item.study_date),
    ...state.tasks.map(item => item.plan_date), ...state.day_marks.map(item => item.mark_date),
    ...state.day_plans.map(item => item.plan_date),
  ].filter(date => date <= today);
  return dates.reduce((first, date) => date < first ? date : first, today);
}
function periodRange(period: StudyReportPeriod, anchor: string, today: string) {
  const start = studyReportRange(period, anchor).start;
  let end = anchor;
  if (period === 'week') end = shiftDay(start, 6);
  if (period === 'month') {
    const date = dateObject(start);
    date.setUTCMonth(date.getUTCMonth() + 1);
    date.setUTCDate(0);
    end = date.toISOString().slice(0, 10);
  }
  if (period === 'year') end = anchor.slice(0, 4) + '-12-31';
  return {start, end: end > today ? today : end};
}
function rangeTitle(period: Period, start: string, end: string) {
  if (period === 'year') return start.slice(0, 4);
  if (period === 'month') return formatDay(start, {month: 'long', year: 'numeric'});
  if (start === end) return formatDay(start, {day: 'numeric', month: 'long', year: 'numeric'});
  return formatDay(start, {day: 'numeric', month: 'short', year: 'numeric'}) + ' – ' + formatDay(end, {day: 'numeric', month: 'short', year: 'numeric'});
}

export function StudyStatistics({state, command, busy, go, initialDate, scoped=false}: {
  state: AppState; command: CommandFn; busy: boolean; go: (page: PageId, date?: string) => void; initialDate?: string | null; scoped?: boolean;
}) {
  const now = Date.parse(state.server_now);
  const timezone = state.settings?.timezone ?? 'Europe/Istanbul';
  const today = localDate(now, timezone);
  const [period, setPeriod] = useState<Period>(initialDate?'day':'week');
  const [anchor, setAnchor] = useState(initialDate??today);
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [selectedDate, setSelectedDate] = useState(initialDate??today);
  const [detailsOpen, setDetailsOpen] = useState(Boolean(initialDate));
  const summary = useMemo(() => buildStudyStatisticsSummary(state, now), [state, now]);
  const floor = shiftDay(today, -3659);
  const first = useMemo(() => earliestDate(state, today, timezone), [state, today, timezone]);
  const range = period === 'custom' ? {start: customStart, end: customEnd} :
    period === 'all' ? {start: first < floor ? floor : first, end: today} : periodRange(period, anchor, today);
  const {start, end} = range;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) &&
    start <= end && end <= today && Date.parse(end + 'T12:00:00Z') - Date.parse(start + 'T12:00:00Z') <= 3659 * 86400000;
  const report = useMemo(() => valid ? buildStudyReport(state, {start, end}, now) : null, [state, start, end, valid, now]);
  const buckets = useMemo(() => report ? buildStudyChartBuckets(report, period === 'all' ? 'custom' : period, state.tasks, period === 'all' && start.slice(0, 4) !== end.slice(0, 4) ? 'year' : undefined) : [], [report, period, state.tasks, start, end]);
  const selected = useMemo(() => buildStudyReport(state, {start: selectedDate, end: selectedDate}, now).days[0], [state, selectedDate, now]);
  const navigable = period !== 'custom' && period !== 'all';
  const previousAnchor = shiftPeriod(anchor, period, -1);
  const nextAnchor = shiftPeriod(anchor, period, 1);
  const nextPeriodStart = navigable ? studyReportRange(period, nextAnchor).start : today;
  const selectedPeriodUnit = navigable ? unitNames[period] : '';
  const calendarMonth = (end || today).slice(0, 7);

  function selectDay(date: string) {
    setSelectedDate(date);
    setDetailsOpen(true);
  }
  function selectBucket(bucket: StudyChartBucket) {
    if (bucket.start === bucket.end) { selectDay(bucket.start); return; }
    setPeriod(bucket.granularity === 'year' ? 'year' : bucket.granularity === 'month' ? 'month' : 'week');
    setAnchor(bucket.start);
  }

  return <div className="study-statistics">
    <div className="study-stats-metrics" aria-label="Çalışma ve görev özeti">
      <Metric label="Toplam odaklanma süresi" value={duration(summary.totalSeconds)} kind="time" detail="Tüm zamanlar"/>
      <Metric label="Bu haftanın odaklanma süresi" value={duration(summary.weekSeconds)} kind="time" detail="Pazartesiden bugüne"/>
      <Metric label="Bugünün odaklanma süresi" value={duration(summary.todaySeconds)} kind="time" detail="Mola hariç net süre"/>
      <Metric label="Toplam tamamlanan görevler" value={String(summary.completedTasks)} kind="tasks" detail="Tüm zamanlar"/>
      <Metric label="Bu hafta tamamlanan görevler" value={String(summary.weekCompletedTasks)} kind="tasks" detail="Görevlerin plan tarihine göre"/>
      <Metric label="Bugün tamamlanan görevler" value={String(summary.todayCompletedTasks)} kind="tasks" detail="Görevlerin plan tarihine göre"/>
    </div>

    <div className="study-stats-controls">
      <div className="study-stats-period-tabs" role="group" aria-label="İstatistik dönemi">
        {periods.map(item => <button key={item.id} type="button" aria-pressed={period === item.id} onClick={() => {setPeriod(item.id);setAnchor(today);}}>{item.label}</button>)}
      </div>
      {valid && <div className="study-stats-period-nav">
        {navigable && <button type="button" className="icon-button" aria-label={'Önceki ' + selectedPeriodUnit} disabled={previousAnchor < floor} onClick={() => setAnchor(previousAnchor)}><ChevronLeft size={17}/></button>}
        <strong aria-live="polite">{rangeTitle(period, start, end)}</strong>
        {navigable && <button type="button" className="icon-button" aria-label={'Sonraki ' + selectedPeriodUnit} disabled={nextPeriodStart > today} onClick={() => setAnchor(nextAnchor)}><ChevronRight size={17}/></button>}
      </div>}
    </div>
    {period === 'custom' && <div className="study-stats-dates">
      <label>Başlangıç<input type="date" max={today} value={customStart} onChange={event => setCustomStart(event.target.value)}/></label>
      <span aria-hidden="true">—</span>
      <label>Bitiş<input type="date" max={today} value={customEnd} onChange={event => setCustomEnd(event.target.value)}/></label>
    </div>}
    {!valid && <p className="notice error" role="alert">Geçerli bir başlangıç ve bitiş tarihi seç. Aralık en fazla 10 yıl olabilir.</p>}
    {report && <>
      <StudyStatsCharts buckets={buckets} onSelectBucket={selectBucket} selectedDate={detailsOpen ? selectedDate : undefined}/>
      {period === 'all' && first < floor && <p className="study-stats-help">Grafik son 10 yılı gösterir. Üstteki toplamlar tüm kayıtlarını içerir.</p>}
      <div className="study-analysis-grid">
        <StudyDistribution report={report}/>
        {scoped?<Card title="Bu seçimin çalışma kayıtları" className="study-panel"><p className="soft-copy">Grafikler ve görev özetleri seçtiğin ders veya döneme aittir. Günlük hedefler bütün çalışma alanını kapsadığı için bu filtrede hedef karşılaştırması yapılmaz.</p><p className="footnote">Günlük hedef takvimini görmek için ders ve dönem filtrelerini “Tüm” olarak değiştir.</p></Card>:<StudyGoalCalendar key={calendarMonth} state={state} now={now} initialMonth={calendarMonth} onSelectDate={selectDay}/>}
      </div>
      <details className="study-detail-disclosure" open={detailsOpen} onToggle={event => setDetailsOpen(event.currentTarget.open)}>
        <summary><span><CalendarDays size={18}/><strong>Gün ayrıntıları</strong><small>{scoped?'Seçili dersin görev ve oturumları':'Hedef, oturumlar ve günlük notun'}</small></span><ChevronDown size={18}/></summary>
        <div className="study-detail-content">
          <label className="study-detail-date">İncelenen gün<input type="date" max={today} value={selectedDate} onChange={event => {if (event.target.value && event.target.value <= today) setSelectedDate(event.target.value);}}/></label>
          <StudyDayDetail state={state} selected={selected} today={today} command={command} busy={busy} go={go} scoped={scoped}/>
        </div>
      </details>
    </>}
  </div>;
}

function Metric({label, value, detail, kind}: {label: string; value: string; detail: string; kind: 'time' | 'tasks'}) {
  return <div className={'study-stat-metric metric-' + kind} style={{'--metric-accent': kind === 'time' ? 'var(--primary)' : 'var(--chart)'} as CSSProperties}>
    <span>{kind === 'time' ? <Clock3 size={14}/> : <CheckCheck size={14}/>}<span>{label}</span></span>
    <strong>{value}</strong><small>{detail}</small>
  </div>;
}

