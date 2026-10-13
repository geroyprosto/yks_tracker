'use client';
import {useState} from 'react';
import {BookOpen,ChevronDown} from 'lucide-react';
import {medicineMasteryLabels,type MedicineTopic,type MedicineUnit} from '@/lib/medicine';
import {medicineCatalog} from './catalog';
import {useMedicine} from './provider';
import {MedicineKegPanel} from './keg';
import {MedicineNotice,MedicineSetup,MedicineYearSelector} from './setup';
import {Modal} from '../modal';
import {Empty} from '../primitives';
import styles from './workspace.module.css';

export function MedicineTopics(){
 const {state,save,busy,loading}=useMedicine();const profile=state.profile;
 const [query,setQuery]=useState(''),[selectedUnit,setSelectedUnit]=useState('all'),[level,setLevel]=useState('all'),[view,setView]=useState('topics');
 const [editing,setEditing]=useState<{topic:MedicineTopic;unit:MedicineUnit}|null>(null);
 if(!profile?.enabled)return <div className={styles.page}><MedicineNotice/><MedicineSetup key={profile?.revision??0}/></div>;
 const allUnits=medicineCatalog.units.filter(unit=>unit.year===profile.active_year);
 const units=allUnits.filter(unit=>view==='keg'?unit.kind==='keg':unit.kind!=='keg');
 const progress=new Map(state.progress.map(item=>[item.topic_id,item]));
 const allTopics=units.flatMap(unit=>unit.topics),completed=allTopics.filter(topic=>progress.get(topic.id)?.mastery===4).length;
 const matches=(topic:MedicineTopic)=>{
  const row=progress.get(topic.id),mastery=row?.mastery??0;
  return (level==='all'||(level==='review'?Boolean(row?.review_requested):mastery===Number(level)))&&`${topic.name} ${topic.subject}`.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR'));
 };
 const filtered=units.filter(unit=>selectedUnit==='all'||selectedUnit===unit.id).map(unit=>({...unit,visible:unit.topics.filter(matches)})).filter(unit=>unit.visible.length);
 return <div className={styles.page}>
  <MedicineNotice/>
  <div className={styles.toolbar}><MedicineYearSelector/><span className="pill">{completed} / {allTopics.length} konuya hâkimim</span></div>
  {profile.active_year<4&&<div className="settings-tabs"><button aria-pressed={view==='topics'} className={view==='topics'?'active':''} onClick={()=>{setView('topics');setSelectedUnit('all');}}>Kurul konuları</button><button aria-pressed={view==='keg'} className={view==='keg'?'active':''} onClick={()=>{setView('keg');setSelectedUnit('all');}}>KEG takibi</button></div>}
  {view==='keg'&&profile.active_year<4&&<MedicineKegPanel key={`${profile.academic_year}-${profile.active_year}`}/>}
  <div className={styles.toolbar}>
   <input aria-label="Tıp konusu ara" placeholder="Konu veya ders ara…" value={query} onChange={event=>setQuery(event.target.value)}/>
   <select aria-label="Kurul veya staj filtresi" value={selectedUnit} onChange={event=>setSelectedUnit(event.target.value)}><option value="all">{profile.active_year===4?'Tüm stajlar':'Tüm kurullar'}</option>{units.map(unit=><option key={unit.id} value={unit.id}>{unit.name}</option>)}</select>
   <select aria-label="Tıp öğrenme düzeyi filtresi" value={level} onChange={event=>setLevel(event.target.value)}><option value="all">Tüm düzeyler</option>{medicineMasteryLabels.map((label,index)=><option key={label} value={index}>{label}</option>)}<option value="review">Tekrar gerekenler</option></select>
  </div>
  {loading&&<p className="soft-copy">Kaydedilen dönem değişikliği yükleniyor…</p>}
  {!filtered.length&&<Empty icon={<BookOpen size={28}/>} title="Eşleşen konu yok" text="Aramayı veya filtreleri değiştirerek konularına ulaşabilirsin."/>}
  {filtered.map((unit,index)=>{
   const subjects=[...new Set(unit.visible.map(topic=>topic.subject))];
   return <details key={`${profile.active_year}-${unit.id}-${query}-${level}`} className={styles.unit} open={index===0||query.length>0||level!=='all'}>
    <summary><div><h2>{unit.kind==='kurul'?`Kurul ${unit.id.split('k').at(-1)} · `:unit.kind==='staj'?'Staj · ':''}{unit.name}</h2><small>{unit.visible.length} konu · {unit.topics.filter(topic=>progress.get(topic.id)?.mastery===4).length} tamamlandı</small></div><ChevronDown size={18}/></summary>
    <div className={styles.body}>{subjects.map(subject=><div key={subject}><h3 className={styles.subject}>{subject}</h3>{unit.visible.filter(topic=>topic.subject===subject).map(topic=>{
     const row=progress.get(topic.id);
     return <div className={styles.topic} key={topic.id}>
      <button type="button" onClick={()=>setEditing({topic,unit})}>{topic.name}<small>{topic.kind==='practice'?'Pratik / laboratuvar':'Teorik'}{row?.review_requested?' · Tekrar gerekiyor':''}{row?.notes?' · Not eklendi':''}</small></button>
      <select aria-label={`${topic.name} öğrenme düzeyi`} disabled={busy||loading} value={row?.mastery??0} onChange={event=>void save('topic.save',{academic_year:profile.academic_year,topic_id:topic.id,mastery:Number(event.target.value),review_requested:row?.review_requested??false,notes:row?.notes??'',expected_revision:row?.revision??0})}>{medicineMasteryLabels.map((label,value)=><option key={label} value={value}>{label}</option>)}</select>
     </div>;
    })}</div>)}<a className="text-button" href={unit.sourceUrl} target="_blank" rel="noreferrer">Resmî ders programını aç</a></div>
   </details>;
  })}
  <p className={styles.sourceNote}>Kırklareli Üniversitesi Tıp Fakültesi · 2026–2027 programı. Ders saatlerinde tekrarlanan aynı başlıklar birleştirildi; teorik ve pratik içerikler ayrı tutuldu.</p>
  {editing&&<MedicineTopicEditor key={editing.topic.id} {...editing} onClose={()=>setEditing(null)}/>}
 </div>;
}
function MedicineTopicEditor({topic,unit,onClose}:{topic:MedicineTopic;unit:MedicineUnit;onClose:()=>void}){
 const {state,save,busy,error}=useMedicine(),row=state.progress.find(item=>item.topic_id===topic.id);
 const [notes,setNotes]=useState(row?.notes??''),[mastery,setMastery]=useState(row?.mastery??0),[review,setReview]=useState(row?.review_requested??false);
 return <Modal title={topic.name} onClose={onClose}><form className="form-grid" onSubmit={async event=>{event.preventDefault();if(await save('topic.save',{academic_year:state.profile!.academic_year,topic_id:topic.id,mastery,review_requested:review,notes,expected_revision:row?.revision??0}))onClose();}}>
  {error&&<p role="alert" className="notice error span-2">{error}</p>}
  <label className="span-2">Öğrenme düzeyi<select value={mastery} onChange={event=>setMastery(Number(event.target.value))}>{medicineMasteryLabels.map((label,index)=><option key={label} value={index}>{label}</option>)}</select></label>
  <label className={`span-2 ${styles.check}`}><input type="checkbox" checked={review} onChange={event=>setReview(event.target.checked)}/>Tekrar gerekiyor</label>
  <label className="span-2">Konu notum<textarea value={notes} maxLength={10000} rows={5} onChange={event=>setNotes(event.target.value)}/></label>
  <a className="text-button span-2" href={`${unit.sourceUrl}#page=${topic.pages[0]}`} target="_blank" rel="noreferrer">Kaynak program · sayfa {topic.pages.join(', ')}</a>
  <div className="form-actions span-2"><button className="button primary" disabled={busy}>Konu durumunu kaydet</button></div>
 </form></Modal>;
}
