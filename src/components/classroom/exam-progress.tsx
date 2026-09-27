'use client';

import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {ChevronDown} from 'lucide-react';
import type {ExamRecord} from '@/lib/domain/types';
import {formatDay} from '@/lib/ui';
import {ChartPoint, useChartTooltip} from '../chart-tooltip';
import styles from './exam-progress.module.css';

type Format = 'TYT' | 'AYT_SAYISAL';
const number = new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 2});
const formatName: Record<Format, string> = {TYT: 'TYT', AYT_SAYISAL: 'AYT'};

function completed(exams: ExamRecord[], format: Format, today: string) {
  return exams.filter(exam => exam.format_code === format && exam.exam_date <= today &&
    exam.total_net !== null && Number.isFinite(exam.total_net))
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date) ||
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

function tickStep(span: number) {
  const order = 10 ** Math.floor(Math.log10(Math.max(span, 0.01) / 4));
  return ([1, 2, 2.5, 5, 10].find(multiplier => multiplier * order >= span / 4) ?? 10) * order;
}

function plotBounds(exams: ExamRecord[]) {
  const values = exams.map(exam => exam.total_net!);
  const low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max(2, (high - low) * 0.18);
  const step = tickStep(high - low + 2 * padding);
  const min = Math.floor((low - padding) / step) * step;
  const max = Math.ceil((high + padding) / step) * step;
  const ticks: number[] = [];
  for (let value = min; value <= max + step / 2; value += step) ticks.push(Number(value.toFixed(8)));
  return {min, max, ticks};
}

function ProgressPlot({exams, format}: {exams: ExamRecord[]; format: Format}) {
  const id = useId().replaceAll(':', '');
  const tooltip = useChartTooltip(styles.teacherTooltip);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setContainerWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = Math.max(exams.length === 1 ? 240 : 500, containerWidth, exams.length * 72 + 88);
  const height = 232, left = 48, right = width - 31, top = 26, bottom = 174;
  const {min, max, ticks} = plotBounds(exams);
  const x = (index: number) => exams.length === 1 ? (left + right) / 2 : left + index * (right - left) / (exams.length - 1);
  const y = (value: number) => bottom - (value - min) / Math.max(1, max - min) * (bottom - top);
  const line = exams.map((exam, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(exam.total_net!)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(exams.length / Math.max(2, width / 110)));

  return <div ref={scrollRef} className={styles.scroll} role="region" aria-label={`${formatName[format]} net gelişimi, yatay kaydırılabilir grafik`} tabIndex={0}>
    <div className={styles.plot} style={{width, height}}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>{formatName[format]} net gelişimi</title>
        <desc id={`${id}-desc`}>{exams.length} tamamlanmış deneme; yatay eksen denemeler, dikey eksen net. Noktalara gelerek ayrıntılarını görebilirsin.</desc>
        {ticks.map(tick => <g key={tick}>
          <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className={styles.gridLine}/>
          <text x={left - 11} y={y(tick) + 4} textAnchor="end" className={styles.axisText}>{number.format(tick)}</text>
        </g>)}
        <text x={left} y="15" className={styles.axisLabel}>NET</text>
        {exams.length > 1 && <path d={line} className={styles.line}/>}
        {exams.map((exam, index) => <g key={exam.id}>
          <circle cx={x(index)} cy={y(exam.total_net!)} r="5.5" className={styles.dot}/>
          {(index === 0 || index === exams.length - 1 || index % labelEvery === 0) &&
            <text x={x(index)} y="204" textAnchor="middle" className={styles.dateText}>
              {formatDay(exam.exam_date, {day: 'numeric', month: 'short'})}
            </text>}
        </g>)}
      </svg>
      {exams.map((exam, index) => <ChartPoint key={exam.id} pointKey={exam.id}
        x={x(index) / width * 100} y={y(exam.total_net!) / height * 100}
        detail={{
          title: formatDay(exam.exam_date, {day: 'numeric', month: 'long', year: 'numeric'}),
          value: `${number.format(exam.total_net!)} net`,
          context: exam.name,
          note: [formatName[format], exam.publisher].filter(Boolean).join(' · '),
        }} tooltip={tooltip}/>)}
    </div>
    {tooltip.tooltip}
    <table className={styles.srOnly}><caption>{formatName[format]} denemelerinin net gelişimi</caption>
      <thead><tr><th scope="col">Tarih</th><th scope="col">Deneme</th><th scope="col">Net</th></tr></thead>
      <tbody>{exams.map(exam => <tr key={exam.id}><td>{exam.exam_date}</td><td>{exam.name}</td><td>{number.format(exam.total_net!)}</td></tr>)}</tbody>
    </table>
  </div>;
}

export function StudentExamProgress({exams, today, studentId}: {exams: ExamRecord[]; today: string; studentId: string}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>(() => completed(exams, 'TYT', today).length ? 'TYT' : 'AYT_SAYISAL');
  const panelId = `exam-progress-${studentId}`;
  const results = useMemo(() => completed(exams, format, today), [exams, format, today]);
  const first = results[0], latest = results.at(-1);
  const change = first && latest && first !== latest ? latest.total_net! - first.total_net! : null;

  return <section className={styles.card} aria-label="Deneme net gelişimi">
    <div className={styles.heading}>
      <div><h3>Net gelişimi</h3><p>Öğrencinin tamamlanmış TYT ve AYT denemeleri</p></div>
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(value => !value)}>{open ? 'Grafiği gizle' : 'Grafiği göster'}<ChevronDown size={16} aria-hidden="true" className={open ? styles.openChevron : undefined}/></button>
    </div>
    <div id={panelId} hidden={!open}>
      {open && <div className={styles.content}>
        <div className={styles.formatSwitch} role="group" aria-label="Grafik deneme türü">
          <button type="button" aria-pressed={format === 'TYT'} onClick={() => setFormat('TYT')}>TYT</button>
          <button type="button" aria-pressed={format === 'AYT_SAYISAL'} onClick={() => setFormat('AYT_SAYISAL')}>AYT</button>
        </div>
        {results.length ? <>
          <div className={styles.summary} aria-live="polite">
            <div><span>Son net</span><strong>{number.format(latest!.total_net!)}</strong></div>
            <div><span>İlk kayda göre</span><strong data-trend={change === null ? 'none' : change >= 0 ? 'up' : 'down'}>{change === null ? '—' : `${change > 0 ? '+' : ''}${number.format(change)}`}</strong></div>
            <div><span>Deneme sayısı</span><strong>{results.length}</strong></div>
          </div>
          <ProgressPlot key={format} exams={results} format={format}/>
          <p className={styles.note}>Her nokta bir deneme sonucudur. Ayrıntı için noktaya gel veya dokun.<span className={styles.mobileHint}> Grafiği yana kaydırabilirsin.</span></p>
        </> : <p className={styles.empty}>Henüz tamamlanmış {formatName[format]} denemesi yok.</p>}
      </div>}
    </div>
  </section>;
}
