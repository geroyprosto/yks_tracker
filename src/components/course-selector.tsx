'use client';

import {createContext, useContext, useEffect, useId, useRef, useState} from 'react';
import {Check, ChevronDown} from 'lucide-react';
import type {AppState} from '@/lib/domain/types';
import type {EducationCourse} from '@/lib/education';
import type {EducationCommand} from '@/lib/education-ui';
import styles from './course-selector.module.css';

export const EducationCommandContext = createContext<EducationCommand>(async () => false);

type CourseSelectorProps = {
  state: AppState;
  value: string;
  onChange: (id: string) => void;
  label?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  initialFocus?: boolean;
};

export function CourseSelector({state, value, onChange, label = 'Ders', disabled = false, allowEmpty = true, initialFocus = false}: CourseSelectorProps) {
  const command = useContext(EducationCommandContext);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [context, setContext] = useState<'school' | 'TYT' | 'AYT'>('school');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const attempts = useRef(new Map<string, {id: string; requestId: string}>());
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const badgeId = useId();
  const selectionId = useId();
  const panelId = useId();
  const education = state.education;
  const term = education?.profile?.active_term_id;
  const effectiveContext = education?.profile?.yks_goal ? context : 'school';
  const courses = (education?.courses ?? []).filter(course =>
    course.id === value || (!course.archived && (course.context === 'yks' ? education?.profile?.yks_goal : course.term_id === term))
  );
  const selected = courses.find(course => course.id === value);
  const groups: {key: string; label: string; items: EducationCourse[]}[] = [
    {key: 'TYT', label: 'TYT', items: courses.filter(course => course.context === 'yks' && course.exam === 'TYT')},
    {key: 'AYT', label: 'AYT', items: courses.filter(course => course.context === 'yks' && course.exam === 'AYT')},
    {key: 'school', label: 'Okul / Üniversite', items: courses.filter(course => course.context === 'school')},
  ].filter(group => group.items.length).map(group => ({...group, items: group.items.sort((left, right) => left.name.localeCompare(right.name, 'tr'))}));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const create = async () => {
    if (!name.trim()) return;
    if (effectiveContext === 'school' && !term) {
      setError('Önce Ayarlar → Dönemler ve Dersler alanında bir dönem oluştur.');
      return;
    }
    const key = JSON.stringify({name: name.trim(), context: effectiveContext, term});
    const attempt = attempts.current.get(key) ?? {id: crypto.randomUUID(), requestId: crypto.randomUUID()};
    attempts.current.set(key, attempt);
    setSaving(true);
    setError('');
    try {
      if (await command('course.create', {id: attempt.id, term_id: effectiveContext === 'school' ? term : null, name: name.trim(), context: effectiveContext === 'school' ? 'school' : 'yks', exam: effectiveContext === 'school' ? null : effectiveContext}, attempt.requestId)) {
        attempts.current.delete(key);
        onChange(attempt.id);
        setAdding(false);
        setName('');
      }
    } finally {
      setSaving(false);
    }
  };

  return <div className={styles.selector}>
    <span className={styles.label} id={labelId}>{label}</span>
    <div ref={pickerRef} className={styles.picker} onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);}} onKeyDown={event => {if (open && event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus();}}}>
      <button ref={triggerRef} type="button" className={styles.trigger} data-initial-focus={initialFocus || undefined} aria-labelledby={selected ? `${labelId} ${badgeId} ${selectionId}` : `${labelId} ${selectionId}`} aria-expanded={open} aria-controls={open ? panelId : undefined} disabled={disabled || saving} onClick={() => setOpen(current => !current)}>
        {selected ? <><span id={badgeId} className={styles.badge}>{selected.context === 'yks' ? selected.exam : 'Okul'}</span><span id={selectionId} className={styles.triggerText}>{selected.name}{selected.archived ? ' · Arşiv' : selected.context === 'school' && selected.term_id !== term ? ' · Önceki dönem' : ''}</span></> : <span id={selectionId} className={styles.triggerText}>Ders seç</span>}
        <ChevronDown className={styles.chevron} size={16} aria-hidden="true"/>
      </button>
      {open && <div id={panelId} className={styles.panel} aria-labelledby={labelId}>
        {allowEmpty && <button type="button" className={styles.emptyOption} aria-pressed={!value} disabled={disabled || saving} onClick={() => choose('')}>Ders seçmeden devam et{!value && <Check size={15} aria-hidden="true"/>}</button>}
        {groups.map(group => <section key={group.key} className={styles.group} aria-label={group.label}>
          <div className={styles.groupHeading}><strong>{group.label}</strong><span>{group.items.length} ders</span></div>
          <div className={styles.options}>
            {group.items.map(course => {
              const retired = course.archived || (course.context === 'school' && course.term_id !== term);
              return <button key={course.id} type="button" className={styles.option} aria-pressed={value === course.id} disabled={disabled || saving || retired} onClick={() => choose(course.id)}><span>{course.name}{retired && <small>{course.archived ? 'Arşiv' : 'Önceki dönem'}</small>}</span>{value === course.id && <Check size={15} aria-hidden="true"/>}</button>;
            })}
          </div>
        </section>)}
        {!groups.length && <p className={styles.noCourses}>Henüz ders eklenmemiş.</p>}
      </div>}
    </div>
    {adding ? <div className={styles.fields}><div className={styles.addInline}><input aria-label="Yeni ders adı" value={name} maxLength={120} placeholder="Ders adı" onChange={event => setName(event.target.value)} onKeyDown={event => {if (event.key === 'Enter') {event.preventDefault(); void create();}}}/>{education?.profile?.yks_goal && <select aria-label="Yeni ders bağlamı" value={context} onChange={event => setContext(event.target.value as typeof context)}><option value="school">Okul / Üniversite</option><option value="TYT">TYT</option><option value="AYT">AYT</option></select>}<button className="button secondary" type="button" disabled={saving || disabled || !name.trim()} onClick={() => void create()}>Dersi ekle</button><button className="text-button" type="button" onClick={() => {setAdding(false); setError('');}}>Vazgeç</button></div>{error && <p role="alert" className={styles.error}>{error}</p>}</div> : <button type="button" className="text-button" disabled={disabled} onClick={() => {setOpen(false); setAdding(true);}}>+ Yeni ders ekle</button>}
  </div>;
}
