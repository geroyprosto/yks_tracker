'use client';

import {useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,Check,GraduationCap,LayoutDashboard,School,X} from 'lucide-react';
import type {EducationState,SetupInput} from '@/lib/education';
import {normalizeCourseName,setupSchema} from '@/lib/education';
import {academicYear,levelLabels,moduleLabels,parseCourseNames,setupFromEducation,type EducationCommand} from '@/lib/education-ui';
import styles from './education-setup.module.css';

type Props={education:EducationState;command:EducationCommand;busy:boolean;editing?:boolean;activeTimer?:boolean;onDone:()=>void;onCancel?:()=>void};
const stepLabels=['Öğrenci profilim','Dönemim','Derslerim','Çalışma alanım'];

export function EducationSetup({education,command,busy,editing=false,activeTimer=false,onDone,onCancel}:Props){
 const [draft,setDraft]=useState(()=>setupFromEducation(education,!editing));
 const [step,setStep]=useState(editing?0:education.draft?.step??0);
 const [courseText,setCourseText]=useState('');
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const heading=useRef<HTMLHeadingElement>(null);
 const profile=draft.profile;
 const visibleCourses=draft.courses.filter(course=>course.context==='school'||profile.yks_goal);
 const parsed=parseCourseNames(courseText);
 const patchProfile=(patch:Partial<SetupInput['profile']>)=>setDraft({...draft,profile:{...profile,...patch}});
 const move=(next:number)=>{setStep(next);setError('');setNotice('');requestAnimationFrame(()=>heading.current?.focus());};
 const saveDraft=async()=>{setError('');if(await command('draft.save',{expected_revision:education.draft?.revision??0,step,data:draft}))setNotice('Taslağın kaydedildi. Buradan devam edebilirsin.');};
 const next=async()=>{
   setError('');
   if(step===0&&profile.education_level==='high_school'&&!profile.grade){setError('Lise sınıfını seç.');return;}
   if(step===1&&(!draft.term?.academic_year.trim()||!draft.term.name.trim())){setError('Eğitim yılını ve dönem adını yaz.');return;}
   if(!editing && !await command('draft.save',{expected_revision:education.draft?.revision??0,step:step+1,data:draft}))return;
   move(step+1);
 };
 const save=async()=>{
   const checked=setupSchema.safeParse(draft);
   if(!checked.success){setError(checked.error.issues[0]?.message??'Seçimlerini kontrol et.');return;}
   if(!education.can_commit){await saveDraft();return;}
   if(await command('profile.save',{expected_revision:education.profile?.revision??0,...checked.data}))onDone();
 };
 const addPreview=()=>{
   if(!parsed.names.length)return;
   const existing=new Set(draft.courses.filter(course=>course.context==='school').map(course=>normalizeCourseName(course.name)));
   const repeated=parsed.names.filter(name=>existing.has(normalizeCourseName(name)));
   if(repeated.length||parsed.duplicates.length){setError('Yinelenen dersleri kaldır: '+[...repeated,...parsed.duplicates].join(', '));return;}
   setDraft({...draft,courses:[...draft.courses,...parsed.names.map(name=>({name,context:'school' as const,exam:null}))]});setCourseText('');setError('');
 };
 return <section className={styles.workspace} aria-label="Öğrenci kişiselleştirme">
   <header className={styles.intro}><div><p className="eyebrow">SANA AİT BİR ÇALIŞMA ALANI</p><h2>{editing?'Çalışma alanını yeniden düzenle.':'Derslerin bir yerde, yolun sana göre.'}</h2><p>Derslerini bir kere tanımla; çalışmanı planla, süreni kaydet ve sonuçlarının değişimini gör.</p></div>{onCancel&&<button type="button" className="button secondary" onClick={onCancel}>İptal</button>}</header>
   {activeTimer&&<p className="notice">Aktif çalışma oturumunu bitirdikten sonra profilini veya dönemini değiştirebilirsin.</p>}
   {!education.can_commit&&<p className="notice">Hesabın onay bekliyor. Kendi profil taslağını hazırlayabilirsin; çalışma alanın onaydan sonra açılır.</p>}
   <div className={styles.layout}><div className={styles.panel}>
     <ol className={styles.steps} aria-label="Kurulum adımları">{stepLabels.map((label,index)=><li key={label} aria-current={step===index?'step':undefined} data-done={step>index}>{index+1}. {label}</li>)}</ol>
     <div className={styles.stepHead}><h3 ref={heading} tabIndex={-1}>{['Nasıl bir öğrencilik yolundasın?','Bu dönemine bir ad ver.','Hangi derslerle başlayalım?','Son bir bakış.'][step]}</h3><p>{['Eğitim durumun ile YKS hedefini ayrı ayrı seçebilirsin.','Eski dönemlerin ve sonuçların her zaman korunur.','Hepsini şimdi eklemek zorunda değilsin.','Görmek istediğin araçları seç. Bunları daha sonra değiştirebilirsin.'][step]}</p></div>
     {step===0&&<div className={styles.fields}>
       <fieldset className={styles.choices}><legend>Eğitim durumun</legend>{([
         ['high_school','Lisede okuyorum','Okul derslerini ve istersen YKS hazırlığını birlikte takip et.',School],
         ['university','Üniversitede okuyorum','Derslerin, vize ve finallerin için kendi alanını oluştur.',GraduationCap],
         ['graduate','Mezunum, YKS’ye hazırlanıyorum','TYT ve AYT konularını, denemelerini ve çalışma düzenini koru.',BookOpen],
       ] as const).map(([value,title,description,Icon])=><label className={styles.choice} key={value}><input type="radio" name="education-level" value={value} checked={profile.education_level===value} onChange={()=>patchProfile({education_level:value,grade:value==='high_school'?profile.grade:null,department:value==='university'?profile.department:'',university_year:value==='university'?profile.university_year:'',...(value==='graduate'?{yks_goal:true}:{})})}/><Icon size={23}/><span><strong>{title}</strong><small>{description}</small></span>{profile.education_level===value&&<Check size={18} className={styles.check}/>}</label>)}</fieldset>
       {profile.education_level==='high_school'&&<label>Sınıfın<select value={profile.grade??''} onChange={e=>patchProfile({grade:e.target.value?Number(e.target.value):null})}><option value="">Sınıf seç</option>{[9,10,11,12].map(grade=><option key={grade} value={grade}>{grade}. sınıf</option>)}</select></label>}
       {profile.education_level==='university'&&<div className={styles.twoFields}><label>Bölüm (isteğe bağlı)<input value={profile.department} onChange={e=>patchProfile({department:e.target.value})} maxLength={120} placeholder="Örn. Uluslararası Ticaret"/></label><label>Sınıf (isteğe bağlı)<input value={profile.university_year} onChange={e=>patchProfile({university_year:e.target.value})} maxLength={40} placeholder="Örn. 2. sınıf"/></label></div>}
       <label className={styles.choice}><input type="checkbox" checked={profile.yks_goal} disabled={profile.education_level==='graduate'} onChange={e=>patchProfile({yks_goal:e.target.checked})}/><span><strong>YKS’ye hazırlanıyorum</strong><small>Konularım, TYT/AYT denemeleri ve YKS geri sayımı görünür olur.</small></span>{profile.yks_goal&&<Check size={18} className={styles.check}/>}</label>
       {profile.yks_goal&&<><label>YKS alan tercihin<select value={profile.yks_track} onChange={e=>patchProfile({yks_track:e.target.value as SetupInput['profile']['yks_track']})}>{[['undecided','Kararsızım'],['sayisal','Sayısal'],['esit_agirlik','Eşit ağırlık'],['sozel','Sözel'],['dil','Dil']].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><p className={styles.note}>Alan tercihin mevcut denemelerini değiştirmez. Hazır deneme şablonları TYT, AYT Sayısal ve branş ile sınırlıdır.</p></>}
     </div>}
     {step===1&&<div className={styles.fields}>
       {education.terms.length>0&&<label>Dönem<select value={draft.term?.id??'new'} onChange={e=>{const term=education.terms.find(item=>item.id===e.target.value);setDraft({...draft,term:term?{id:term.id,name:term.name,academic_year:term.academic_year,starts_on:term.starts_on,ends_on:term.ends_on}:{name:profile.education_level==='graduate'?'YKS hazırlığı':'Güz',academic_year:academicYear()},courses:[...draft.courses.filter(course=>course.context==='yks'),...(term?education.courses.filter(course=>course.context==='school'&&course.term_id===term.id&&!course.archived).map(course=>({name:course.name,context:course.context,exam:course.exam})):[])]});}}><option value="new">Yeni dönem oluştur</option>{education.terms.map(term=><option key={term.id} value={term.id}>{term.academic_year} / {term.name}{term.archived?' · Arşiv':''}</option>)}</select></label>}
       <label>{profile.education_level==='graduate'?'Hazırlık yılı':'Eğitim yılı'}<input value={draft.term?.academic_year??''} maxLength={40} placeholder={academicYear()} onChange={e=>setDraft({...draft,term:{...draft.term!,academic_year:e.target.value}})}/></label>
       <label>Dönem adı<input list="term-suggestions" value={draft.term?.name??''} maxLength={80} onChange={e=>setDraft({...draft,term:{...draft.term!,name:e.target.value}})} placeholder={profile.education_level==='graduate'?'YKS hazırlığı':'Güz'}/><datalist id="term-suggestions">{['Güz','Bahar','Yaz','Yıllık','YKS hazırlığı'].map(value=><option key={value} value={value}/>)}</datalist></label>
       <div className={styles.twoFields}><label>Başlangıç (isteğe bağlı)<input type="date" value={draft.term?.starts_on??''} onChange={e=>setDraft({...draft,term:{...draft.term!,starts_on:e.target.value||null}})}/></label><label>Bitiş (isteğe bağlı)<input type="date" value={draft.term?.ends_on??''} onChange={e=>setDraft({...draft,term:{...draft.term!,ends_on:e.target.value||null}})}/></label></div>
       <p className={styles.note}>Yeni bir döneme geçince önceki dönem arşivlenir. Önceki sonuçları filtrelerden görebilirsin; çalışma sürelerin değişmez.</p>
     </div>}
     {step===2&&<div className={styles.fields}>
       {profile.education_level!=='graduate'&&<><label>Derslerini alt alta yaz<textarea value={courseText} onChange={e=>setCourseText(e.target.value)} maxLength={10000} rows={4} placeholder={'Matematik\nBilişim\nYabancı Dil\nİktisat'}/><small>Noktalı virgül veya virgülle de ayırabilirsin.</small></label>
       {parsed.names.length>0&&<div><p className="soft-copy">Önizleme · {parsed.names.length} ders</p><div className={styles.tags}>{parsed.names.map(name=><span className={styles.tag} key={name}>{name}</span>)}</div></div>}
       <div><button type="button" className="button secondary" disabled={!parsed.names.length} onClick={addPreview}>Bu dersleri ekle</button>{profile.education_level==='high_school'&&<button type="button" className="text-button" onClick={()=>setCourseText('Türk Dili ve Edebiyatı\nMatematik\nFizik\nKimya\nBiyoloji\nTarih\nCoğrafya\nYabancı Dil')}>Başlangıç önerilerini göster</button>}</div></>}
       <div><p className="soft-copy">Seçili derslerin · {visibleCourses.length}</p><div className={styles.tags}>{draft.courses.map((course,index)=>course.context==='yks'&&!profile.yks_goal?null:<span className={styles.tag} key={course.context+course.exam+course.name}>{course.context==='yks'?course.exam+' ':''}{course.name}<button type="button" aria-label={course.name+' seçimini kaldır'} onClick={()=>setDraft({...draft,courses:draft.courses.filter((_,i)=>i!==index)})}><X size={14}/></button></span>)}</div>{!visibleCourses.length&&<p className={styles.note}>Dersleri daha sonra da ekleyebilirsin.</p>}</div>
       {profile.yks_goal&&<YksCourseChoices draft={draft} onChange={setDraft}/>}
       {editing&&<p className={styles.note}>Buradan kaldırılan mevcut dersler silinmez. Ders arşivleme ve ad değiştirme işlemleri Dönemler ve Dersler alanındadır.</p>}
     </div>}
     {step===3&&<div className={styles.fields}><fieldset className={styles.choices}><legend>Başlangıçta hangi araçları görmek istersin?</legend>{Object.entries(moduleLabels).map(([key,label])=><label className={styles.choice} key={key}><input type="checkbox" checked={profile.modules[key as keyof typeof moduleLabels]} onChange={e=>patchProfile({modules:{...profile.modules,[key]:e.target.checked}})}/><span><strong>{label}</strong><small>{key==='journal'?'İsteğe bağlı, kendine ait günlük alanın.':'Mevcut kayıtların görünürlüğü değişse de korunur.'}</small></span>{profile.modules[key as keyof typeof moduleLabels]&&<Check className={styles.check} size={18}/>}</label>)}</fieldset><p className={styles.note}>{profile.yks_goal?'Konularım ve YKS Denemeleri menülerine erişebilirsin.':'Konularım ve YKS geri sayımı gizlenecek. YKS hedefini açınca eski konu ilerlemelerin geri gelir.'}</p></div>}
     {error&&<p role="alert" className={styles.error}>{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}
     <div className={styles.actions}><button type="button" className="text-button" disabled={busy} onClick={()=>void saveDraft()}>Taslağı kaydet</button><div>{step>0&&<button type="button" className="button secondary" disabled={busy} onClick={()=>move(step-1)}><ArrowLeft size={16}/>Geri</button>}{step<3?<button type="button" className="button primary" disabled={busy} onClick={()=>void next()}>İleri<ArrowRight size={16}/></button>:<button type="button" className="button primary" disabled={busy||activeTimer} onClick={()=>void save()}>{education.can_commit?editing?'Değişiklikleri kaydet':'Çalışma alanımı oluştur':'Taslağımı kaydet'}<Check size={17}/></button>}</div></div>
   </div><aside className={styles.summary} aria-label="Çalışma Alanımın Özeti"><LayoutDashboard size={26}/><h3>Çalışma Alanımın Özeti</h3><dl><dt>Eğitim</dt><dd>{levelLabels[profile.education_level]}{profile.grade?' · '+profile.grade+'. sınıf':''}</dd>{profile.department&&<><dt>Bölüm</dt><dd>{profile.department}{profile.university_year?' · '+profile.university_year:''}</dd></>}<dt>Dönem</dt><dd>{draft.term?.academic_year} / {draft.term?.name||'Henüz seçilmedi'}</dd><dt>Dersler</dt><dd>{visibleCourses.length} ders</dd><dt>YKS hedefi</dt><dd>{profile.yks_goal?'Açık':'Kapalı'}</dd></dl><p>Bu seçimler öğrenci profilini kişiselleştirir. Hesap rolünü veya sınıf erişimini değiştirmez.</p></aside></div>
 </section>;
}

function YksCourseChoices({draft,onChange}:{draft:SetupInput;onChange:(draft:SetupInput)=>void}){
 const subjects={TYT:['Türkçe','Matematik','Fizik','Kimya','Biyoloji','Tarih','Coğrafya','Felsefe','Din Kültürü ve Ahlak Bilgisi'],AYT:['Matematik','Fizik','Kimya','Biyoloji']};
 return <details><summary className="text-button">YKS hazır derslerini seç</summary><p className="soft-copy">Konularım tablosu ve öğrenme geçmişin korunur. Aşağıdaki seçimler ortak ders listene eklenir.</p>{Object.entries(subjects).map(([exam,names])=><fieldset className={styles.choices} key={exam}><legend>{exam}</legend><div className={styles.tags}>{names.map(name=>{const selected=draft.courses.some(course=>course.context==='yks'&&course.exam===exam&&course.name===name);return <label className={styles.tag} key={name}><input type="checkbox" checked={selected} onChange={e=>onChange({...draft,courses:e.target.checked?[...draft.courses,{name,context:'yks',exam:exam as 'TYT'|'AYT'}]:draft.courses.filter(course=>!(course.context==='yks'&&course.exam===exam&&course.name===name))})}/>{name}</label>;})}</div></fieldset>)}</details>;
}
