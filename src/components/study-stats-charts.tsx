'use client';

import type {StudyChartBucket} from '@/lib/study-statistics-buckets';
import {summarizeStudyChartBuckets} from '@/lib/study-statistics-buckets';
import {duration, formatDay} from '@/lib/ui';
import {Card} from './primitives';
import {useChartTooltip} from './chart-tooltip';

type Props = {
  buckets: StudyChartBucket[];
  selectedDate?: string;
  onSelectBucket: (bucket: StudyChartBucket) => void;
};
const names = {day: 'gün', week: 'hafta', month: 'ay', year: 'yıl'} as const;
const groupedNames = {day: 'Günlük', week: 'Haftalık', month: 'Aylık', year: 'Yıllık'} as const;
const number = new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 1});
function timeScaleMax(value: number) {
  const rawStep = Math.max(1, value / 3600) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].find(candidate => candidate * magnitude >= rawStep) ?? 10;
  return step * magnitude * 4 * 3600;
}
function timeTick(seconds: number) {
  return seconds === 0 ? '0' : seconds < 3600 ? number.format(seconds / 60) + ' dk' : number.format(seconds / 3600) + ' sa';
}
function bucketTitle(bucket: StudyChartBucket) {
  if (bucket.granularity === 'year') return bucket.start.slice(0, 4);
  if (bucket.granularity === 'month') return formatDay(bucket.start, {month: 'long', year: 'numeric'});
  if (bucket.start === bucket.end) return formatDay(bucket.start, {day: 'numeric', month: 'long'});
  return formatDay(bucket.start, {day: 'numeric', month: 'short'}) + ' – ' + formatDay(bucket.end, {day: 'numeric', month: 'short'});
}

function Bars({buckets, kind, selectedDate, onSelectBucket}: Props & {kind: 'time' | 'tasks'}) {
  const tooltip = useChartTooltip();
  const values = buckets.map(bucket => kind === 'time' ? bucket.totalSeconds : bucket.completedTaskCount);
  const rawMax = Math.max(0, ...values);
  const max = kind === 'time' ? timeScaleMax(rawMax) : Math.max(4, Math.ceil(rawMax / 4) * 4);
  const ticks = [1, .75, .5, .25, 0];
  const labelStep = Math.max(1, Math.ceil(buckets.length / 7));
  return <div className={'stats-chart stats-chart-' + kind} role="group" aria-label={kind === 'time' ? 'Dönemlere göre odaklanma süresi' : 'Dönemlere göre tamamlanan görevler'}>
    <div className="stats-chart-y" aria-hidden="true">{ticks.map(tick => <span key={tick}>{kind === 'time' ? timeTick(max * tick) : Math.round(max * tick)}</span>)}</div>
    <div className="stats-chart-body" style={{gridTemplateColumns: 'repeat(' + Math.max(1, buckets.length) + ', minmax(0, 1fr))'}}>
      <div className="stats-chart-grid" aria-hidden="true">{ticks.map(tick => <i key={tick}/>)}</div>
      {buckets.map((bucket, index) => {
        const value = values[index];
        const date = bucketTitle(bucket);
        const text = kind === 'time' ? duration(value) : value + ' görev';
        const description = date + ': ' + text + (kind === 'tasks' ? ', ' + bucket.taskCount + ' planlanan' : '') +
          '. ' + (bucket.start === bucket.end ? 'Gün ayrıntılarını aç' : 'Dönemi yakından incele');
        const label = bucket.granularity === 'week' ? formatDay(bucket.start, {day: 'numeric', month: 'short'}) : bucket.label;
        return <button key={bucket.key} type="button" className={'stats-bar' + (selectedDate === bucket.start && bucket.start === bucket.end ? ' is-selected' : '')}
          {...tooltip.triggerProps(bucket.key, {title: date, value: text, context: kind === 'tasks' ? `${bucket.taskCount} planlanan görev` : 'Toplam odaklanma süresi', note: bucket.start === bucket.end ? 'Gün ayrıntıları için seç' : 'Dönemi yakından incelemek için seç'})}
          aria-label={description} aria-pressed={selectedDate === bucket.start && bucket.start === bucket.end} onClick={() => {tooltip.close(); onSelectBucket(bucket);}}>
          <span className="stats-bar-track">
            {value > 0 ? <i className="stats-bar-fill" style={{height: Math.max(1, 100 * value / max) + '%'}}/> : <i className="stats-bar-zero"/>}
          </span>
          <span className="stats-bar-label">{index % labelStep === 0 || index === buckets.length - 1 ? label : ''}</span>
        </button>;
      })}
    </div>
    {tooltip.tooltip}
  </div>;
}

export function StudyStatsCharts({buckets, selectedDate, onSelectBucket}: Props) {
  const summary = summarizeStudyChartBuckets(buckets);
  const granularity = buckets[0]?.granularity ?? 'day';
  const unit = names[granularity];
  const planned = buckets.reduce((sum, bucket) => sum + bucket.taskCount, 0);
  const taskBest = buckets.reduce<StudyChartBucket | null>((best, bucket) => !best || bucket.completedTaskCount > best.completedTaskCount ? bucket : best, null);
  return <div className="study-trend-grid">
    <Card className="study-panel study-trend-card study-time-card" title="Odaklanma süresi grafiği" action={<span className="study-trend-badge">{groupedNames[granularity]} toplamlar</span>}>
      <div className="study-trend-summary">
        <div className="study-trend-total"><span>Toplam süre</span><strong>{duration(summary.totalSeconds)}</strong></div>
        <div><span>Ortalama / {unit}</span><strong>{duration(Math.round(summary.averageBucketSeconds))}</strong></div>
        <div><span>En iyi {unit}</span><strong>{summary.bestBucket?.totalSeconds ? duration(summary.bestBucket.totalSeconds) : '—'}</strong></div>
      </div>
      <Bars key={buckets.map(bucket => bucket.key).join('|')} buckets={buckets} kind="time" selectedDate={selectedDate} onSelectBucket={onSelectBucket}/>
      <div className="study-chart-footer"><span>Bir sütuna dokunarak ayrıntısını incele.</span>
        <details className="study-calculation"><summary>Ortalama nasıl hesaplanır?</summary><p>Kaydedilen toplam süre, grafikteki {buckets.length} {unit} sayısına bölünür. Henüz tamamlanmayan dönem de dahildir. Süre kaydı olmayan aralıklar, çalışmadığın anlamına gelmez.</p></details>
      </div>
    </Card>
    <Card className="study-panel study-trend-card study-task-card" title="Görev grafiği" action={<span className="study-trend-badge">Tamamlanan</span>}>
      <div className="study-trend-summary">
        <div className="study-trend-total"><span>Tamamlanan</span><strong>{summary.completedTaskCount}<small> / {planned}</small></strong></div>
        <div><span>Ortalama / {unit}</span><strong>{number.format(summary.averageCompletedTasks)}</strong></div>
        <div><span>En iyi {unit}</span><strong>{taskBest?.completedTaskCount ?? 0}</strong></div>
      </div>
      <Bars key={buckets.map(bucket => bucket.key).join('|')} buckets={buckets} kind="tasks" selectedDate={selectedDate} onSelectBucket={onSelectBucket}/>
      <p className="study-chart-footer">Tamamlanan görevler planlandıkları tarihe göre gösterilir.</p>
    </Card>
  </div>;
}

