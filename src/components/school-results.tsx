'use client';

import {useRef, useState} from 'react';
import {ChevronDown, PenLine} from 'lucide-react';
import type {CourseExamResult, EducationState} from '@/lib/education';
import {assessmentTypes, filterSchoolResults, validateResultDrafts, type ResultDraft} from '@/lib/school-results';
import {formatDay} from '@/lib/ui';
import {Card, Empty} from './primitives';
import {Modal} from './modal';
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
  const [openCourse, setOpenCourse] = useState<string | null>(null);
  const [editing, setEditing] = useState<CourseExamResult | null>(null);
  const courseOptions = education.courses.filter(course => course.context === 'school' && (!term || course.term_id === term));
  return <Card title="Ders sonuçları" eyebrow="SONUÇLAR VE ARŞİV" className={styles.analysis}>
    <label className={styles.periodFilter}>Sonuç dönemi<select value={term} onChange={event => {setTerm(event.target.value); setOpenCourse(null);}}><option value="">Tüm dönemler</option>{education.terms.map(item => <option key={item.id} value={item.id}>{item.academic_year} · {item.name}{item.archived ? ' · Arşiv' : ''}</option>)}</select></label>
    {!courseOptions.length ? <Empty title="Bu dönemde ders yok" text="Sonuçlarını görmek için önce bu döneme ders ekle."/> : <div className={styles.courseList}>
      {courseOptions.map(item => {
        const records = filterSchoolResults(education.results, {course: item.id, term, start: '', end: '', type: ''});
        const latest = records.at(-1);
        const courseTerm = education.terms.find(entry => entry.id === item.term_id);
        const expanded = openCourse === item.id;
        return <section key={item.id} className={styles.courseCard}>
          <button type="button" className={styles.courseToggle} aria-expanded={expanded} aria-controls={`course-results-${item.id}`} onClick={() => setOpenCourse(expanded ? null : item.id)}>
            <span className={styles.courseTitle}>{item.name}{!term && <small>{courseTerm ? `${courseTerm.academic_year} · ${courseTerm.name}` : 'Dönemsiz'}{item.archived ? ' · Arşiv' : ''}</small>}</span>
            <span className={styles.coursePreview}><span>{records.length} sonuç</span><strong>{latest ? `${tr(latest.score)} / ${tr(latest.scale)}` : 'Henüz sonuç yok'}</strong></span>
            <ChevronDown size={18} className={styles.courseChevron} aria-hidden="true"/>
          </button>
          <div id={`course-results-${item.id}`} role="region" aria-label={`${item.name}${!term && courseTerm ? ` ${courseTerm.academic_year} ${courseTerm.name}` : ''} sınav sonuçları`} className={styles.courseBody} hidden={!expanded}>
            {expanded && (records.length ? <ul className={styles.resultList}>{[...records].reverse().map(result => <li key={result.id} className={styles.resultRow}>
              <div className={styles.resultDetail}><time dateTime={result.exam_date}>{formatDay(result.exam_date, {day: 'numeric', month: 'short', year: 'numeric'})}</time><strong>{result.assessment_type}{result.assessment_name ? ` · ${result.assessment_name}` : ''}</strong></div>
              <strong className={styles.resultScore}>{tr(result.score)} / {tr(result.scale)}</strong>
              <button type="button" className="icon-button" aria-label={`${result.course_name} ${result.assessment_type} ${result.exam_date} sonucunu düzenle`} disabled={busy || !education.can_commit} onClick={() => setEditing(result)}><PenLine size={16}/></button>
            </li>)}</ul> : <p className={styles.emptyCourse}>Bu ders için henüz sonuç kaydedilmedi.</p>)}
          </div>
        </section>;
      })}
    </div>}
    {editing && <SchoolResultEditor result={editing} command={command} busy={busy} onClose={() => setEditing(null)}/>}
  </Card>;
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
