'use client';

import {useState} from 'react';
import {BarChart3, BookOpen, CalendarDays} from 'lucide-react';
import type {AppState} from '@/lib/domain/types';
import type {CommandFn} from '@/lib/ui';
import {educationCourseLabel,filterStudyState,unassignedCourse} from '@/lib/study-course-filter';
import type {PageId} from './dashboard';
import {PracticeAnalysis} from './practice-analysis';
import {StudyStatistics} from './study-statistics';
import styles from './statistics-workspace.module.css';

export type StatisticsView = 'study' | 'practice';

const views = [
  {id: 'study', label: 'Çalışma analizi', icon: BarChart3},
  {id: 'practice', label: 'Soru ve test', icon: BookOpen},
] as const;

type Props = {
  state: AppState;
  practiceState: AppState;
  preview: boolean;
  command: CommandFn;
  busy: boolean;
  go: (page: PageId, date?: string) => void;
  view: StatisticsView;
  initialDate?: string | null;
  onViewChange: (view: StatisticsView) => void;
};

export function StatisticsWorkspace({state, practiceState, preview, command, busy, go, view, initialDate, onViewChange}: Props) {
  const [termId,setTermId]=useState(''),[selectedCourse,setSelectedCourse]=useState('');
  const education=state.education;
  const modern=Boolean(education?.profile);
  const courseOptions=(education?.courses??[]).filter(course=>!termId||course.term_id===termId);
  const courseId=selectedCourse===unassignedCourse&&!termId||courseOptions.some(course=>course.id===selectedCourse)?selectedCourse:'';
  const scoped=modern&&Boolean(termId||courseId);
  const filtered=filterStudyState(preview?practiceState:state,{termId,courseId});
  return <div className={styles.workspace} data-statistics-view={view}>
    <div className={styles.views} role="group" aria-label="İstatistik görünümü">
      {views.filter(item=>item.id!=='practice'||(state.education?.profile?.yks_goal??true)).map(({id, label, icon: Icon}) => <button key={id} type="button" aria-pressed={view === id} onClick={() => onViewChange(id)}>
        <Icon size={16} aria-hidden="true"/>
        <span>{label}</span>
      </button>)}
    </div>
    {modern&&view!=='practice'&&<div className={styles.courseFilters} role="group" aria-label="Çalışma kayıtlarının ders ve dönem filtreleri">
      <label><span className={styles.filterIcon}><CalendarDays size={22} aria-hidden="true"/></span><span className={styles.filterField}><span>Çalışma dönemi</span><select value={termId} onChange={event=>{setTermId(event.target.value);setSelectedCourse('');}}><option value="">Tüm dönemler ve YKS</option>{education!.terms.map(term=><option key={term.id} value={term.id}>{term.academic_year} / {term.name}{term.archived?' · Arşiv':''}</option>)}</select></span></label>
      <label><span className={styles.filterIcon}><BookOpen size={22} aria-hidden="true"/></span><span className={styles.filterField}><span>Çalışma dersi</span><select value={courseId} onChange={event=>setSelectedCourse(event.target.value)}><option value="">Tüm dersler</option>{!termId&&<option value={unassignedCourse}>Ders kimliği olmayan eski / serbest kayıtlar</option>}{courseOptions.map(course=><option key={course.id} value={course.id}>{educationCourseLabel(course,education!)}{course.archived?' · Arşiv':''}</option>)}</select></span></label>
      <p>{scoped?'Süre ve görev özetleri yalnız bu seçimi kapsar. Ders kimliği olmayan eski kayıtlar isimden tahmin edilmez.':'Bütün kayıtlar dahil. Aynı adlı okul, YKS ve farklı dönem dersleri kimlikleriyle ayrı tutulur.'}</p>
    </div>}
    {view === 'study' && <StudyStatistics key={initialDate ?? 'default'} initialDate={initialDate} state={filtered} command={command} busy={busy} go={go} scoped={scoped}/>}
    {view === 'practice' && <PracticeAnalysis state={practiceState} command={command} busy={busy} preview={preview}/>}
  </div>;
}

