'use client';

import {useId} from 'react';
import type {ExamGrouping, ExamMeasure, ExamPoint} from '@/lib/exam-analysis';
import type {ExamRecord} from '@/lib/domain/types';
import {formatDay} from '@/lib/ui';
import {ChartPoint, useChartTooltip, type ChartDetail} from './chart-tooltip';

const number = new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 2});
const measureLabels: Record<ExamMeasure, string> = {net: 'net', accuracy: '% doğruluk', 'seconds-per-question': 'sn / soru'};

export function ExamPlot({points, measure, exams, grouping, sectionLabel}: {
  points: ExamPoint[]; measure: ExamMeasure; exams: ExamRecord[]; grouping: ExamGrouping; sectionLabel: string;
}) {
  const id = useId().replaceAll(':', '');
  const tooltip = useChartTooltip();
  const width = Math.max(420, points.length * 76 + 56), height = 192;
  const values = points.flatMap(point => point.value === null ? [] : [point.value]);
  const min = Math.min(0, ...values), max = Math.max(0, ...values), span = Math.max(1, max - min);
  const x = (index: number) => points.length === 1 ? width / 2 : 36 + index * (width - 72) / (points.length - 1);
  const y = (value: number) => 141 - (value - min) / span * 101;
  const segments: string[] = [];
  let current = '';
  points.forEach((point, index) => {
    if (point.value === null) {if (current) segments.push(current); current = ''; return;}
    current += `${current ? ' L' : 'M'} ${x(index)} ${y(point.value)}`;
  });
  if (current) segments.push(current);
  const examById = new Map(exams.map(exam => [exam.id, exam]));
  function detail(point: ExamPoint): ChartDetail {
    const exam = grouping === 'exam' ? examById.get(point.key) : undefined;
    const date = formatDay(point.date, grouping === 'month' ? {month: 'long', year: 'numeric'} : {day: 'numeric', month: 'long', year: 'numeric'});
    return {
      title: grouping === 'week' ? `${date} haftası` : date,
      value: `${number.format(point.value!)} ${measureLabels[measure]}`,
      context: exam?.name ?? `${point.count} denemenin ${grouping === 'month' ? 'aylık' : 'haftalık'} ortalaması`,
      note: [sectionLabel, exam?.publisher].filter(Boolean).join(' · '),
    };
  }

  return <div className="exam-plot-scroll">
    <div className="exam-plot-canvas" style={{minWidth: width}} role="group" aria-label="Deneme noktalarının ayrıntıları">
      <svg className="exam-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${points.length} dönemlik ${measure === 'net' ? 'net' : measure === 'accuracy' ? 'doğruluk' : 'hız'} grafiği`}>
        <defs><linearGradient id={`${id}-line`} x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="var(--feature-mid)"/><stop offset="1" stopColor="var(--feature-glow)"/></linearGradient></defs>
        <line x1="22" x2={width - 22} y1={y(0)} y2={y(0)} className="exam-zero-line"/>
        {segments.map((path, index) => <path key={index} d={path} fill="none" stroke={`url(#${id}-line)`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>)}
        {points.map((point, index) => <g key={point.key}>
          {point.value !== null && <>
            <circle cx={x(index)} cy={y(point.value)} r="5.5" className="exam-plot-dot"/>
            <text x={x(index)} y={Math.max(17, y(point.value) - 15)} textAnchor="middle" className="exam-plot-value">{number.format(point.value)}</text>
          </>}
          <text x={x(index)} y="177" textAnchor="middle" className="exam-plot-date">{point.label}</text>
        </g>)}
      </svg>
      {points.map((point, index) => point.value === null ? null : <ChartPoint key={point.key} pointKey={point.key}
        x={x(index) / width * 100} y={y(point.value) / height * 100} detail={detail(point)} tooltip={tooltip}/>)}
    </div>
    {tooltip.tooltip}
  </div>;
}
