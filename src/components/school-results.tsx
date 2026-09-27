'use client';

import {useRef, useState} from 'react';
import {ChartNoAxesCombined, PenLine} from 'lucide-react';
import type {CourseExamResult, EducationState} from '@/lib/education';
import {assessmentTypes, filterSchoolResults, schoolResultSummary, validateResultDrafts, type ResultDraft} from '@/lib/school-results';
import {formatDay} from '@/lib/ui';
import {Card, Empty} from './primitives';
import {Modal} from './modal';
import {ChartPoint, useChartTooltip} from './chart-tooltip';
import {SchoolResultsEntry, type EducationResultCommand} from './school-results-entry';
import styles from './school-results.module.css';

const number = new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 2});
const tr = (value: number) => number.format(value);

export function SchoolResults({education, command, busy}: {education: EducationState; command: EducationResultCommand; busy: boolean}) {
  const activeTerm = education.terms.find(term => term.id === education.profile?.active_term_id);
  const activeCourses = education.courses.filter(course => course.context === 'school' && !course.archived && course.term_id === education.profile?.active_term_id);
  return <div className={styles.page}>
    <div className={styles.intro}><div><p className="eyebrow">DERS SINAVLARI</p><h2>Sonuçlarını ders ders takip et.</h2><p>Yazılı, vize ve final puanlarını kendi ölçekleriyle sakla. YKS denemelerin ayrı kalır.</p></div><span className="pill">{education.results.length} sonuç</span></div>
    <SchoolResultsEntry key={education.profile?.active_term_id ?? 'no-term'} courses={activeCourses} command={command} busy={busy} canCommit={education.can_commit} termLabel={activeTerm ? `${activeTerm.academic_year} · ${activeTerm.name}` : 'AKTİF DÖNEM'}/>
    <SchoolResultsAnalysis education={education} command={command} busy={busy}/>
  </div>;
}

