'use client';

import {Fragment} from 'react';
import type {NovaWebState} from '@/lib/nova/web-types';
import {ChartPoint, useChartTooltip} from '../chart-tooltip';
import {number} from './view-utils';
import styles from './race-charts.module.css';

const components = [
  ['tasks', 'Görev tamamlama'], ['study', 'Çalışma hedefi'], ['questions', 'Soru çalışması'],
  ['topics', 'Konu ilerlemesi'], ['consistency', 'İstikrar'],
] as const;
const series = [{key: 'userScore', label: 'Sen', className: styles.user}, {key: 'novaScore', label: 'Nova', className: styles.nova}] as const;
const score = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const points = (value: number | null) => value === null ? 'Kayıt yok' : `${number(value)} puan`;
const dateLabel = (date: string, long = false) => new Intl.DateTimeFormat('tr-TR', {day: 'numeric', month: long ? 'long' : 'short', timeZone: 'UTC'}).format(new Date(`${date}T12:00:00Z`));

function Legend() {
  return <div className={styles.legend} aria-label="Grafik açıklaması"><span><i className={styles.user}/>Sen</span><span><i className={styles.nova}/>Nova</span></div>;
}

export function RaceComponentChart({race}: {race: NonNullable<NovaWebState['race']>}) {
  return <div className={styles.components}>
    <div className={styles.chartMeta}><Legend/><span>0–100 puan</span></div>
    <ul className={styles.componentList}>{components.map(([key, label]) => <li key={key}>
      <div className={styles.componentHeading}><strong>{label}</strong><span>Puan ağırlığı %{number(race.user.weights[key] * 100)}</span></div>
      {(['user', 'nova'] as const).map((person, index) => {
        const value = score(race[person].components[key]);
        return <div className={`${styles.barRow} ${series[index].className}`} key={person}>
          <span>{series[index].label}</span><div className={styles.barTrack} aria-hidden="true">{value !== null && <i style={{width: `${value}%`}}/>}</div><strong>{points(value)}</strong>
        </div>;
      })}
    </li>)}</ul>
    <p className={styles.note}>Çubuklar bileşen puanını, ağırlıklar toplam puana etkisini gösterir.</p>
  </div>;
}

export function RaceWeeklyChart({days}: {days: NovaWebState['weekly']}) {
  const tooltip = useChartTooltip();
  const ordered = [...days].sort((a, b) => a.localDate.localeCompare(b.localDate)).map(day => ({...day, userScore: score(day.userScore), novaScore: score(day.novaScore)}));
  const available = ordered.some(day => day.userScore !== null || day.novaScore !== null);
  const x = (index: number) => ordered.length === 1 ? 50 : 5 + index * 90 / (ordered.length - 1);
  const provisional = ordered.some(day => !day.finalized);

  return <div className={styles.weeklyChart}>
    <div className={styles.chartMeta}><Legend/><span>Günlük puan · 100 üzerinden</span></div>
    {!available ? <div className={styles.empty}><strong>Grafik ilk puanlarınla oluşacak</strong><p>Eksik kayıtlar sıfır puan olarak gösterilmez.</p></div> : <>
      <div className={styles.chartFrame} role="group" aria-label="Son kayıtlı günlerde Sen ve Nova puanları">
        <div className={styles.yAxis} aria-hidden="true">{[100, 75, 50, 25, 0].map(value => <span key={value} style={{top: `${100 - value}%`}}>{value}</span>)}</div>
        <div className={styles.plot}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {[0, 25, 50, 75, 100].map(value => <line key={value} className={styles.gridLine} x1="0" x2="100" y1={value} y2={value}/>)}
            {series.map(({key, className}) => <g key={key} className={className}>
              {ordered.map((day, index) => {
                const previous = ordered[index - 1];
                const value = day[key];
                const previousValue = previous?.[key];
                if (value === null || previousValue == null) return null;
                return <line key={day.localDate} className={styles.seriesLine} data-provisional={!day.finalized || !previous.finalized} x1={x(index - 1)} y1={100 - previousValue} x2={x(index)} y2={100 - value}/>;
              })}
            </g>)}
          </svg>
          {ordered.map((day, index) => {
            const detail = {title: dateLabel(day.localDate, true), value: `Sen ${points(day.userScore)} · Nova ${points(day.novaScore)}`, context: day.finalized ? 'Kesinleşmiş gün' : 'Gün sürüyor · Geçici puan', note: day.userScore === null || day.novaScore === null ? 'Eksik kayıt sıfır sayılmaz; bu gün haftalık toplama katılmaz.' : !day.finalized ? 'Devam eden gün haftalık toplama katılmaz.' : undefined};
            return <Fragment key={day.localDate}>
              {series.map(({key, className}) => day[key] === null ? null : <Fragment key={key}>
                <i className={`${styles.marker} ${className}`} data-provisional={!day.finalized} style={{left: `${x(index)}%`, top: `${100 - day[key]}%`}} aria-hidden="true"/>
                <ChartPoint pointKey={`${day.localDate}-${key}`} x={x(index)} y={100 - day[key]} tooltip={tooltip} detail={detail}/>
              </Fragment>)}
              {day.userScore === null && day.novaScore === null && <ChartPoint pointKey={day.localDate} x={x(index)} y={100} tooltip={tooltip} detail={detail}/>}
            </Fragment>;
          })}
        </div>
        <div className={styles.xAxis}>{ordered.map((day, index) => <span key={day.localDate} style={{left: `${x(index)}%`}} data-provisional={!day.finalized}>{dateLabel(day.localDate)}{!day.finalized && <b>•</b>}</span>)}</div>
      </div>
      <p className={styles.note}>{ordered.length === 1 ? 'İlk günün puanları burada. Yeni günler eklendikçe eğilimin görünür.' : 'Puanları görmek için grafikteki güne dokun veya klavyeyle seç.'}{provisional && ' İçi boş işaretler günün geçici puanlarıdır.'} Eksik puanlarda çizgi kesilir.</p>
    </>}
    {tooltip.tooltip}
  </div>;
}
