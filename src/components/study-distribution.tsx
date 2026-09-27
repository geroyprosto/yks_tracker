'use client';

import {useState, type CSSProperties} from 'react';
import type {StudyReport} from '@/lib/study-report';
import {duration} from '@/lib/ui';
import {Card} from './primitives';
import {Donut} from './progress-ring';

const options = [
  {id: 'subjects', label: 'Dersler'},
  {id: 'topics', label: 'Konular'},
  {id: 'studyTypes', label: 'Çalışma türü'},
] as const;
type Dimension = typeof options[number]['id'];

export function StudyDistribution({report}: {report: StudyReport}) {
  const [dimension, setDimension] = useState<Dimension>('subjects');
  const source = report[dimension];
  const total = source.reduce((sum, row) => sum + row.seconds, 0);
  const displayed = source.length > 5 ? [...source.slice(0, 4), {label: 'Diğer', key: '__other__', seconds: source.slice(4).reduce((sum, row) => sum + row.seconds, 0)}] : source;
  const rows = displayed.map((row, color) => ({...row, key: row.key??row.label, color, value: total ? row.seconds / total * 100 : 0}));
  const legend = (items: typeof rows) => <ul className="distribution-legend">{items.map(row => <li key={row.key}>
    <span className="legend-dot" style={{'--legend-color': 'var(--ring-' + (row.color + 1) + ')'} as CSSProperties}/>
    <div><strong>{row.label}</strong><small>{duration(row.seconds)}</small></div>
    <b>%{new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 1}).format(row.value)}</b>
  </li>)}</ul>;
  return <Card title="Zamanını nasıl paylaştın?" className="study-panel distribution-card study-distribution-card"
    action={<select aria-label="Dağılım ölçütü" className="study-distribution-select" value={dimension} onChange={event => setDimension(event.target.value as Dimension)}>
      {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>}>
    <div className="distribution-content">
      <Donut segments={rows} center={duration(total)} caption="TOPLAM ÇALIŞMA" empty={total === 0}
        label={total === 0 ? 'Seçili dönemde çalışma kaydı yok.' : rows.map(row => row.label + ': ' + duration(row.seconds) + ', %' + row.value.toFixed(1)).join('; ')}/>
      {total === 0 ? <div className="distribution-empty"><h3>Bu dönem henüz boş.</h3><p>Çalışmalarını kaydettikçe sürelerini ve dağılımını burada göreceksin.</p></div> : legend(rows)}
    </div>
    {source.length > 5 && <details className="distribution-all"><summary>Tüm dağılımı gör · {source.length} başlık</summary>
      {legend(source.map((row, index) => ({...row, key: row.key??row.label, color: Math.min(index, 4), value: row.seconds / total * 100})))}
    </details>}
    <p className="footnote">Seçili dönemin net çalışma süresi · Molalar hariç.</p>
  </Card>;
}

