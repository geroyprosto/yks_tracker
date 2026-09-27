'use client';

import {useId, useMemo, useState} from 'react';
import {ArrowUpRight, ChevronLeft, ChevronRight} from 'lucide-react';
import type {ExamFormatCode, ExamRecord} from '@/lib/domain/types';
import {monthlyExamSeries, type MonthlyExamPoint} from '@/lib/monthly-exam-series';
import {formatDay, localDate} from '@/lib/ui';
import {Card} from './primitives';
import {ChartPoint, useChartTooltip, type ChartDetail} from './chart-tooltip';

const formats: {code: ExamFormatCode; label: string}[] = [
  {code: 'TYT', label: 'TYT'},
  {code: 'AYT_SAYISAL', label: 'AYT sayısal'},
  {code: 'BRANCH', label: 'Branş'},
];
const netNumber = new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 2});

function monthName(month: string) {
  return new Intl.DateTimeFormat('tr-TR', {month: 'long', year: 'numeric', timeZone: 'UTC'})
    .format(new Date(`${month}-01T12:00:00Z`));
}

function shiftMonth(month: string, amount: number) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}

function axisStep(span: number) {
  const target = Math.max(1, span) / 4;
  const order = 10 ** Math.floor(Math.log10(target));
  return ([1, 2, 5, 10].find(multiplier => multiplier * order >= target) ?? 10) * order;
}

function bounds(points: MonthlyExamPoint[]) {
  const low = Math.min(0, ...points.map(point => point.net));
  const high = Math.max(0, ...points.map(point => point.net));
  const step = axisStep(Math.max(10, high - low));
  const min = Math.floor(low / step) * step;
  const max = Math.max(min + step * 2, Math.ceil(high / step) * step);
  const ticks: number[] = [];
  for (let value = min; value <= max + step / 2; value += step) ticks.push(value);
  return {min, max, ticks};
}

