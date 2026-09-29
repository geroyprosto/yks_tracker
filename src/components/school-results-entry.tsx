'use client';

import {useId, useRef, useState} from 'react';
import {ChevronDown} from 'lucide-react';
import type {EducationCourse} from '@/lib/education';
import {assessmentTypes, matchSchoolCourses, parseSchoolTable, suggestSchoolColumns, validateResultDrafts, type ParsedSchoolTable, type ResultDraft, type SchoolColumnMap, type TableDelimiter} from '@/lib/school-results';
import {localDate} from '@/lib/ui';
import {Card, Empty} from './primitives';
import styles from './school-results.module.css';

export type EducationResultCommand = (type: string, payload: Record<string, unknown>, requestId?: string) => Promise<boolean>;
type Defaults = {exam_date: string; assessment_type: string; assessment_name: string; scale: string};

export function SchoolResultsEntry({courses, command, busy, canCommit, termLabel}: {courses: EducationCourse[]; command: EducationResultCommand; busy: boolean; canCommit: boolean; termLabel: string}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const [method, setMethod] = useState<'quick' | 'paste'>('quick');
  const [defaults, setDefaults] = useState<Defaults>({exam_date: localDate(), assessment_type: 'Vize', assessment_name: '', scale: '100'});
  const [marks, setMarks] = useState<Record<string, {score: string; date?: string}>>({});
  const [issues, setIssues] = useState<Record<number, string>>({});
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false), [importVersion, setImportVersion] = useState(0);
  const request = useRef<{key: string; id: string} | null>(null), sending = useRef(false);
  const scoreInputs = useRef<Array<HTMLInputElement | null>>([]);
  const locked = busy || saving || !canCommit;
  async function save(drafts: ResultDraft[]) {
    if (sending.current || locked) return;
    setError(''); setSuccess('');
    const validated = validateResultDrafts(drafts, new Set(courses.map(course => course.id)));
    setIssues(Object.fromEntries(validated.issues.map(issue => [issue.row, issue.message])));
    if (validated.issues.length) {setError('İşaretli satırları düzelt. Henüz hiçbir sonuç kaydedilmedi.'); return;}
    if (!validated.rows.length) {setError('Kaydetmek için en az bir puan yaz. Boş satırlar atlanır.'); return;}
    if (validated.rows.length > 100) {setError('Tek işlemde en fazla 100 sonuç kaydedebilirsin.'); return;}
    const key = JSON.stringify(validated.rows);
    if (request.current?.key !== key) request.current = {key, id: crypto.randomUUID()};
    sending.current = true; setSaving(true);
    try {
      if (await command('results.batch', {rows: validated.rows}, request.current.id)) {
        setMarks({}); setImportVersion(value => value + 1); request.current = null;
        setSuccess(`${validated.rows.length} sınav sonucu birlikte kaydedildi.`);
      } else setError('Kayıt doğrulanamadı. Tablo korunuyor; tekrar kaydettiğinde aynı işlem güvenle sorgulanır.');
    } catch {setError('Bağlantı kurulamadı. Tablo korunuyor; tekrar kaydettiğinde aynı işlem güvenle sorgulanır.');}
    finally {sending.current = false; setSaving(false);}
  }
  return <Card title="Hızlı sonuç girişi" eyebrow={termLabel} className={styles.entry} action={<button type="button" className={`button secondary ${styles.entryToggle}`} aria-label={`Hızlı sonuç girişini ${expanded ? 'kapat' : 'aç'}`} aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(value => !value)}>{expanded ? 'Kapat' : 'Aç'}<ChevronDown size={16} aria-hidden="true"/></button>}>
    <div id={panelId} className={styles.entryBody} hidden={!expanded}>
    <p className={styles.note}>Derslerin hazır. Ortak sınav türünü ve ölçeği seç, puanlarını yaz. Boş satırlar kaydedilmez; 0 geçerli bir puandır.</p>
    {!courses.length ? <Empty title="Bu dönemde okul dersi yok" text="Ayarlar → Dönemler ve Dersler bölümünden ders eklediğinde satırların burada hazır olacak."/> : <>
      <div className="segmented" role="group" aria-label="Sonuç giriş yöntemi"><button type="button" aria-pressed={method === 'quick'} onClick={() => {setMethod('quick'); setIssues({}); setError('');}}>Hızlı tablo</button><button type="button" aria-pressed={method === 'paste'} onClick={() => {setMethod('paste'); setIssues({}); setError('');}}>Yapıştır / CSV</button></div>
      <fieldset disabled={locked} className={styles.fieldset}>
        <div className={styles.fields}>
          <label>Ortak sınav türü<select value={defaults.assessment_type} onChange={event => setDefaults({...defaults, assessment_type: event.target.value})}>{assessmentTypes.map(type => <option key={type}>{type}</option>)}</select></label>
          <label>Sınav adı (isteğe bağlı)<input maxLength={160} value={defaults.assessment_name} placeholder="Örn. 1. vize" onChange={event => setDefaults({...defaults, assessment_name: event.target.value})}/></label>
          <label>Ortak ölçek<input inputMode="decimal" value={defaults.scale} onChange={event => setDefaults({...defaults, scale: event.target.value})}/></label>
          <label>Varsayılan tarih<input type="date" value={defaults.exam_date} onChange={event => setDefaults({...defaults, exam_date: event.target.value})}/></label>
        </div>
        {method === 'quick' ? <>
          <div className={styles.tableScroll}><table className={styles.table}><caption className="sr-only">Aktif dönemin ders puanları</caption><thead><tr><th scope="col">Ders</th><th scope="col">Puan</th><th scope="col">Sınav tarihi</th></tr></thead><tbody>{courses.map((course, index) => <tr key={course.id}><th scope="row">{course.name}</th><td><input ref={node => {scoreInputs.current[index] = node;}} aria-label={`${course.name} puanı`} aria-invalid={Boolean(issues[index])} aria-describedby={issues[index] ? `result-error-${course.id}` : undefined} inputMode="decimal" placeholder="Boş bırakılabilir" value={marks[course.id]?.score ?? ''} onChange={event => setMarks({...marks, [course.id]: {...marks[course.id], score: event.target.value}})} onKeyDown={event => {if (event.key === 'Enter') {event.preventDefault(); scoreInputs.current[(index + (event.shiftKey ? -1 : 1) + courses.length) % courses.length]?.focus();}}}/>{issues[index] && <p id={`result-error-${course.id}`} className="error-text">{issues[index]}</p>}</td><td><input type="date" aria-label={`${course.name} sınav tarihi`} value={marks[course.id]?.date ?? defaults.exam_date} onChange={event => setMarks({...marks, [course.id]: {score: marks[course.id]?.score ?? '', date: event.target.value}})}/></td></tr>)}</tbody></table></div>
          <div className={styles.saveRow}><span>Tab ile alan, Enter ile puan satırı değiştir.</span><button type="button" className="button primary" onClick={() => save(courses.map(course => ({...defaults, course_id: course.id, score: marks[course.id]?.score ?? '', exam_date: marks[course.id]?.date ?? defaults.exam_date})))}>{saving ? 'Kaydediliyor…' : 'Tümünü kaydet'}</button></div>
        </> : <SchoolResultsImport key={importVersion} courses={courses} defaults={defaults} issues={issues} onSave={save}/>}
      </fieldset>
    </>}
    <p className={styles.note}>Bu girişler AI kullanmaz. Sonuçlar tek işlemle kaydedilir; bağlantı hatasında aynı tabloyu yeniden göndermek kopya oluşturmaz.</p>
    </div>
    {error && <p className="error-text" role="alert">{error}</p>}{success && <p className={styles.success} role="status">{success}</p>}
  </Card>;
}

