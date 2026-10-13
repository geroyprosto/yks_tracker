'use client';
import {useState} from 'react';
import type {NovaJob,NovaMemory,NovaWebState} from '@/lib/nova/web-types';
import {jobStatusLabels as statusLabels} from '@/lib/nova/chat-presentation';
import {number,readNova,type Command} from './view-utils';
import styles from './workspace.module.css';
export function NovaLab({data,command,busy,pairCode,setPairCode}:{data:NovaWebState;command:Command;busy:boolean;pairCode:string;setPairCode:(code:string)=>void}) {
 return<div className={styles.lab}>
    <section className="card"><h2>Yerel bağlantı ve eşleştirme</h2><p className="subtle">Bilgisayarında Bridge’in gösterdiği tek kullanımlık kodu gir. Yalnızca kendi başlattığın eşleştirmeyi onayla.</p><form className={styles.actions} onSubmit={e=>{e.preventDefault();void command({operation:'pair.approve',code:pairCode.trim()}).then(ok=>{if(ok)setPairCode('');});}}><label>Eşleştirme kodu<input value={pairCode} onChange={e=>setPairCode(e.target.value)} maxLength={12} autoComplete="off" required/></label><button className="button secondary" disabled={busy||pairCode.length!==12}>Cihazı onayla</button></form><ul className={styles.list}>{data.devices.map(d=><li key={d.id}><div><strong>{d.name}</strong><p>{d.revoked_at?'Erişimi iptal edildi':d.model_available?'Bildirilen son model durumu: hazır':'Bildirilen son model durumu: hazır değil'} · {d.model??'Model bildirilmedi'}</p><small>Son bağlantı: {d.last_seen_at?new Date(d.last_seen_at).toLocaleString('tr-TR',{timeZone:data.settings.timezone}):'Henüz bağlanmadı'}</small></div>{!d.revoked_at&&<button className="text-button" disabled={busy} onClick={()=>void command({operation:'device.revoke',deviceId:d.id})}>Erişimi iptal et</button>}</li>)}</ul>{!data.devices.length&&<p className="subtle">Henüz eşleştirilmiş cihaz yok.</p>}</section>
    <section className="card"><h2>Nova benim hakkımda ne biliyor?</h2><p className="subtle">Öneriler onayın olmadan hafızaya eklenmez. Unutulan kaynağın yeniden otomatik öğrenilmesi engellenir.</p>{!data.memories.length&&<p className="empty">Henüz bir hafıza yok.</p>}{data.memories.map(memory=><Memory key={memory.id} memory={memory} source={data.messages.find(m=>m.id===memory.source_message_id)?.content} command={command} busy={busy}/>)}</section>
    <Settings data={data} command={command} busy={busy}/>
    <details className="card"><summary>İş kuyruğu ve yanıt süreleri</summary><p className="subtle">{data.jobs.length} yakın iş · Bugün {data.proactiveCount} proaktif mesaj</p><ul className={styles.list}>{data.jobs.map(j=><li key={j.id}><span>{statusLabels[j.status]??j.status} · {j.attempt_count} deneme{j.error&&<small className="error-text"> · {j.error}</small>}</span>{j.generation_metrics&&<JobTiming job={j}/>}{j.status==='FAILED'&&<button className="text-button" disabled={busy} onClick={()=>void command({operation:'retry',jobId:j.id})}>Yeniden dene</button>}</li>)}</ul></details>
    <details className="card"><summary>Simülasyon kaydı ve ham durum</summary><dl className={styles.diagnostics}><dt>Motor sürümü</dt><dd>{data.dayInfo?.engineVersion??data.profile.engine_version}</dd><dt>Gün tohumu</dt><dd>{data.dayInfo?.seed??'Henüz yok'}</dd><dt>Yerel gün</dt><dd>{data.dayInfo?.localDate??'Henüz yok'}</dd><dt>Saat dilimi</dt><dd>{data.settings.timezone}</dd></dl><pre>{JSON.stringify({durum:data.today?.state,nedenler:data.today?.reasonCodes,iliski:data.relationship,olaylar:data.today?.timeline},null,2)}</pre><p className="subtle">Planlanan olayların sonuçları tamamlanmadan gösterilmez. Durum ve ilişki sayıları oyun parametreleridir.</p></details>
   </div>;
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


function JobTiming({job}: {job: NovaJob}) {
 const metrics = job.generation_metrics;
 if (!metrics) return null;
 const timings: [string, number | undefined][] = [
  ['Sırada bekleme', metrics.queueWaitMs], ['Modeli hazırlama', metrics.loadMs],
  ['İlk model tokenı', metrics.firstTokenMs], ['Model üretimi', metrics.totalModelMs],
  ['Ek düzeltme', metrics.repairMs], ['Toplam yanıt hazırlığı', metrics.durationMs],
 ];
 return <details className={styles.jobTiming}><summary>Bu yanıtın süreleri</summary><dl className={styles.diagnostics}>
  {timings.filter(([, value]) => value !== undefined).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{number(value! / 1000)} sn</dd></div>)}
  <div><dt>Üretim denemesi</dt><dd>{metrics.generationAttempts ?? 1}</dd></div>
  {metrics.model && <div><dt>Model</dt><dd>{metrics.model}</dd></div>}
 </dl><p>Sırada bekleme süresi, bilgisayarın kapalı kaldığı zamanı da içerebilir. İlk model tokenı, yapılandırılmış JSON çıktısının başlangıcıdır; ekranda okunabilir yanıtın göründüğü an değildir.</p></details>;
}