function PlotSvg({points, month, compact, details}: {points: MonthlyExamPoint[]; month: string; compact: boolean; details: Map<string, ChartDetail>}) {
  const id = useId().replaceAll(':', '');
  const tooltip = useChartTooltip();
  const {min, max, ticks} = bounds(points);
  const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const left = compact ? 42 : 55, right = compact ? 304 : 650, top = 26, bottom = 197;
  const x = (day: number) => left + ((day - 1) / Math.max(1, days - 1)) * (right - left);
  const y = (net: number) => bottom - ((net - min) / Math.max(1, max - min)) * (bottom - top);
  const xTicks = compact ? [...new Set([1, Math.round(days / 3), Math.round(days * 2 / 3), days])] : [...new Set([1, Math.round(days / 4), Math.round(days / 2), Math.round(days * 3 / 4), days])];
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${x(Number(point.date.slice(-2)))} ${y(point.net)}`).join(' ');
  const firstX = points.length ? x(Number(points[0].date.slice(-2))) : left;
  const lastX = points.length ? x(Number(points[points.length - 1].date.slice(-2))) : left;
  const area = points.length > 1 ? `${line} L ${lastX} ${y(0)} L ${firstX} ${y(0)} Z` : '';

  const width = compact ? 328 : 684;
  return <div className={`monthly-exam-plot-wrap ${compact ? 'monthly-exam-plot-mobile' : 'monthly-exam-plot-desktop'}`} role="group" aria-label="Günlük net ayrıntıları">
      <svg className="monthly-exam-plot" viewBox={`0 0 ${width} 246`} role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>{monthName(month)} net gelişimi</title>
        <desc id={`${id}-description`}>{points.length ? `${points.length} kayıt günü; yatay eksen ayın günü, dikey eksen net.` : 'Bu seçimde çizilecek net sonucu yok.'}</desc>
        <defs>
          <linearGradient id={`${id}-line`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--feature-mid)"/>
            <stop offset="0.55" stopColor="var(--feature-glow)"/>
            <stop offset="1" stopColor="var(--ring-2)"/>
          </linearGradient>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--feature-glow)" stopOpacity="0.24"/>
            <stop offset="1" stopColor="var(--feature-glow)" stopOpacity="0"/>
          </linearGradient>
        </defs>
        {ticks.map(tick => <g key={tick}>
          <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'monthly-exam-zero' : 'monthly-exam-gridline'}/>
          <text x={left - 12} y={y(tick) + 4} textAnchor="end" className="monthly-exam-axis-tick">{netNumber.format(tick)}</text>
        </g>)}
        {xTicks.map(day => <g key={day}>
          <line x1={x(day)} x2={x(day)} y1={bottom} y2={bottom + 5} className="monthly-exam-axis-mark"/>
          <text x={x(day)} y={bottom + 21} textAnchor="middle" className="monthly-exam-axis-tick">{day}</text>
        </g>)}
        <text x={compact ? 7 : 14} y="18" className="monthly-exam-axis-label">NET</text>
        <text x={right} y="240" textAnchor="end" className="monthly-exam-axis-label">AYIN GÜNÜ</text>
        {area && <path d={area} fill={`url(#${id}-fill)`}/>}
        {line && <path d={line} fill="none" stroke={`url(#${id}-line)`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="monthly-exam-line"/>}
        {points.map(point => {
          const cx = x(Number(point.date.slice(-2))), cy = y(point.net);
          return <g key={point.date}>
            <circle cx={cx} cy={cy} r="8" className="monthly-exam-point-halo"/>
            <circle cx={cx} cy={cy} r="4.5" className="monthly-exam-point"/>
          </g>;
        })}
      </svg>
      {points.map(point => <ChartPoint key={point.date} pointKey={point.date}
        x={x(Number(point.date.slice(-2))) / width * 100} y={y(point.net) / 246 * 100}
        detail={details.get(point.date)!} tooltip={tooltip}/>)}
      {tooltip.tooltip}
    </div>;
}

function MonthlyPlot({points, month, exams, format}: {points: MonthlyExamPoint[]; month: string; exams: ExamRecord[]; format: ExamFormatCode}) {
  const matchingExams = exams.filter(exam => exam.format_code === format && exam.exam_date.startsWith(`${month}-`) && exam.total_net !== null);
  const details = new Map(points.map(point => {
    const dayExams = matchingExams.filter(exam => exam.exam_date === point.date);
    return [point.date, {
      title: formatDay(point.date, {day: 'numeric', month: 'long', year: 'numeric'}),
      value: `${netNumber.format(point.net)} net`,
      context: dayExams.map(exam => exam.name).join(' · '),
      note: `${formats.find(item => item.code === format)?.label} · ${point.count > 1 ? `${point.count} denemenin günlük ortalaması` : '1 deneme'}`,
    }];
  }));
  return <div className="monthly-exam-plot-frame">
    <div className="monthly-exam-plot-scroll">
      <PlotSvg points={points} month={month} compact={false} details={details}/>
      <PlotSvg points={points} month={month} compact={true} details={details}/>
    </div>
    {!points.length && <div className="monthly-exam-empty"><strong>Bu ay henüz net sonucu yok</strong><span>İlk denemeni kaydettiğinde gelişim çizgisi burada oluşacak.</span></div>}
    <table className="sr-only"><caption>{monthName(month)} günlük net sonuçları</caption><thead><tr><th scope="col">Tarih</th><th scope="col">Ortalama net</th><th scope="col">Deneme sayısı</th></tr></thead><tbody>{points.map(point => <tr key={point.date}><td>{point.date}</td><td>{netNumber.format(point.net)}</td><td>{point.count}</td></tr>)}</tbody></table>
  </div>;
}

export function MonthlyExamChart({exams, preview, onOpen}: {exams: ExamRecord[]; preview: boolean; onOpen: () => void}) {
  const currentMonth = localDate().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [format, setFormat] = useState<ExamFormatCode>(() => exams.find(exam => exam.exam_date.startsWith(`${currentMonth}-`))?.format_code ?? 'TYT');
  const points = useMemo(() => monthlyExamSeries(exams, month, format), [exams, month, format]);
  const resultCount = points.reduce((sum, point) => sum + point.count, 0);
  const first = points[0], latest = points.at(-1);
  const change = first && latest && first !== latest ? latest.net - first.net : null;
  const unplottedCount = exams.filter(exam => exam.format_code === format && exam.exam_date.startsWith(`${month}-`) && exam.total_net === null).length;

  return <Card className="ambient-card monthly-exam-chart-card" title="Aylık deneme gelişimin" eyebrow={preview ? 'ÖRNEK ÖNİZLEME · NET ANALİZİ' : 'DENEME ANALİZİ · NET GELİŞİMİ'} action={<button className="monthly-exam-open" type="button" onClick={onOpen}>Tüm analiz<ArrowUpRight size={15}/></button>}>
    <div className="monthly-exam-controls">
      <div className="monthly-exam-month" aria-label="Grafik ayı">
        <button type="button" aria-label="Önceki ay" onClick={() => setMonth(value => shiftMonth(value, -1))}><ChevronLeft size={17}/></button>
        <strong aria-live="polite">{monthName(month)}</strong>
        <button type="button" aria-label="Sonraki ay" disabled={month >= currentMonth} onClick={() => setMonth(value => shiftMonth(value, 1))}><ChevronRight size={17}/></button>
      </div>
      <label className="monthly-exam-format">Deneme türü
        <select value={format} onChange={event => setFormat(event.target.value as ExamFormatCode)}>{formats.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select>
      </label>
    </div>
    <div className="monthly-exam-summary" aria-live="polite">
      <div><span>Son net</span><strong>{latest ? netNumber.format(latest.net) : '—'}</strong></div>
      <div><span>İlk sonuca göre</span><strong className={change === null ? '' : change >= 0 ? 'is-positive' : 'is-negative'}>{change === null ? '—' : `${change > 0 ? '+' : ''}${netNumber.format(change)}`}</strong></div>
      <div><span>Bu ay</span><strong>{resultCount} <small>deneme</small></strong></div>
    </div>
    <MonthlyPlot key={`${month}-${format}`} points={points} month={month} exams={exams} format={format}/>
    <p className="monthly-exam-note">Ayrıntı için bir noktaya gel veya dokun. Her nokta bir günün net ortalamasıdır; boş günler sıfır sayılmaz.{unplottedCount ? ` Toplam neti olmayan ${unplottedCount} kayıt çizilmedi.` : ''}{format === 'BRANCH' ? ' Farklı soru sayılı branş denemelerini ayrı değerlendir.' : ''}</p>
  </Card>;
}
