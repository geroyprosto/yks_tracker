'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,BookOpen,Check,ChevronDown,Search} from 'lucide-react';
import type {AppState,Topic} from '@/lib/domain/types';
import {masteryLabels,type CommandFn,duration} from '@/lib/ui';
import {Card,Empty,AddButton} from './primitives';
import {Modal} from './modal';
import styles from './topics.module.css';

const shortMasteryLabels=['Başlanmadı','Öğreniyorum','Anlatım bitti','Soru çözüyorum','Hâkimim'];
const isExcludedTytSubject=(subject:string)=>{
 const normalized=subject.trim().toLocaleLowerCase('tr');
 return normalized==='felsefe'||normalized==='tarih'||normalized==='din'||normalized.startsWith('din kültürü');
};

export function Topics({state,command,busy}:{state:AppState;command:CommandFn;busy:boolean}){
 const [query,setQuery]=useState('');
 const [exam,setExam]=useState('all');
 const [level,setLevel]=useState('all');
 const [selected,setSelected]=useState<Topic|null|false>(false);
 const [openMasteryId,setOpenMasteryId]=useState<string|null>(null);
 const [openGroups,setOpenGroups]=useState<Record<string,boolean>>({});
 const [subjectError,setSubjectError]=useState('');
 const openTrigger=useRef<HTMLButtonElement|null>(null);

 useEffect(()=>{
  if(!openMasteryId)return;
  const closeOnOutsideClick=(event:PointerEvent)=>{
   if(event.target instanceof Element&&!event.target.closest('[data-topic-mastery-control]'))setOpenMasteryId(null);
  };
  const closeOnEscape=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){
    setOpenMasteryId(null);
    openTrigger.current?.focus();
   }
  };
  document.addEventListener('pointerdown',closeOnOutsideClick);
  document.addEventListener('keydown',closeOnEscape);
  return ()=>{
   document.removeEventListener('pointerdown',closeOnOutsideClick);
   document.removeEventListener('keydown',closeOnEscape);
  };
 },[openMasteryId]);

 const visibleTopics=state.topics.filter(t=>t.exam!=='TYT'||!isExcludedTytSubject(t.subject));
 const topics=visibleTopics.filter(t=>(exam==='all'||t.exam===exam)&&(level==='all'||t.mastery===Number(level))&&[t.name,t.subject].join(' ').toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr')));
 const totalTopics=visibleTopics.length;
 const completedTopics=visibleTopics.filter(t=>t.mastery===4).length;
 const hasLegacyTopics=visibleTopics.some(t=>t.source.startsWith('Düzenlenebilir başlangıç listesi'));
 const completionPercent=totalTopics===0?0:completedTopics===totalTopics?100:Math.min(99,Math.round(completedTopics/totalTopics*100));
 const topicGroupsMap=new Map<string,{key:string;exam:Topic['exam'];subject:string;total:number;completed:number;topics:Topic[]}>();
 for(const topic of visibleTopics){
  const key=topic.exam+'|'+topic.subject;
  const group=topicGroupsMap.get(key)??{key,exam:topic.exam,subject:topic.subject,total:0,completed:0,topics:[]};
  group.total++;
  if(topic.mastery===4)group.completed++;
  topicGroupsMap.set(key,group);
 }
 for(const topic of topics)topicGroupsMap.get(topic.exam+'|'+topic.subject)?.topics.push(topic);
 const topicGroups=[...topicGroupsMap.values()].filter(group=>group.topics.length>0).sort((a,b)=>a.exam===b.exam?a.subject.localeCompare(b.subject,'tr'):a.exam==='TYT'?-1:1);
 const autoExpandGroups=query.trim().length>0||level!=='all'||exam!=='all';

 return <>
 <section className={styles.completionCard} aria-labelledby="topic-completion-title">
  <div className={styles.completionHeader}>
   <div className={styles.completionCopy}>
    <span className={styles.completionEyebrow}><Check size={13} aria-hidden="true"/> KONU İLERLEMEN</span>
    <h2 id="topic-completion-title">{totalTopics===0?'İlk konunla başla':completedTopics+' / '+totalTopics+' konu tamamlandı'}</h2>
    <p>“Konuya hâkimim” düzeyindeki başlıklar tamamlandı sayılır.</p>
   </div>
   <div className={styles.completionValue} aria-label={'Yüzde '+completionPercent+' tamamlandı'}><strong>%{completionPercent}</strong><span>tamamlandı</span></div>
  </div>
  <div className={styles.completionTrack} role="progressbar" aria-label="Tamamlanan konular" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completionPercent} aria-valuetext={completedTopics+' / '+totalTopics+' konu tamamlandı'}>
   <span className={styles.completionFill} style={{width:completionPercent+'%'}}/>
  </div>
  <div className={styles.completionFooter}><span>TYT + AYT toplamı · arama ve filtrelerden bağımsız</span><span>{totalTopics===0?'Henüz konu yok':totalTopics-completedTopics+' konu kaldı'}</span></div>
 </section>
 <div className="toolbar"><div className="toolbar-group"><div className="search-input"><Search size={17}/><input aria-label="Konu ara" placeholder="Ders veya konu ara…" value={query} onChange={e=>setQuery(e.target.value)}/></div><select aria-label="Sınav" value={exam} onChange={e=>setExam(e.target.value)}><option value="all">TYT + AYT</option><option>TYT</option><option>AYT</option></select><select aria-label="Öğrenme düzeyi filtresi" value={level} onChange={e=>setLevel(e.target.value)}><option value="all">Tüm düzeyler</option>{masteryLabels.map((s,i)=><option key={s} value={i}>{s}</option>)}</select></div><AddButton onClick={()=>{setSubjectError('');setSelected(null)}}>Konu ekle</AddButton></div>
 <div className="notice"><BookOpen size={18}/><span>{hasLegacyTopics?'Önceki plandan kalan başlıklar işaretlendi ve kayıtlı ilerlemen korundu. 2027 kapsamı kesinleştiğinde konu listeni gözden geçir.':'Konu başlıkları kaynak listelerden derlendi. 2027 kapsamı kesinleştiğinde konu listeni gözden geçir.'}</span></div>
 <Card className={topics.length===0?'ambient-card':''} title="Konu haritan" action={<span className="pill">{topics.length} başlık</span>}>
  {topics.length===0?<Empty icon={<BookOpen size={28}/>} title={visibleTopics.length===0?'Konu haritanı oluştur':'Eşleşen konu yok'} text={visibleTopics.length===0?'Hesap kurulumu ve başlangıç kataloğu yüklemesinden sonra derslerin burada görünecek. Kendi başlıklarını da ekleyebilirsin.':'Arama veya filtreleri değiştirerek başka konuları görebilirsin.'}/>:
  <div className={styles.topicGroups}>{topicGroups.map((group,index)=>{
   const defaultOpen=autoExpandGroups||index===0;
   const groupViewKey=autoExpandGroups?[exam,level,query.trim().toLocaleLowerCase('tr'),group.key].join('|'):group.key;
   const isOpen=openGroups[groupViewKey]??defaultOpen;
   const groupPercent=group.completed===group.total?100:Math.min(99,Math.round(group.completed/group.total*100));
   return <section className={styles.groupSection} key={group.key}>
    <h3 className={styles.groupHeading}><button type="button" className={styles.groupToggle} aria-expanded={isOpen} aria-controls={'topic-group-'+index} onClick={()=>setOpenGroups(current=>({...current,[groupViewKey]:!(current[groupViewKey]??defaultOpen)}))}>
     <span className={styles.groupExam}>{group.exam}</span>
     <span className={styles.groupInfo}><strong>{group.subject}</strong><small>{group.completed} / {group.total} tamamlandı{topics.length!==totalTopics?' · '+group.topics.length+' gösteriliyor':''}</small></span>
     <span className={styles.groupMeter} aria-hidden="true"><span style={{width:groupPercent+'%'}}/></span>
     <ChevronDown className={styles.groupChevron} size={17} aria-hidden="true"/>
    </button></h3>
    <div className={styles.groupBody} id={'topic-group-'+index} hidden={!isOpen}>{group.topics.map(t=>
   <div className="topic-row" key={t.id}>
    <div><div className={styles.topicMeta}><span className="eyebrow">{t.exam} · {t.subject}</span>{t.source.startsWith('Düzenlenebilir başlangıç listesi')&&<span className={styles.legacyBadge}>Önceki plan</span>}</div><button className="topic-name" disabled={busy} onClick={()=>{setSubjectError('');setSelected(t)}}>{t.name}<ArrowUpRight size={15}/></button>{t.parent_id&&<small>Alt konu</small>}</div>
    <div className={styles.masteryControl} data-topic-mastery-control data-level={t.mastery}>
     <button type="button" className={styles.masteryTrigger} aria-label={`${t.name} öğrenme düzeyi: ${masteryLabels[t.mastery]}`} aria-expanded={openMasteryId===t.id} aria-controls={openMasteryId===t.id?`mastery-options-${t.id}`:undefined} disabled={busy} onClick={e=>{openTrigger.current=e.currentTarget;setOpenMasteryId(current=>current===t.id?null:t.id)}}>
      <span className={styles.masteryDot}/><span className={styles.masteryLabel}>{shortMasteryLabels[t.mastery]??masteryLabels[t.mastery]}</span><ChevronDown size={15} aria-hidden="true"/>
     </button>
     <div className={styles.masteryProgress} aria-hidden="true">{[1,2,3,4].map(step=><span key={step} className={t.mastery>=step?styles.filled:''}/>)}</div>
     {openMasteryId===t.id&&<div id={`mastery-options-${t.id}`} className={styles.masteryMenu} role="group" aria-label={`${t.name} öğrenme düzeyi seçimi`}>
      <span className={styles.menuHeading}>Öğrenme düzeyi</span>
      {masteryLabels.map((label,i)=><button type="button" key={label} className={styles.masteryOption} data-level={i} aria-pressed={t.mastery===i} disabled={busy} onClick={()=>{setOpenMasteryId(null);openTrigger.current?.focus();if(t.mastery!==i)void command('topic.update',{id:t.id,expected_revision:t.revision,mastery:i})}}><span className={styles.optionStep}>{i===0?'–':i}</span><span>{label}</span>{t.mastery===i&&<Check size={15} aria-hidden="true"/>}</button>)}
     </div>}
    </div>
   </div>
  )}</div></section>})}</div>}
 </Card>
 {selected!==false&&<Modal title={selected?selected.name:'Yeni konu'} onClose={()=>setSelected(false)}><form className="form-grid" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(f.get('exam')==='TYT'&&isExcludedTytSubject(String(f.get('subject')??''))){setSubjectError('TYT Tarih, Felsefe ve Din Kültürü konuları bu sayfada gösterilmiyor. Başka bir ders seç.');return;}setSubjectError('');const data={name:f.get('name'),exam:f.get('exam'),subject:f.get('subject'),parent_id:f.get('parent_id')||null,mastery:Number(f.get('mastery')),notes:f.get('notes'),source:f.get('source'),next_step:f.get('next_step'),review_requested:f.get('review_requested')==='on'};if(await command(selected?'topic.update':'topic.create',selected?{...data,id:selected.id,expected_revision:selected.revision}:data))setSelected(false)}}>
 <label className="span-2">Konu adı<input name="name" required defaultValue={selected?.name??''} autoFocus/></label><label>Sınav<select name="exam" defaultValue={selected?.exam??'TYT'} onChange={()=>setSubjectError('')}><option>TYT</option><option>AYT</option></select></label><label>Ders<input name="subject" required defaultValue={selected?.subject??''} placeholder="Matematik" onChange={()=>setSubjectError('')}/>{subjectError&&<small className={styles.subjectError} role="alert">{subjectError}</small>}</label>
 <label className="span-2">Üst konu<select name="parent_id" defaultValue={selected?.parent_id??''}><option value="">Ana konu</option>{visibleTopics.filter(t=>t.id!==selected?.id).map(t=><option key={t.id} value={t.id}>{t.exam} / {t.subject} / {t.name}</option>)}</select></label>
 <label className="span-2">Öğrenme düzeyi<select name="mastery" defaultValue={selected?.mastery??0}>{masteryLabels.map((s,i)=><option key={s} value={i}>{s}</option>)}</select></label>
 <label className="span-2">Kaynaklar<input name="source" defaultValue={selected?.source??''}/></label><label className="span-2">Notlar<textarea name="notes" rows={3} defaultValue={selected?.notes??''}/></label><label className="span-2">Sonraki adım<input name="next_step" defaultValue={selected?.next_step??''}/></label><label className="checkbox-label span-2"><input name="review_requested" type="checkbox" defaultChecked={selected?.review_requested??false}/>Tekrar kuyruğuna işaretle (öğrenme düzeyini değiştirmez)</label>
 {selected&&<div className="span-2 topic-details"><p>Kaydedilen net süre: <strong>{duration(state.sessions.filter(s=>s.topic_id===selected.id).reduce((a,s)=>a+s.accumulated_seconds,0))}</strong></p><h3>Düzey geçmişi</h3>{state.topic_history.filter(h=>h.topic_id===selected.id).length===0?<p>Henüz düzey değişikliği yok.</p>:state.topic_history.filter(h=>h.topic_id===selected.id).map(h=><p key={h.id}>{masteryLabels[h.old_mastery]} → {masteryLabels[h.new_mastery]} · {new Date(h.changed_at).toLocaleDateString('tr-TR')}</p>)}</div>}
 <div className="form-actions span-2"><button type="button" className="button secondary" onClick={()=>setSelected(false)}>Vazgeç</button><button className="button primary" disabled={busy||!state.authenticated}>Kaydet</button></div>
 </form></Modal>}
 </>;
}