function SchoolResultsAnalysis({education, command, busy}: {education: EducationState; command: EducationResultCommand; busy: boolean}) {
  const [term, setTerm] = useState(education.profile?.active_term_id ?? '');
  const [selectedCourse, setSelectedCourse] = useState(''), [type, setType] = useState('');
  const [start, setStart] = useState(''), [end, setEnd] = useState('');
  const [percent, setPercent] = useState(false), [editing, setEditing] = useState<CourseExamResult | null>(null);
  const courseOptions = education.courses.filter(course => course.context === 'school' && (!term || course.term_id === term));
  const course = courseOptions.some(item => item.id === selectedCourse) ? selectedCourse : courseOptions[0]?.id ?? '';
  const courseName = courseOptions.find(item => item.id === course)?.name ?? '';
  const types = [...new Set(education.results.filter(result => result.course_id === course && (!term || result.term_id === term)).map(result => result.assessment_type))].sort((a, b) => a.localeCompare(b, 'tr'));
  const selectedType = !type || types.includes(type) ? type : '';
  const filtered = course ? filterSchoolResults(education.results, {course, term, start, end, type: selectedType}) : [];
  const summary = schoolResultSummary(filtered, percent), latest = summary.latest;
  const invalidRange = Boolean(start && end && start > end);
  return <Card title="Ders sonuçlarının değişimi" eyebrow="SONUÇLAR VE ARŞİV" action={<ChartNoAxesCombined size={18}/>} className={styles.analysis}>
    <div className={styles.filters}>
      <label>Sonuç dönemi<select value={term} onChange={event => {setTerm(event.target.value); setSelectedCourse(''); setType('');}}><option value="">Tüm dönemler</option>{education.terms.map(item => <option key={item.id} value={item.id}>{item.academic_year} · {item.name}{item.archived ? ' · Arşiv' : ''}</option>)}</select></label>
      <label>Grafikteki ders<select value={course} onChange={event => {setSelectedCourse(event.target.value); setType('');}}>{!courseOptions.length && <option value="">Ders yok</option>}{courseOptions.map(item => <option key={item.id} value={item.id}>{item.name}{!term ? ` · ${education.terms.find(entry => entry.id === item.term_id)?.name ?? 'Dönemsiz'}` : ''}{item.archived ? ' · Arşiv' : ''}</option>)}</select></label>
      <label>Sonuç türü<select value={selectedType} onChange={event => setType(event.target.value)}><option value="">Tüm türler</option>{types.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Başlangıç tarihi<input type="date" value={start} onChange={event => setStart(event.target.value)}/></label>
      <label>Bitiş tarihi<input type="date" value={end} onChange={event => setEnd(event.target.value)}/></label>
      <label>Grafik ölçeği<select value={percent ? 'percentage' : 'original'} onChange={event => setPercent(event.target.value === 'percentage')}><option value="original">Orijinal puan</option><option value="percentage">Yüzdeye dönüştür</option></select></label>
    </div>
    {invalidRange && <p className="error-text" role="alert">Bitiş tarihi başlangıçtan önce olamaz.</p>}
    <div className={styles.summary}>
      <div><span>Son sonuç</span><strong>{latest ? percent ? `%${tr(latest.score / latest.scale * 100)}` : `${tr(latest.score)} / ${tr(latest.scale)}` : '—'}</strong><small>{latest ? `${latest.assessment_type}${latest.assessment_name ? ` · ${latest.assessment_name}` : ''}` : 'Kayıt yok'}</small></div>
      <div><span>Önceki aynı seri kaydına göre</span><strong>{summary.difference === null ? '—' : `${summary.difference >= 0 ? '+' : ''}${tr(summary.difference)}`}</strong><small>{summary.difference === null ? 'Karşılaştırılabilir iki sonuç gerekli' : summary.differenceLabel}</small></div>
      <div><span>Seçili kayıt sayısı</span><strong>{filtered.length}</strong><small>{selectedType || 'Türler ayrı etiketlenir'}</small></div>
    </div>
    {!filtered.length ? <Empty icon={<ChartNoAxesCombined/>} title="Bu seçimde sonuç yok" text="Bir puan kaydet veya dönem ve tarih filtrelerini değiştir."/> : <>
      {summary.mixedScale && !percent ? <p className={styles.notice}>Bu kayıtlarda farklı puan ölçekleri var. Birlikte çizmek için “Yüzdeye dönüştür” seçeneğini kullan.</p> : <SchoolResultsPlot records={filtered} percent={percent} courseName={courseName}/>}
      {filtered.length < 2 && <p className={styles.note}>Henüz yalnız bir sonuç var; değişim için en az iki karşılaştırılabilir kayıt gerekli.</p>}
      <div className={styles.tableScroll}><table className={styles.table}><caption>{courseName} sonuç kayıtları</caption><thead><tr><th scope="col">Tarih / ders</th><th scope="col">Değerlendirme</th><th scope="col">Orijinal sonuç</th><th scope="col"><span className="sr-only">İşlem</span></th></tr></thead><tbody>{[...filtered].reverse().map(result => <tr key={result.id}><td><strong>{formatDay(result.exam_date, {day: 'numeric', month: 'short', year: 'numeric'})}</strong><small>{result.course_name}</small></td><td>{result.assessment_type}<small>{result.assessment_name}</small></td><td><strong>{tr(result.score)} / {tr(result.scale)}</strong>{percent && <small>%{tr(result.score / result.scale * 100)}</small>}</td><td><button type="button" className="icon-button" aria-label={`${result.course_name} ${result.assessment_type} ${result.exam_date} sonucunu düzenle`} disabled={busy || !education.can_commit} onClick={() => setEditing(result)}><PenLine size={16}/></button></td></tr>)}</tbody></table></div>
    </>}
    <p className={styles.note}>Puan farkı öğrenme artışı değildir. Vize ve final otomatik karşılaştırılmaz; farklı sınavlar aynı zorlukta kabul edilmez. Yüzde görünümü yalnız ölçeği dönüştürür. Eksik sınavlar sıfır sayılmaz; dönem notu veya harf notu hesaplanmaz.</p>
    {editing && <SchoolResultEditor result={editing} command={command} busy={busy} onClose={() => setEditing(null)}/>}
  </Card>;
}

function SchoolResultsPlot({records, percent, courseName}: {records: CourseExamResult[]; percent: boolean; courseName: string}) {
  const tooltip = useChartTooltip();
  const width = Math.max(400, records.length * 90 + 40), height = 190;
  const value = (record: CourseExamResult) => percent ? record.score / record.scale * 100 : record.score;
  const max = Math.max(1, ...records.map(record => percent ? 100 : record.scale));
  const x = (index: number) => records.length === 1 ? width / 2 : 42 + index * (width - 84) / (records.length - 1);
  const y = (record: CourseExamResult) => 140 - value(record) / max * 110;
  // Only connect successive results sharing an assessment type and name.
  return <div className="exam-plot-scroll"><div className="exam-plot-canvas" style={{minWidth: width}} role="group" aria-label={`${courseName} sonuç noktaları`}>
    <svg className="exam-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${courseName} için ${records.length} sınav sonucu; ${percent ? 'yüzde' : 'puan'} grafiği`}>
      <line x1="22" x2={width - 22} y1="140" y2="140" className="exam-zero-line"/>
      {records.map((record, index) => {const previous = records[index - 1]; return <g key={record.id}>
        {previous && previous.assessment_type === record.assessment_type && previous.assessment_name === record.assessment_name && <line x1={x(index - 1)} y1={y(previous)} x2={x(index)} y2={y(record)} stroke="var(--primary)" strokeWidth="2"/>}
        <circle cx={x(index)} cy={y(record)} r="5.5" className="exam-plot-dot"/>
        <text x={x(index)} y={Math.max(18, y(record) - 13)} textAnchor="middle" className="exam-plot-value">{percent ? '%' : ''}{tr(value(record))}</text>
        <text x={x(index)} y="174" textAnchor="middle" className="exam-plot-date">{formatDay(record.exam_date, {day: 'numeric', month: 'short'})}</text>
      </g>;})}
    </svg>
    {records.map((record, index) => <ChartPoint key={record.id} pointKey={record.id} x={x(index) / width * 100} y={y(record) / height * 100} tooltip={tooltip} detail={{title: `${courseName} · ${formatDay(record.exam_date, {day: 'numeric', month: 'long'})}`, value: `${tr(record.score)} / ${tr(record.scale)}${percent ? ` · %${tr(value(record))}` : ''}`, context: [record.assessment_type, record.assessment_name].filter(Boolean).join(' · '), note: 'Bir sınav kaydı; çalışma süresi ve konu hâkimiyetinden ayrı değerlendirilir.'}}/>)}
  </div>{tooltip.tooltip}</div>;
}

function SchoolResultEditor({result, command, busy, onClose}: {result: CourseExamResult; command: EducationResultCommand; busy: boolean; onClose: () => void}) {
  const [draft, setDraft] = useState<ResultDraft>({...result, score: String(result.score), scale: String(result.scale)});
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const inFlight = useRef(false), request = useRef<{key: string; id: string} | null>(null);
  const types: string[] = assessmentTypes.includes(result.assessment_type as typeof assessmentTypes[number]) ? [...assessmentTypes] : [...assessmentTypes, result.assessment_type];
  return <Modal title="Ders sınavını düzenle" onClose={onClose}><form className={styles.editor} onSubmit={async event => {
    event.preventDefault(); if (inFlight.current || busy) return;
    const checked = validateResultDrafts([draft], new Set([result.course_id]));
    if (checked.issues.length || !checked.rows.length) {setError(checked.issues[0]?.message ?? 'Puan boş bırakılamaz.'); return;}
    const row = checked.rows[0];
    const payload = {id: result.id, expected_revision: result.revision, exam_date: row.exam_date, assessment_type: row.assessment_type, assessment_name: row.assessment_name, score: row.score, scale: row.scale};
    const key = JSON.stringify(payload); if (request.current?.key !== key) request.current = {key, id: crypto.randomUUID()};
    setError(''); inFlight.current = true; setSaving(true);
    try {if (await command('result.update', payload, request.current.id)) onClose(); else setError('Değişiklik kaydedilemedi. Taslağın korunuyor.');}
    catch {setError('Bağlantı kurulamadı. Taslağın korunuyor.');}
    finally {inFlight.current = false; setSaving(false);}
  }}><p><strong>{result.course_name}</strong> · Ders ilişkisi ve çalışma süreleri korunur.</p><fieldset className={styles.fieldset} disabled={busy || saving}><div className={styles.fields}>
    <label>Sınav tarihi<input type="date" value={draft.exam_date} onChange={event => setDraft({...draft, exam_date: event.target.value})}/></label>
    <label>Değerlendirme türü<select value={draft.assessment_type} onChange={event => setDraft({...draft, assessment_type: event.target.value})}>{types.map(item => <option key={item}>{item}</option>)}</select></label>
    <label>Sınav adı<input maxLength={160} value={draft.assessment_name} onChange={event => setDraft({...draft, assessment_name: event.target.value})}/></label>
    <label>Alınan puan<input inputMode="decimal" value={draft.score} onChange={event => setDraft({...draft, score: event.target.value})}/></label>
    <label>Puan ölçeği<input inputMode="decimal" value={draft.scale} onChange={event => setDraft({...draft, scale: event.target.value})}/></label>
  </div><div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>Vazgeç</button><button className="button primary">{saving ? 'Kaydediliyor…' : 'Değişikliği kaydet'}</button></div></fieldset>{error && <p className="error-text" role="alert">{error}</p>}</form></Modal>;
}
