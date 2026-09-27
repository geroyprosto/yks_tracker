'use client';

import {useState} from 'react';
import {BookOpen,GraduationCap,LayoutDashboard} from 'lucide-react';
import type {AppState} from '@/lib/domain/types';
import type {EducationCommand} from '@/lib/education-ui';
import {levelLabels} from '@/lib/education-ui';
import {EducationSetup} from './education-setup';
import {CourseSelector} from './course-selector';
import {Card} from './primitives';
import styles from './education-setup.module.css';

export function EducationSettings({state,command,busy,onSaved}:{state:AppState;command:EducationCommand;busy:boolean;onSaved:()=>void}){
 const [editing,setEditing]=useState(false);
 const [editingCourse,setEditingCourse]=useState('');
 const [name,setName]=useState('');
 const [resume,setResume]=useState(false);
 const [notice,setNotice]=useState('');
 const education=state.education;
 const activeTimer=state.sessions.some(session=>session.status!=='finished');
 if(!education)return <Card title="Öğrenci Profilim"><p className="soft-copy">Öğrenci kişiselleştirmesi veritabanı kurulumu tamamlandıktan sonra burada açılacak.</p></Card>;
 if(editing)return <EducationSetup key={String(resume)} education={education} command={command} busy={busy} editing={!resume} activeTimer={activeTimer} onCancel={()=>{setEditing(false);setResume(false);}} onDone={()=>{setEditing(false);setResume(false);setNotice('Çalışma alanın güncellendi.');onSaved();}}/>;
 const profile=education.profile;
 const activeTerm=education.terms.find(term=>term.id===profile?.active_term_id);
 return <div className={styles.fields}>
   {notice&&<p role="status" className="notice">{notice}</p>}
   <Card title="Öğrenci Profilim" action={<GraduationCap size={23}/>}><p className="soft-copy">{profile?`${levelLabels[profile.education_level]}${profile.grade?' · '+profile.grade+'. sınıf':''}${profile.department?' · '+profile.department:''} · YKS hedefi ${profile.yks_goal?'açık':'kapalı'}`:'YKS çalışma alanını koruyarak okul veya üniversite derslerini ekleyebilirsin.'}</p><button className="button primary" onClick={()=>setEditing(true)}>Profilimi düzenle</button>{education.draft&&<button className="text-button" onClick={()=>{setResume(true);setEditing(true);}}>Kaydedilmiş taslaktan devam et</button>}</Card>
   <Card title="Dönemler ve Dersler" action={<BookOpen size={22}/>}>
     {activeTimer&&<p className="notice">Dönem değiştirmek veya ders arşivlemek için aktif sayacını bitir.</p>}
     <div className={styles.twoFields}><label>Aktif dönem<select value={profile?.active_term_id??''} disabled={busy||activeTimer} onChange={async e=>{if(e.target.value&&await command('term.activate',{id:e.target.value}))setNotice('Aktif dönem değiştirildi; geçmiş kayıtlar korundu.');}}><option value="">Dönem seç</option>{education.terms.map(term=><option key={term.id} value={term.id}>{term.academic_year} / {term.name}{term.archived?' · Arşiv':''}</option>)}</select></label><div><button className="button secondary" disabled={activeTimer} onClick={()=>setEditing(true)}>Dönem oluştur veya düzenle</button></div></div>
     <div className={styles.catalog}><p className="soft-copy">{activeTerm?activeTerm.academic_year+' / '+activeTerm.name:'Henüz dönem oluşturmadın.'} · Ders adları değişse de eski sonuçların ve sürelerin korunur.</p>
       {education.courses.filter(course=>course.context==='yks'||course.term_id===profile?.active_term_id).map(course=><div className={styles.catalogRow} key={course.id}>{editingCourse===course.id?<><input aria-label="Dersin yeni adı" value={name} maxLength={120} onChange={e=>setName(e.target.value)}/><button className="button secondary" disabled={busy||!name.trim()} onClick={async()=>{if(await command('course.update',{id:course.id,expected_revision:course.revision,name}))setEditingCourse('');}}>Kaydet</button><button className="text-button" onClick={()=>setEditingCourse('')}>İptal</button></>:<><div><strong>{course.name}</strong><small>{course.context==='yks'?course.exam:'Okul / Üniversite'}{course.archived?' · Arşiv':''}</small></div><button className="text-button" onClick={()=>{setEditingCourse(course.id);setName(course.name);}}>Adını değiştir</button><button className="text-button" disabled={busy||activeTimer} onClick={()=>void command('course.update',{id:course.id,expected_revision:course.revision,archived:!course.archived})}>{course.archived?'Arşivden çıkar':'Arşivle'}</button></>}</div>)}
       <CourseSelector state={state} value="" label="Ders kataloğun" disabled={busy} onChange={()=>setNotice('Ders kataloğuna eklendi.')}/>
     </div>
   </Card>
   <Card title="Çalışma Alanını Özelleştir" action={<LayoutDashboard size={22}/>}><p className="soft-copy">Görevler, sayaç, sınav sonuçları, istatistikler ve günlük görünürlüğünü seç. Gizlenen araçların verileri korunur.</p><button className="button secondary" onClick={()=>setEditing(true)}>Görünür araçları seç</button></Card>
 </div>;
}
