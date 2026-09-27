'use client';
import {useRef,useState} from 'react';
import {ArrowUpRight,ChevronLeft,ChevronRight,NotebookPen,PenLine,Sparkles,Trash2} from 'lucide-react';
import type {AppState,JournalEntry,JournalStructuredFields} from '@/lib/domain/types';
import {formatDay,localDate,type CommandFn} from '@/lib/ui';
import {Card,Empty} from './primitives';
import {Modal} from './modal';

const fieldLabels:Record<string,string>={original_text:'Serbest metin',sleep_at:'Uyuma saati',wake_at:'Uyanma saati',sleep_quality:'Uyku kalitesi',mood:'Ruh hâli',energy:'Enerji',stress:'Stres',environment:'Çalışma ortamı',interruptions:'Bölünme sayısı',activities:'Aktiviteler',people_tags:'Kişi etiketleri',food_drink:'Yediklerin / içtiklerin',thoughts:'Aklındakiler'};
function shift(value:string,amount:number){const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10)}
function list(value:string){return value.split(',').map(item=>item.trim()).filter(Boolean)}
export function Journal({state,command,busy,initialDate}:{state:AppState;command:CommandFn;busy:boolean;initialDate?:string}){
 const today=localDate(Date.parse(state.server_now),state.settings?.timezone??'Europe/Istanbul');
 const [selectedDate,setSelectedDate]=useState(initialDate&&initialDate<=today?initialDate:today);
 const [deleting,setDeleting]=useState<JournalEntry|null>(null);
 const entry=state.journal_entries.find(item=>item.journal_date===selectedDate);
 const entries=[...state.journal_entries].sort((a,b)=>b.journal_date.localeCompare(a.journal_date));
 return <div className="journal-page"><div className="journal-intro"><div><p className="eyebrow">SANA AİT ALAN</p><h2>Bugünü kendi sözlerinle anlat.</h2><p>İstediğin kadar kısa yaz. İsteğe bağlı ayrıntıları kendin ekle veya AI önerilerini incele.</p></div><NotebookPen size={28}/></div><div className="journal-layout">
  <Card className="ambient-card journal-editor-card" title={formatDay(selectedDate)} eyebrow="GÜNLÜK GİRİŞİ" action={<div className="journal-date-nav"><button className="icon-button" aria-label="Önceki gün" onClick={()=>setSelectedDate(shift(selectedDate,-1))}><ChevronLeft size={17}/></button><input aria-label="Günlük tarihi" type="date" max={today} value={selectedDate} onChange={event=>{if(event.target.value&&event.target.value<=today)setSelectedDate(event.target.value)}}/><button className="icon-button" aria-label="Sonraki gün" disabled={selectedDate>=today} onClick={()=>setSelectedDate(shift(selectedDate,1))}><ChevronRight size={17}/></button></div>}><JournalForm key={entry?.id??selectedDate} entry={entry} date={selectedDate} busy={busy} authenticated={state.authenticated} onSave={async(type,payload)=>{await command(type,payload)}} onDelete={()=>entry&&setDeleting(entry)}/></Card>
  <Card className="ambient-card journal-history-card" title="Yazdığın günler" eyebrow="GÜNLÜK ARŞİVİ" action={<span className="pill">{entries.length} kayıt</span>}>{entries.length?<div className="journal-history">{entries.map(item=><button key={item.id} className={selectedDate===item.journal_date?'selected':''} onClick={()=>setSelectedDate(item.journal_date)}><span><strong>{formatDay(item.journal_date,{day:'numeric',month:'short',year:'numeric'})}</strong><small>{item.exclude_from_analysis?'Analiz dışında':'Analize dahil edilebilir'}</small></span><span>{item.original_text.trim()?item.original_text.trim().slice(0,90):'İsteğe bağlı alanlar kaydedildi.'}</span><ArrowUpRight size={15}/></button>)}</div>:<Empty icon={<NotebookPen/>} title="Henüz günlük yazmadın" text="Bir cümleyle bile başlayabilirsin. Boş günlere bir şey uydurmana gerek yok."/>}<p className="footnote">Kayıtlar seçtiğin yerel tarihe bağlanır. Çalışma sürelerinden günlük metni çıkarılmaz.</p></Card>
 </div>{deleting&&<Modal title="Günlük kaydını sil" onClose={()=>setDeleting(null)}><p>{formatDay(deleting.journal_date)} tarihli günlük kaydı silinecek.</p><div className="form-actions"><button className="button secondary" onClick={()=>setDeleting(null)}>Vazgeç</button><button className="button primary" disabled={busy} onClick={async()=>{if(await command('journal.delete',{id:deleting.id,expected_revision:deleting.revision}))setDeleting(null)}}><Trash2 size={16}/>Kaydı sil</button></div></Modal>}</div>;
}
function JournalForm({entry,date,busy,authenticated,onSave,onDelete}:{entry:JournalEntry|undefined;date:string;busy:boolean;authenticated:boolean;onSave:(type:string,payload:Record<string,unknown>)=>Promise<void>;onDelete:()=>void}){
 const fields=entry?.structured_fields??{};
 const [advanced,setAdvanced]=useState(Object.keys(fields).length>0);
 const [text,setText]=useState(entry?.original_text??'');
 const [sleepAt,setSleepAt]=useState(fields.sleep_at??'');const [wakeAt,setWakeAt]=useState(fields.wake_at??'');
 const [sleepQuality,setSleepQuality]=useState(fields.sleep_quality?.toString()??'');
 const [mood,setMood]=useState(fields.mood??'');const [energy,setEnergy]=useState(fields.energy?.toString()??'');const [stress,setStress]=useState(fields.stress?.toString()??'');
 const [environment,setEnvironment]=useState(fields.environment??'');const [interruptions,setInterruptions]=useState(fields.interruptions?.toString()??'');
 const [activities,setActivities]=useState(fields.activities?.join(', ')??'');const [peopleTags,setPeopleTags]=useState(fields.people_tags?.join(', ')??'');
 const [foodDrink,setFoodDrink]=useState(fields.food_drink??'');const [thoughts,setThoughts]=useState(fields.thoughts??'');
 const [excluded,setExcluded]=useState(entry?.exclude_from_analysis??false);
 const [shared,setShared]=useState<string[]>(entry?.ai_shared_fields??[]);
 const [message,setMessage]=useState('');
 const [suggesting,setSuggesting]=useState(false);
 const [suggestion,setSuggestion]=useState<JournalStructuredFields|null>(null);
 const [suggestionSource,setSuggestionSource]=useState('');
 const [suggestionUsage,setSuggestionUsage]=useState<{input_tokens:number;output_tokens:number;estimated_cost_usd:number}|null>(null);
 const suggestionPending=useRef(false);
 const currentTextRef=useRef(text);
 const suggest=async()=>{
  if(suggestionPending.current||busy||!authenticated)return;
  const source=text;
  if(source.trim().length<3||source.length>4000){setMessage('AI önerisi için 3–4.000 karakter arasında metin yaz. Günlüğü yine normal kaydedebilirsin.');return}
  suggestionPending.current=true;setSuggesting(true);setMessage('');setSuggestion(null);
  try{
   const response=await fetch('/api/journal/suggest',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({request_id:crypto.randomUUID(),journal_date:date,original_text:source})});
   const body=await response.json() as {ok?:boolean;fields?:JournalStructuredFields;
    usage?:{input_tokens:number;output_tokens:number;estimated_cost_usd:number};error?:{message?:string}};
   if(!response.ok||!body.ok)throw new Error(body.error?.message??'AI önerisi alınamadı.');
   if(currentTextRef.current!==source){setMessage('Metin değiştiği için önceki öneri gösterilmedi.');return;}
   setSuggestion(body.fields??{});setSuggestionSource(source);setSuggestionUsage(body.usage??null);
  }catch(error){setMessage(error instanceof Error?error.message:'AI önerisi alınamadı.');}
  finally{suggestionPending.current=false;setSuggesting(false)}
 };
 const applySuggestion=()=>{
  if(!suggestion||suggestionSource!==text)return;
  if(!sleepAt&&suggestion.sleep_at)setSleepAt(suggestion.sleep_at);
  if(!wakeAt&&suggestion.wake_at)setWakeAt(suggestion.wake_at);
  if(!sleepQuality&&suggestion.sleep_quality)setSleepQuality(String(suggestion.sleep_quality));
  if(!mood&&suggestion.mood)setMood(suggestion.mood);
  if(!energy&&suggestion.energy)setEnergy(String(suggestion.energy));
  if(!stress&&suggestion.stress)setStress(String(suggestion.stress));
  if(!environment&&suggestion.environment)setEnvironment(suggestion.environment);
  if(!interruptions&&suggestion.interruptions!==undefined)setInterruptions(String(suggestion.interruptions));
  if(!activities&&suggestion.activities?.length)setActivities(suggestion.activities.join(', '));
  if(!peopleTags&&suggestion.people_tags?.length)setPeopleTags(suggestion.people_tags.join(', '));
  if(!foodDrink&&suggestion.food_drink)setFoodDrink(suggestion.food_drink);
  if(!thoughts&&suggestion.thoughts)setThoughts(suggestion.thoughts);
  setAdvanced(true);setSuggestion(null);setMessage('Öneriler boş alanlara aktarıldı. Kontrol edip Günlüğü kaydet düğmesine bas.');
 };
 const structured:JournalStructuredFields={};
 if(sleepAt)structured.sleep_at=sleepAt;if(wakeAt)structured.wake_at=wakeAt;
 if(sleepQuality)structured.sleep_quality=Number(sleepQuality);if(mood.trim())structured.mood=mood.trim();
 if(energy)structured.energy=Number(energy);if(stress)structured.stress=Number(stress);
 if(environment.trim())structured.environment=environment.trim();if(interruptions!=='')structured.interruptions=Number(interruptions);
 if(list(activities).length)structured.activities=list(activities);if(list(peopleTags).length)structured.people_tags=list(peopleTags);
 if(foodDrink.trim())structured.food_drink=foodDrink.trim();if(thoughts.trim())structured.thoughts=thoughts.trim();
 const present=['original_text',...Object.keys(structured)].filter(key=>key!=='original_text'||text.trim());
 return <form className="journal-form" onSubmit={async event=>{event.preventDefault();setMessage('');if(!text.trim()&&!Object.keys(structured).length){setMessage('Bir cümle yaz veya isteğe bağlı bir alan doldur.');return}const payload:Record<string,unknown>={journal_date:date,original_text:text,structured_fields:structured,exclude_from_analysis:excluded,ai_shared_fields:excluded?[]:shared.filter(key=>present.includes(key))};if(entry){payload.id=entry.id;payload.expected_revision=entry.revision}await onSave(entry?'journal.update':'journal.create',payload)}}>
  <label className="journal-main-label">Bugün aklında neler kaldı?<textarea value={text} onChange={event=>{currentTextRef.current=event.target.value;setText(event.target.value);setSuggestion(null)}} maxLength={20000} rows={8} placeholder="Bugün şöyle geçti…"/></label>
  <div className="journal-form-tools"><button type="button" className="button secondary" aria-expanded={advanced} onClick={()=>setAdvanced(!advanced)}><PenLine size={15}/>{advanced?'İsteğe bağlı alanları gizle':'İsteğe bağlı alanlar'}</button><span>{text.length} / 20.000</span></div>
  <div className="journal-ai-tool"><div><strong>Yazdıklarından alan öner</strong><p>Bu düğmeye basarsan en fazla 4.000 karakter OpenAI API’ye gönderilir. API kullanımı ücretli olabilir. Öneriler kaydedilmeden önce senin onayını bekler.</p></div><button type="button" className="button secondary" disabled={busy||suggesting||!authenticated||text.trim().length<3||text.length>4000} onClick={()=>void suggest()}><Sparkles size={15}/>{suggesting?'Öneriliyor…':'AI ile öner'}</button></div>
  {suggestion&&<div className="journal-ai-review" role="region" aria-label="AI günlük alan önerileri"><div className="journal-ai-review-head"><strong>Önerileri gözden geçir</strong><span>{suggestionUsage?'Tahmini $'+suggestionUsage.estimated_cost_usd.toFixed(4)+' · '+(suggestionUsage.input_tokens+suggestionUsage.output_tokens)+' token':''}</span></div>{Object.entries(suggestion).length?<ul>{Object.entries(suggestion).map(([key,value])=><li key={key}><span>{fieldLabels[key]??key}</span><strong>{Array.isArray(value)?value.join(', '):String(value)}</strong></li>)}</ul>:<p>Metinde güvenle ayrılabilecek isteğe bağlı alan bulunamadı. Kendi sözlerin yine aynen kalır.</p>}<div className="journal-ai-review-actions"><button type="button" className="button secondary" onClick={()=>setSuggestion(null)}>Önerileri bırak</button>{Object.keys(suggestion).length>0&&<button type="button" className="button primary" onClick={applySuggestion}>Boş alanlara uygula</button>}</div></div>}
  {advanced&&<div className="journal-optional"><div className="journal-fields"><label>Uyuma saati<input type="time" value={sleepAt} onChange={event=>setSleepAt(event.target.value)}/></label><label>Uyanma saati<input type="time" value={wakeAt} onChange={event=>setWakeAt(event.target.value)}/></label><label>Uyku kalitesi (1–5)<input type="number" min="1" max="5" value={sleepQuality} onChange={event=>setSleepQuality(event.target.value)}/></label><label>Ruh hâli<input maxLength={120} value={mood} onChange={event=>setMood(event.target.value)}/></label><label>Enerji (1–5)<input type="number" min="1" max="5" value={energy} onChange={event=>setEnergy(event.target.value)}/></label><label>Stres (1–5)<input type="number" min="1" max="5" value={stress} onChange={event=>setStress(event.target.value)}/></label><label>Çalışma ortamı<input maxLength={500} value={environment} onChange={event=>setEnvironment(event.target.value)}/></label><label>Bölünme sayısı<input type="number" min="0" max="100" value={interruptions} onChange={event=>setInterruptions(event.target.value)}/></label><label>Aktiviteler (virgülle ayır)<input value={activities} onChange={event=>setActivities(event.target.value)}/></label><label>Kişi etiketleri (virgülle ayır)<input value={peopleTags} onChange={event=>setPeopleTags(event.target.value)}/></label><label className="span-2">Yediklerin / içtiklerin<textarea rows={2} maxLength={2000} value={foodDrink} onChange={event=>setFoodDrink(event.target.value)}/></label><label className="span-2">Aklındakiler<textarea rows={3} maxLength={5000} value={thoughts} onChange={event=>setThoughts(event.target.value)}/></label></div><p className="footnote">Bu alanların hiçbiri zorunlu değil. Yazmadığın bilgi tahmin edilmez.</p></div>}
  <div className="journal-privacy"><label className="journal-exclude"><input type="checkbox" checked={excluded} onChange={event=>setExcluded(event.target.checked)}/><span><strong>Analize dahil etme</strong><small>Bu günlüğün metni ve alanları gelecekteki AI analizlerine verilmez.</small></span></label><details><summary>Gelecekteki AI analiziyle paylaşılabilecek alanlar</summary><p>Yalnız işaretlediğin doldurulmuş alanlar dönem analizine gider. AI ile alan önerisi istemek bu seçimleri değiştirmez.</p><div className="journal-share-options">{present.map(key=><label key={key}><input type="checkbox" disabled={excluded} checked={!excluded&&shared.includes(key)} onChange={event=>setShared(current=>event.target.checked?[...current,key]:current.filter(item=>item!==key))}/>{fieldLabels[key]??key}</label>)}</div>{present.length===0&&<p>Paylaşılabilecek doldurulmuş alan yok.</p>}</details></div>
  {message&&<p className="error-text" role="alert">{message}</p>}
  <div className="journal-form-bottom"><span>{entry?'Son kayıt: '+new Intl.DateTimeFormat('tr-TR',{dateStyle:'short',timeStyle:'short'}).format(new Date(entry.updated_at)):'Henüz bu güne ait kayıt yok.'}</span><div>{entry&&<button type="button" className="text-button" disabled={busy} onClick={onDelete}><Trash2 size={15}/>Sil</button>}<button className="button primary" disabled={busy||suggesting||!authenticated}>{busy?'Kaydediliyor…':'Günlüğü kaydet'}<ArrowUpRight size={16}/></button></div></div>
 </form>;
}