function SchoolResultsImport({courses, defaults, issues, onSave}: {courses: EducationCourse[]; defaults: Defaults; issues: Record<number, string>; onSave: (rows: ResultDraft[]) => Promise<void>}) {
  const [text, setText] = useState(''), [delimiter, setDelimiter] = useState('auto');
  const [table, setTable] = useState<ParsedSchoolTable | null>(null), [error, setError] = useState('');
  const [header, setHeader] = useState(false), [columns, setColumns] = useState<SchoolColumnMap>({course: 0, score: 1, scale: -1, date: -1, type: -1, name: -1});
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const rows = table?.rows.slice(header ? 1 : 0) ?? [];
  const columnFields: [keyof SchoolColumnMap, string][] = [['course', 'Ders sütunu'], ['score', 'Puan sütunu'], ['scale', 'Ölçek sütunu'], ['date', 'Tarih sütunu'], ['type', 'Tür sütunu'], ['name', 'Sınav adı sütunu']];
  const draftRows = rows.map((row, index): ResultDraft => {
    const matches = matchSchoolCourses(row[columns.course] ?? '', courses);
    return {course_id: chosen[index] ?? (matches.length === 1 ? matches[0].id : ''), score: row[columns.score] ?? '', scale: columns.scale < 0 ? defaults.scale : row[columns.scale] ?? '', exam_date: columns.date < 0 ? defaults.exam_date : row[columns.date] ?? '', assessment_type: columns.type < 0 ? defaults.assessment_type : row[columns.type] ?? '', assessment_name: columns.name < 0 ? defaults.assessment_name : row[columns.name] ?? ''};
  });
  function preview() {
    setError(''); setChosen({});
    try {const parsed = parseSchoolTable(text, delimiter === 'auto' ? undefined : delimiter as TableDelimiter); const suggested = suggestSchoolColumns(parsed.rows); setTable(parsed); setHeader(suggested.header); setColumns(suggested.columns);}
    catch (cause) {setTable(null); setError(cause instanceof Error ? cause.message : 'Tablo okunamadı.');}
  }
  return <div className={styles.import}>
    <label>Ders–puan tablosu<textarea value={text} rows={5} placeholder={'Ders\tPuan\nMatematik\t87,5\nİktisat\t0'} onChange={event => {setText(event.target.value); setTable(null);}}/></label>
    <div className={styles.importTools}><label>CSV / TSV dosyası<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain" onChange={async event => {const file = event.target.files?.[0]; if (!file) return; if (file.size > 200000) {setError('Dosya en fazla 200 KB olabilir.'); return;} setText(await file.text()); setTable(null); setError('');}}/></label><label>Ayraç<select value={delimiter} onChange={event => {setDelimiter(event.target.value); setTable(null);}}><option value="auto">Otomatik</option><option value={'\t'}>Sekme (TSV)</option><option value=";">Noktalı virgül</option><option value=",">Virgül (CSV)</option></select></label><button type="button" className="button secondary" onClick={preview}>Önizle ve eşleştir</button></div>
    {error && <p className="error-text" role="alert">{error}</p>}
    {table && <>
      <label className={styles.checkbox}><input type="checkbox" checked={header} onChange={event => {setHeader(event.target.checked); setChosen({});}}/>İlk satır sütun başlıkları</label>
      <div className={styles.fields}>{columnFields.map(([key, label]) => <label key={key}>{label}<select value={columns[key]} onChange={event => {setColumns({...columns, [key]: Number(event.target.value)}); setChosen({});}}>{key !== 'course' && key !== 'score' && <option value={-1}>Ortak değeri kullan</option>}{table.rows[0].map((cell, index) => <option key={index} value={index}>{index + 1}. sütun{header ? ` · ${cell}` : ''}</option>)}</select></label>)}</div>
      {columns.course === columns.score && <p className="error-text" role="alert">Ders ve puan için farklı sütunlar seç.</p>}
      <div className={styles.tableScroll}><table className={styles.table}><caption>Kaydetmeden önce ders eşleşmelerini kontrol et</caption><thead><tr><th scope="col">Kaynak ders</th><th scope="col">Kayıtlı ders</th><th scope="col">Sonuç / tarih</th></tr></thead><tbody>{draftRows.map((draft, index) => <tr key={index}><th scope="row">{rows[index][columns.course]}</th><td><select aria-label={`${index + 1}. satır dersi`} value={draft.course_id} onChange={event => setChosen({...chosen, [index]: event.target.value})}><option value="">Dersi sen seç</option>{courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}</select>{!draft.course_id && draft.score.trim() && <span className="error-text">Eşleşme belirsiz veya ders bulunamadı.</span>}{issues[index] && <p className="error-text">{issues[index]}</p>}</td><td>{draft.score.trim() ? <><strong>{draft.score} / {draft.scale}</strong><small>{draft.exam_date} · {draft.assessment_type}{draft.assessment_name ? ` · ${draft.assessment_name}` : ''}</small></> : <span>Boş — atlanacak</span>}</td></tr>)}</tbody></table></div>
      <div className={styles.saveRow}><span>{draftRows.filter(row => row.score.trim()).length} sonuç önizleniyor</span><button type="button" className="button primary" disabled={columns.course === columns.score} onClick={() => onSave(draftRows)}>Önizlemeyi kaydet</button></div>
    </>}
    <p className={styles.note}>Veriler bu cihazda ayrıştırılır. Virgül ayraçlı CSV’de 87,5 gibi puanları tırnak içine al. Aynı tarih ve puandaki ayrı sınavlar ayrı kayıt olarak korunur.</p>
  </div>;
}
