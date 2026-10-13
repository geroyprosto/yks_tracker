'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,RefreshCw,Send,Sparkles,WifiOff} from 'lucide-react';
import Link from 'next/link';
import {weeklyRaceSummary} from '@/lib/nova/race-summary';
import {normalizeNovaReplyText} from '@/lib/nova/terminology';
import type {NovaMemory,NovaMessage,NovaWebState} from '@/lib/nova/web-types';
import styles from './workspace.module.css';

type Tab='today'|'chat'|'race'|'lab';
type Command=(value:Record<string,unknown>)=>Promise<boolean>;
const tabs:{id:Tab;label:string}[]=[{id:'today',label:'Nova Bugün'},{id:'chat',label:'Sohbet'},{id:'race',label:'Yarış'},{id:'lab',label:'Nova Lab'}];
const reasons:Record<string,string>={GOOD_SLEEP:'Simüle uykusu dinlendiriciydi.',SHORT_SLEEP:'Simüle uykusu kısa sürdü.',RECOVERY:'Dinlenerek toparlandı.',STUDY_LOAD:'Çalışma yükü enerjisini etkiledi.',DISTRACTION:'Dikkati bir süre dağıldı.',TASK_COMPLETED:'Planındaki bir çalışmayı tamamladı.',TASK_MISSED:'Planındaki bir çalışma aksadı.',CALIBRATION:'Başlangıç seviyesi henüz kalibre ediliyor.',PREVIOUS_DAY:'Önceki günün etkileri sürüyor.'};
const statusLabels:Record<string,string>={QUEUED:'Sırada',CLAIMED:'Hazırlanıyor',GENERATING:'Yanıt üretiliyor',COMPLETED:'Yanıtlandı',FAILED:'Hata',CANCELLED:'İptal edildi',RETRY_WAIT:'Yeniden deneme bekliyor',queued:'Sırada',sent:'Gönderildi',delivered:'Teslim edildi',completed:'Yanıtlandı'};
const number=(value:number|null|undefined)=>value==null?'Kayıt yok':new Intl.NumberFormat('tr-TR',{maximumFractionDigits:1}).format(value);
const clock=(date:string,timezone:string)=>new Intl.DateTimeFormat('tr-TR',{timeZone:timezone,hour:'2-digit',minute:'2-digit'}).format(new Date(date));
async function readNova(value:Record<string,unknown>){const res=await fetch('/api/nova',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const body=await res.json();if(!res.ok)throw new Error(body.error?.message??'Kayıt okunamadı.');return body;}

export function NovaWorkspace({standalone=false}:{standalone?:boolean}){
 const [tab,setTab]=useState<Tab>('today');
 const [data,setData]=useState<NovaWebState|null>(null);
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [online,setOnline]=useState(true);
 const [draft,setDraft]=useState('');const [pairCode,setPairCode]=useState('');
 const [older,setOlder]=useState<NovaMessage[]>([]);const [historyEnd,setHistoryEnd]=useState(false);
 const pending=useRef<{id:string;content:string}|null>(null);
 const refresh=useCallback(async()=>{
  try{const response=await fetch('/api/nova',{cache:'no-store'});const value=await response.json();if(!response.ok)throw new Error(value.error?.message??'Nova yüklenemedi.');setData(value);setError('');}
  catch(e){setError(e instanceof Error?e.message:'Bağlantı kurulamadı.');}
 },[]);
 useEffect(()=>{
  const initial=setTimeout(()=>{setOnline(navigator.onLine);void refresh();},0);const update=()=>setOnline(navigator.onLine);
  const onVisible=()=>{if(document.visibilityState==='visible'&&navigator.onLine)void refresh();};
  const timer=setInterval(onVisible,30000);
  window.addEventListener('online',update);window.addEventListener('offline',update);document.addEventListener('visibilitychange',onVisible);
  const code=new URLSearchParams(window.location.search).get('pair');
  if(code)queueMicrotask(()=>{setPairCode(code);setTab('lab');});
  return()=>{clearTimeout(initial);clearInterval(timer);window.removeEventListener('online',update);window.removeEventListener('offline',update);document.removeEventListener('visibilitychange',onVisible);};
 },[refresh]);
 const command:Command=async(value)=>{
  if(!navigator.onLine){setError('İnternet bağlantısı yok. İşlem sunucuya kaydedilmedi; tekrar bağlanınca yeniden dene.');return false;}
  setBusy(true);setError('');
  try{const res=await fetch('/api/nova',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const body=await res.json();if(!res.ok)throw new Error(body.error?.message??'İşlem tamamlanamadı.');await refresh();return true;}
  catch(e){setError(e instanceof Error?e.message:'İşlem kaydedilmedi.');return false;}finally{setBusy(false);}
 };
 const send=async()=>{
  const content=draft.trim();if(!content)return;
  if(!pending.current||pending.current.content!==content)pending.current={id:crypto.randomUUID(),content};
  if(await command({operation:'message',requestId:pending.current.id,content})){setDraft('');pending.current=null;}
 };
 const connected=data?.devices.some(d=>!d.revoked_at&&d.model_available&&d.last_seen_at&&Date.parse(data.serverNow)-Date.parse(d.last_seen_at)<150000);
 const messages=[...new Map([...older,...(data?.messages??[])].map(m=>[m.id,m])).values()].sort((a,b)=>a.sequence-b.sequence);
 const loadOlder=async()=>{setBusy(true);try{const before=messages[0]?.sequence;const batch=await readNova({operation:'history',beforeSequence:before}) as NovaMessage[];setOlder(previous=>[...batch,...previous]);setHistoryEnd(batch.length<50);}catch(e){setError(e instanceof Error?e.message:'Geçmiş okunamadı.');}finally{setBusy(false);}};
 return <section className={`${styles.workspace} ${standalone?styles.standalone:''}`} aria-label="Nova çalışma arkadaşı">
  {standalone&&<Link href="/" className="text-button"><ArrowLeft size={16}/>Çalışma alanına dön</Link>}
  <header className={styles.heading}><div className={styles.identity}><div className={styles.avatar} aria-hidden="true"><Sparkles size={30}/></div><div><p className="eyebrow">YKSim · Dijital çalışma arkadaşı</p>{standalone?<h1>Nova</h1>:<h2>Birlikte, kendi ritminde.</h2>}<p className="subtle">Yapay zekâ destekli sohbet · Simüle yaşam ve yarış</p></div></div><button className="button secondary" disabled={busy} onClick={()=>void refresh()} aria-label="Nova durumunu yenile"><RefreshCw size={16}/>Yenile</button></header>
  <nav className="settings-tabs" aria-label="Nova bölümleri">{tabs.map(t=><button key={t.id} className={tab===t.id?'active':''} aria-pressed={tab===t.id} onClick={()=>setTab(t.id)}>{t.label}</button>)}</nav>
  {!online&&<p className="notice" role="status"><WifiOff size={18}/>Çevrimdışısın. Gösterilen son kayıtlar güncel olmayabilir.</p>}
  {error&&<div className="notice error" role="alert">{error}<button className="text-button" onClick={()=>void refresh()}>Tekrar dene</button></div>}
  {!data&&!error&&<p className="loading" role="status">Nova yükleniyor…</p>}
  {data&&<>
   {data.demo&&<p className="notice">Yerel test ortamı. Bu kayıtlar gerçek hesabından ayrıdır.</p>}
   <p className={styles.connection} role="status"><span className={connected?styles.connected:styles.disconnected}/>{connected?'Yerel model bağlı':'Yerel model bağlı değil'}<span className="subtle">{connected?'Yanıtlar bilgisayarında üretilir.':'Gönderilen mesajlar bilgisayar bağlanana kadar sunucudaki sırada kalır.'}</span></p>
   {data.catchupRemaining&&<p className="notice">Geçmiş günler sırayla tamamlanıyor. Her yenilemede en fazla yedi gün işlenir.</p>}
   {tab==='today'&&<Today data={data}/>}
   {tab==='race'&&<Race data={data}/>}
   {tab==='chat'&&<div className={styles.chat}>
    <div className={styles.chatContext}><strong>{data.today?.mood??'Gün hazırlanıyor'}</strong><span>{data.today?.currentEvent?.label??'Günlük program bekleniyor'}</span></div>
    <div className={styles.messages} role="log" aria-label="Konuşma geçmişi" aria-live="polite">
     {messages.length>0&&!historyEnd&&messages[0].sequence>1&&<button className="text-button" disabled={busy} onClick={()=>void loadOlder()}>Önceki mesajları yükle</button>}
     {!data.messages.length&&<div className="empty"><h2>Bir merhaba ile başla.</h2><p>Nova, bugünkü kayıtlı durumu ve onayladığın hafızalarla konuşur.</p></div>}
     {messages.map(m=>{const job=data.jobs.find(j=>j.source_message_id===m.id);const action=m.result?.proposedAction;return <article key={m.id} className={`${styles.message} ${m.sender==='user'?styles.user:''}`} id={`nova-message-${m.id}`}><div className={styles.messageMeta}><strong>{m.sender==='user'?'Sen':'Nova'}</strong><time dateTime={m.created_at}>{clock(m.created_at,data.settings.timezone)}</time></div><p>{m.sender==='nova'?normalizeNovaReplyText(m.content):m.content}</p>{job&&<div className={styles.messageMeta}><span>{statusLabels[job.status]??'Bekliyor'}</span>{job.status==='FAILED'&&<button className="text-button" disabled={busy} onClick={()=>void command({operation:'retry',jobId:job.id})}>Yanıtı yeniden dene</button>}</div>}{action&&<div className={styles.actions}><span>{action.durationMinutes??25} dakikalık odak düellosu teklifi</span>{m.duel_decision?<strong>{m.duel_decision==='accepted'?'Kabul ettin':'Reddettin'}</strong>:<><button className="button secondary" disabled={busy} onClick={()=>void command({operation:'duel',messageId:m.id,accept:true})}>Kabul et</button><button className="text-button" disabled={busy} onClick={()=>void command({operation:'duel',messageId:m.id,accept:false})}>Reddet</button></>}</div>}</article>;})}
    </div>
    <form className={styles.composer} onSubmit={e=>{e.preventDefault();void send();}}><label htmlFor="nova-message">Nova’ya mesajın</label><textarea id="nova-message" maxLength={4000} rows={3} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Bugün matematiğe odaklanmak istiyorum…"/><div><small className="subtle">Sunucuya kaydedilen mesaj, model kapalı olsa da korunur.</small><button className="button primary" disabled={busy||!draft.trim()||!online}><Send size={16}/>{busy?'Kaydediliyor…':'Gönder'}</button></div></form>
   </div>}
   {tab==='lab'&&<div className={styles.lab}>
    <section className="card"><h2>Yerel bağlantı ve eşleştirme</h2><p className="subtle">Bilgisayarında Bridge’in gösterdiği tek kullanımlık kodu gir. Yalnızca kendi başlattığın eşleştirmeyi onayla.</p><form className={styles.actions} onSubmit={e=>{e.preventDefault();void command({operation:'pair.approve',code:pairCode.trim()}).then(ok=>{if(ok)setPairCode('');});}}><label>Eşleştirme kodu<input value={pairCode} onChange={e=>setPairCode(e.target.value)} maxLength={12} autoComplete="off" required/></label><button className="button secondary" disabled={busy||pairCode.length!==12}>Cihazı onayla</button></form><ul className={styles.list}>{data.devices.map(d=><li key={d.id}><div><strong>{d.name}</strong><p>{d.revoked_at?'Erişimi iptal edildi':d.model_available?'Model hazır':'Model hazır değil'} · {d.model??'Model bildirilmedi'}</p><small>Son bağlantı: {d.last_seen_at?new Date(d.last_seen_at).toLocaleString('tr-TR',{timeZone:data.settings.timezone}):'Henüz bağlanmadı'}</small></div>{!d.revoked_at&&<button className="text-button" disabled={busy} onClick={()=>void command({operation:'device.revoke',deviceId:d.id})}>Erişimi iptal et</button>}</li>)}</ul>{!data.devices.length&&<p className="subtle">Henüz eşleştirilmiş cihaz yok.</p>}</section>
    <section className="card"><h2>Nova benim hakkımda ne biliyor?</h2><p className="subtle">Öneriler onayın olmadan hafızaya eklenmez. Unutulan kaynağın yeniden otomatik öğrenilmesi engellenir.</p>{!data.memories.length&&<p className="empty">Henüz bir hafıza yok.</p>}{data.memories.map(memory=><Memory key={memory.id} memory={memory} source={data.messages.find(m=>m.id===memory.source_message_id)?.content} command={command} busy={busy}/>)}</section>
    <Settings data={data} command={command} busy={busy}/>
    <section className="card"><h2>İş kuyruğu</h2><p className="subtle">{data.jobs.length} yakın iş · Bugün {data.proactiveCount} proaktif mesaj</p><ul className={styles.list}>{data.jobs.map(j=><li key={j.id}><span>{statusLabels[j.status]??j.status} · {j.attempt_count} deneme{j.error&&<small className="error-text"> · {j.error}</small>}</span>{j.status==='FAILED'&&<button className="text-button" disabled={busy} onClick={()=>void command({operation:'retry',jobId:j.id})}>Yeniden dene</button>}</li>)}</ul></section>
    <details className="card"><summary>Simülasyon kaydı ve ham durum</summary><dl className={styles.diagnostics}><dt>Motor sürümü</dt><dd>{data.dayInfo?.engineVersion??data.profile.engine_version}</dd><dt>Gün tohumu</dt><dd>{data.dayInfo?.seed??'Henüz yok'}</dd><dt>Yerel gün</dt><dd>{data.dayInfo?.localDate??'Henüz yok'}</dd><dt>Saat dilimi</dt><dd>{data.settings.timezone}</dd></dl><pre>{JSON.stringify({durum:data.today?.state,nedenler:data.today?.reasonCodes,iliski:data.relationship,olaylar:data.today?.timeline},null,2)}</pre><p className="subtle">Planlanan olayların sonuçları tamamlanmadan gösterilmez. Durum ve ilişki sayıları oyun parametreleridir.</p></details>
   </div>}
  </>}
 </section>;
}
function Today({data}:{data:NovaWebState}){
 const day=data.today;if(!day)return <div className="card empty">Nova’nın günü hazırlanıyor.</div>;
 const difference=data.race?.user.total!=null&&data.race.nova.total!=null?data.race.user.total-data.race.nova.total:null;
 return <div className={styles.today}><section className={`card ${styles.mood}`}><p className="eyebrow">Bugünün modu</p><h2>{day.mood}</h2><p>{day.currentEvent?.label??'Günlük program tamamlandı.'}</p><div className={styles.bars}>{([['energy','Enerji'],['focus','Odak'],['stress','Stres']] as const).map(([key,label])=><label key={key}>{label}<span>{number(day.state[key])} / 100</span><progress max={100} value={day.state[key]} aria-label={label}/></label>)}</div><details><summary>Neden böyle hissediyor?</summary><ul>{day.reasonCodes.map(code=><li key={code}>{reasons[code]??code}</li>)}</ul></details></section>
 <section className={`card ${styles.summary}`}><h2>Bugünkü tempo</h2><strong>{number(day.metrics.studyMinutes)} <small>dakika tamamlandı</small></strong><p>Günlük hedef: {number(day.metrics.studyTargetMinutes)} dakika</p><hr/><h3>Yarış farkı</h3><p>{difference===null?'Karşılaştırma için yeterli kayıt yok.':difference===0?'Şu an aynı puandasınız.':difference>0?`${number(difference)} puan öndesin.`:`Nova ${number(-difference)} puan önde.`}</p><p className="subtle">Nova’nın çalışması simülasyondur; gerçek kayıtlarına eklenmez.</p></section>
 <section className={`card ${styles.timeline}`}><h2>Günün akışı</h2><ol>{day.timeline.map(e=><li key={e.id} data-status={e.status}><time>{clock(e.startsAt,data.settings.timezone)}–{clock(e.endsAt,data.settings.timezone)}</time><div><strong>{e.label}</strong><span>{e.status==='completed'?'Tamamlandı':e.status==='active'?'Şu anda':'Planlandı'}{e.result&&e.result.studyMinutes>0?` · ${number(e.result.studyMinutes)} dk`:''}</span></div></li>)}</ol></section>
 {data.profile.baseline.missingData.length>0&&<aside className={`notice ${styles.wide}`}>Başlangıç verisi eksik: {data.profile.baseline.missingData.join(' ')} İlk yedi gün kontrollü kalibrasyon uygulanır.</aside>}
 </div>;
}
function Race({data}:{data:NovaWebState}){
 const race=data.race;if(!race)return <div className="card empty">Yarış kaydı henüz oluşmadı.</div>;
 const weekly=weeklyRaceSummary(data.weekly);
 const names={tasks:'Görev tamamlama',study:'Çalışma hedefi',questions:'Soru çalışması',topics:'Konu ilerlemesi',consistency:'İstikrar'};
 return <section className="card"><h2>Bugünün adil yarışı</h2><p className="subtle">Yalnızca iki tarafta da bulunan ölçümler karşılaştırılır. Ağırlıklar ürün tercihidir; bilimsel başarı tahmini değildir.</p><div className={styles.scores}><div><span>Sen · gerçek kayıtlar</span><strong>{number(race.user.total)}</strong></div><div><span>Nova · simülasyon</span><strong>{number(race.nova.total)}</strong></div></div><div className={styles.tableWrap}><table><caption>0–100 aralığında puan bileşenleri</caption><thead><tr><th scope="col">Bileşen</th><th scope="col">Sen</th><th scope="col">Nova</th><th scope="col">Ağırlık</th></tr></thead><tbody>{(Object.keys(names) as (keyof typeof names)[]).map(key=><tr key={key}><th scope="row">{names[key]}</th><td>{number(race.user.components[key])}</td><td>{number(race.nova.components[key])}</td><td>{number(race.user.weights[key]*100)}%</td></tr>)}<tr><th scope="row">Çalışma süresi</th><td>{number(race.userMetrics.studyMinutes)} dk</td><td>{number(race.novaMetrics.studyMinutes)} dk</td><td>—</td></tr><tr><th scope="row">Soru sayısı</th><td>{number(race.userMetrics.questions)}</td><td>{number(race.novaMetrics.questions)}</td><td>—</td></tr><tr><th scope="row">Doğruluk</th><td>{number(race.userMetrics.accuracyPercent)}</td><td>{number(race.novaMetrics.accuracyPercent)}</td><td>%</td></tr></tbody></table></div><p className="subtle">Eksik kayıt sıfır başarı sayılmaz. Soru doğruluğu kaydedilmemişse iki tarafta da puana katılmaz. Nova’nın günü sabah dondurulur; bugün seni yakalamak için yeniden yazılmaz.</p><h3 className={styles.sectionTitle}>Haftalık puan</h3><p>Sen {number(weekly.userTotal)} · Nova {number(weekly.novaTotal)}</p><p className="subtle">Son yedi kayıtlı tarihte, iki tarafın da puanı bulunan {weekly.includedDays} kesinleşmiş günün toplamı. Sürmekte olan gün dahil değildir; en fazla 700 puan.</p><h3 className={styles.sectionTitle}>Yakın günler</h3><ul className={styles.list}>{data.weekly.map(day=><li key={day.localDate}><strong>{day.localDate}</strong><span>Sen {number(day.userScore)} · Nova {number(day.novaScore)} · {day.finalized?'Kesinleşti':'Gün sürüyor'}</span></li>)}</ul></section>;
}
function Memory({memory,source,command,busy}:{memory:NovaMemory;source?:string;command:Command;busy:boolean}){
 const [editing,setEditing]=useState(false);const [text,setText]=useState(memory.content);
 const [loadedSource,setLoadedSource]=useState(source??'');const [sourceError,setSourceError]=useState('');
 const loadSource=async()=>{if(loadedSource)return;try{const value=await readNova({operation:'source',messageId:memory.source_message_id});setLoadedSource(value?.content??'Kaynak içeriği yok.');}catch(e){setSourceError(e instanceof Error?e.message:'Kaynak okunamadı.');}};
 const action=(action:string)=>void command({operation:'memory',memoryId:memory.id,action,content:action==='edit'?text:undefined}).then(ok=>{if(ok)setEditing(false);});
 return <article className={styles.memory}><div><strong>{memory.status==='candidate'?'Onay bekleyen öneri':memory.pinned?'Sabitlenmiş hafıza':'Hafıza'}</strong>{editing?<label>Hafıza metni<textarea value={text} onChange={e=>setText(e.target.value)} maxLength={500}/></label>:<p>{memory.content}</p>}<details onToggle={e=>{if(e.currentTarget.open)void loadSource();}}><summary>Kaynak mesajı gör</summary><p>{loadedSource||sourceError||'Kaynak yükleniyor…'}</p><small>Kaynak kimliği: {memory.source_message_id}</small></details></div><div className={styles.actions}>{memory.status==='candidate'?<><button className="button secondary" disabled={busy} onClick={()=>action('approve')}>Hatırlamasına izin ver</button><button className="text-button" disabled={busy} onClick={()=>action('reject')}>Reddet</button></>:<><button className="text-button" disabled={busy} onClick={()=>editing?action('edit'):setEditing(true)}>{editing?'Değişikliği kaydet':'Düzenle'}</button><button className="text-button" disabled={busy} onClick={()=>action(memory.pinned?'unpin':'pin')}>{memory.pinned?'Sabitlemeyi kaldır':'Sabitle'}</button></>}<button className="text-button" disabled={busy} onClick={()=>action('forget')}>Unut</button></div></article>;
}
function Settings({data,command,busy}:{data:NovaWebState;command:Command;busy:boolean}){
 const s=data.settings;
 return <section className="card"><h2>Nova tercihleri</h2><div className="setting-row"><div><h3>Proaktif uygulama içi mesajlar</h3><p>Nova’nın kayıtlı olaylardan konuşma başlatmasına izin ver.</p></div><input aria-label="Proaktif mesajlar" type="checkbox" checked={s.proactive_enabled} disabled={busy} onChange={e=>void command({operation:'settings',settings:{proactive_enabled:e.target.checked}})}/></div><div className="setting-row"><div><h3>Hafıza önerileri</h3><p>Yeni öneriler yine tek tek onayını bekler.</p></div><input aria-label="Hafıza önerileri" type="checkbox" checked={s.memory_enabled} disabled={busy} onChange={e=>void command({operation:'settings',settings:{memory_enabled:e.target.checked}})}/></div><div className="form-grid">{([{key:'proactive_daily_limit',label:'Günlük mesaj sınırı',max:4},{key:'duel_weekly_limit',label:'Haftalık düello teklif sınırı',max:5},{key:'quiet_start',label:'Sessiz saat başlangıcı',max:23},{key:'quiet_end',label:'Sessiz saat bitişi',max:23}] as const).map(f=><label key={f.key}>{f.label}<select value={s[f.key]} disabled={busy} onChange={e=>void command({operation:'settings',settings:{[f.key]:Number(e.target.value)}})}>{Array.from({length:f.max+1},(_,i)=><option key={i} value={i}>{i}</option>)}</select></label>)}</div><p className="subtle">Telefon push bildirimi bu sürümde gönderilmez. Uygulama içi mesaj tercihi ayrıdır. Haftalık güç değişimi en fazla %{number(s.weekly_adaptation_limit*100)}.</p></section>;
}
