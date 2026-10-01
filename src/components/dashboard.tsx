'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GraduationCap, LayoutDashboard, ListTodo, BookOpen, ChartNoAxesCombined, BarChart3, UsersRound, NotebookPen, Sparkles, Settings2, ChevronRight, Menu, X, ArrowUpRight, CloudCheck, WifiOff, AlertCircle, ShieldCheck } from 'lucide-react';
import {emptyState,type AppState} from '@/lib/domain/types';
import { normalizeTheme,localDate,formatDay,type CommandFn } from '@/lib/ui';
import { createChartPreviewState } from '@/lib/chart-preview';
import { Today } from './today';
import { Tasks } from './tasks';
import { Topics } from './topics';
import { Preferences } from './preferences';
import { TimerPanel } from './timer';
import type { FocusOrigin } from './timer-focus-view';
import { StatisticsWorkspace, type StatisticsView } from './statistics-workspace';
import { FriendsWorkspace } from './friends-workspace';
import { Exams } from './exams';
import { Journal } from './journal';
import { ModalErrorContext } from './modal';
import { Analysis } from './analysis';
import { StudentClassroom } from './classroom/student';
import { Login } from './login';
import {EducationCommandContext} from './course-selector';
import {EducationSetup} from './education-setup';
import {EducationSettings} from './education-settings';
import {SchoolResults} from './school-results';
import type {EducationCommand} from '@/lib/education-ui';
import {levelLabels} from '@/lib/education-ui';

const navigation=[
 {id:'today',label:'Bugün',icon:LayoutDashboard},
 {id:'tasks',label:'Görevlerim',icon:ListTodo},
 {id:'topics',label:'Konularım',icon:BookOpen},
 {id:'exams',label:'Sınav Sonuçları',icon:ChartNoAxesCombined},
 {id:'stats',label:'Çalışma İstatistikleri',icon:BarChart3},
 {id:'friends',label:'Arkadaşlar',icon:UsersRound},
 {id:'journal',label:'Günlüğüm',icon:NotebookPen},
 {id:'analysis',label:'Analiz',icon:Sparkles},
 {id:'settings',label:'Ayarlar',icon:Settings2},
] as const;
export type PageId=typeof navigation[number]['id'];
export function Dashboard(){
 const [state,setState]=useState<AppState|null>(null);
 const [page,setPage]=useState<PageId>('today');
 useEffect(()=>{window.scrollTo({top:0,behavior:'instant'})},[page]);
 const [statisticsView,setStatisticsView]=useState<StatisticsView>('study');
 const [resultView,setResultView]=useState<'school'|'yks'>('school');
 const [personalizing,setPersonalizing]=useState(false);
 const [welcome,setWelcome]=useState(false);
 const [linkedDate,setLinkedDate]=useState<string|null>(null);
 const [settingsInitialTab,setSettingsInitialTab]=useState<'appearance'|'plan'|'connections'>('appearance');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [online,setOnline]=useState(true);
 const [mobileMenu,setMobileMenu]=useState(false);
 const [theme,setTheme]=useState('ocean');
 const [appearance,setAppearance]=useState('dark');
 const [reduced,setReduced]=useState(false);
 const [simple,setSimple]=useState(false);
 const [previewChoice,setPreviewChoice]=useState<boolean|null>(null);
 const [newTask,setNewTask]=useState(false);
 const [timerOpen,setTimerOpen]=useState(false);
 const [timerFocus,setTimerFocus]=useState(false);
 const [timerOrigin,setTimerOrigin]=useState<FocusOrigin|null>(null);
 const timerTrigger=useRef<HTMLElement|null>(null);
 const [offset,setOffset]=useState(0);
 const [today,setToday]=useState('');
 const pending=useRef(false);
 const mutationEpoch=useRef(0);
 const readSequence=useRef(0);
 const preferenceDirty=useRef(false);
 const retries=useRef(new Map<string,string>());
 const installState=useCallback((incoming:AppState)=>{
   const s={...emptyState(incoming.configured),...incoming};
   setOffset(new Date(s.server_now).getTime()-Date.now());
   setState(s);
   if(s.settings&&!preferenceDirty.current){setTheme(normalizeTheme(s.settings.theme)??'ocean');setReduced(s.settings.reduced_motion);setSimple(s.settings.simple_view)}
 },[]);
 const refresh=useCallback(async(allowPending=false)=>{
   const epoch=mutationEpoch.current;
   const sequence=++readSequence.current;
   try{
     const response=await fetch('/api/state',{cache:'no-store'});
     const body=await response.json();
     if(epoch!==mutationEpoch.current||sequence!==readSequence.current||(pending.current&&!allowPending))return;
     if(body.redirect){window.location.assign(body.redirect);return;}
     if(!response.ok&&response.status!==401)throw new Error(body.error?.message??'Veriler yüklenemedi.');
     installState(body);
     setError('');
   }catch(e){setError(e instanceof Error?e.message:'Bağlantı kurulamadı.')}
 },[installState]);
 useEffect(()=>{
   queueMicrotask(()=>setToday(localDate()));
   queueMicrotask(()=>{ const saved=localStorage.getItem('yksim-appearance');if(saved)setAppearance(saved);
   const savedTheme=localStorage.getItem('yksim-theme');const supportedTheme=savedTheme?normalizeTheme(savedTheme):undefined;
   if(supportedTheme){preferenceDirty.current=true;setTheme(supportedTheme);if(savedTheme!==supportedTheme)localStorage.setItem('yksim-theme',supportedTheme)}
   const savedPreview=localStorage.getItem('yksim-chart-preview');if(savedPreview!==null)setPreviewChoice(savedPreview==='true');
   const savedReduced=localStorage.getItem('yksim-reduced');const savedSimple=localStorage.getItem('yksim-simple');
   if(savedReduced!==null||savedSimple!==null)preferenceDirty.current=true;
   setReduced(savedReduced==='true');setSimple(savedSimple==='true'); });
   queueMicrotask(()=>void refresh());
   queueMicrotask(()=>{const query=new URLSearchParams(window.location.search);if(query.get('page')==='friends')setPage('friends');else if(query.get('settings')==='connections'){setSettingsInitialTab('connections');setPage('settings')}});
   const reconnect=()=>{setOnline(navigator.onLine);if(navigator.onLine&&!pending.current)void refresh()};
   window.addEventListener('online',reconnect);window.addEventListener('offline',reconnect);window.addEventListener('focus',reconnect);
   const interval=setInterval(()=>{if(navigator.onLine&&!pending.current&&document.visibilityState==='visible')void refresh()},30000);
   if('serviceWorker' in navigator)void navigator.serviceWorker.register('/sw.js').catch(()=>{});
   return()=>{window.removeEventListener('online',reconnect);window.removeEventListener('offline',reconnect);window.removeEventListener('focus',reconnect);clearInterval(interval)};
 },[refresh]);
 useEffect(()=>{
   const query=window.matchMedia('(prefers-color-scheme: dark)');
   const update=()=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.appearance=theme==='white'?'light':theme==='black'?'dark':appearance==='system'?(query.matches?'dark':'light'):appearance;document.documentElement.dataset.reduced=String(reduced);document.documentElement.dataset.simple=String(simple)};
   update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);
 },[theme,appearance,reduced,simple]);
 const command:CommandFn=async(type,payload)=>{
   if(pending.current)return false;
   if(!state?.authenticated){setError('Kayıt oluşturmak için önce hesap kurulumunu tamamlayıp giriş yapmalısın.');return false}
   if(!navigator.onLine){setError('Şu anda çevrimdışısın. Değişiklik henüz kaydedilmedi; tekrar bağlanınca yeniden dene.');return false}
   pending.current=true;setBusy(true);setError('');
   mutationEpoch.current++;
   const fingerprint=JSON.stringify({type,payload});
   const requestId=retries.current.get(fingerprint)??crypto.randomUUID();
   retries.current.set(fingerprint,requestId);
   try{
     const response=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:requestId,type,payload})});
     const data=await response.json();
     if(!response.ok){if(response.status<500)retries.current.delete(fingerprint);throw new Error(data.error?.message??'İşlem kaydedilemedi.');}
     retries.current.delete(fingerprint);
     if(type==='settings.update'&&payload.theme)preferenceDirty.current=false;
     mutationEpoch.current++;installState(data.state);return true;
   }catch(e){await refresh(true);setError(e instanceof Error?e.message:'İşlem kaydedilemedi.');return false}
   finally{pending.current=false;setBusy(false)}
 };
 const educationCommand:EducationCommand=async(type,payload,explicitRequestId)=>{
   if(pending.current)return false;
   if(!state?.authenticated){setError('Önce öğrenci hesabınla giriş yap.');return false;}
   if(!navigator.onLine){setError('Çevrimdışısın. Seçimlerin henüz kaydedilmedi.');return false;}
   pending.current=true;mutationEpoch.current++;setBusy(true);setError('');
   const fingerprint=JSON.stringify({education:type,payload});
   const requestId=explicitRequestId??retries.current.get(fingerprint)??crypto.randomUUID();
   retries.current.set(fingerprint,requestId);
   try{
     const response=await fetch('/api/education',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:requestId,type,payload})});
     const data=await response.json();
     if(!response.ok){if(response.status<500)retries.current.delete(fingerprint);throw new Error(data.error?.message??'Seçimlerin kaydedilemedi.');}
     retries.current.delete(fingerprint);mutationEpoch.current++;setState(current=>current?{...current,education:data.state}:current);return true;
   }catch(cause){setError(cause instanceof Error?cause.message:'Kayıt tamamlanamadı; aynı işlemi yeniden deneyebilirsin.');return false;}
   finally{pending.current=false;setBusy(false);}
 };
 const go=(p:PageId,settingsTab?:'plan'|'connections')=>{if(p==='stats')setStatisticsView('study');if(p==='settings')setSettingsInitialTab(settingsTab??'appearance');setLinkedDate(null);setPage(p);setMobileMenu(false);const url=new URL(window.location.href);if(p==='friends')url.searchParams.set('page','friends');else url.searchParams.delete('page');if(p==='settings'&&settingsTab==='connections')url.searchParams.set('settings','connections');else url.searchParams.delete('settings');window.history.replaceState(window.history.state,'',url)};
 const goFromReport=(p:PageId,date?:string)=>{go(p);if(date&&(p==='journal'||p==='exams'||p==='stats'))setLinkedDate(date)};
 const openPractice=()=>{go('stats');setStatisticsView('practice')};
 const openExamDateSettings=()=>go('settings','plan');
 const previewEnabled=Boolean(state&&!state.configured&&(previewChoice??true));
 const todayState=state&&previewEnabled?createChartPreviewState(state):state;
 const openTimer=()=>{timerTrigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setTimerFocus(false);setTimerOpen(true)};
 const openFocusTimer=(source:HTMLElement)=>{
   timerTrigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
   const {left,top,width,height}=source.getBoundingClientRect();
   setTimerOrigin({left,top,width,height});setTimerFocus(true);setTimerOpen(true);
 };
 const closeTimer=()=>{
   setTimerOpen(false);setTimerFocus(false);
   requestAnimationFrame(()=>{
     const trigger=timerTrigger.current;
     if(trigger?.isConnected)trigger.focus({preventScroll:true});
     else document.querySelector<HTMLElement>('.focus-card-expand, .floating-timer button')?.focus({preventScroll:true});
   });
 };
 const displayName=state?.settings?.display_name?.trim() || 'Öğrenci';
 const initials=displayName.split(/\s+/).map(part=>Array.from(part)[0]).filter(Boolean).slice(0,2).join('').toLocaleUpperCase('tr-TR');
 const title=page==='today'?'Merhaba, '+displayName+'.':page==='analysis'?'Çalışma Analizi':navigation.find(n=>n.id===page)?.label;
 const descriptions:Record<PageId,string>={today:'Kendi ritminde, hedefe doğru. İşte bugünün çalışma alanı.',tasks:'Planını oluştur, adım adım ilerle.',topics:'Ne öğrendiğini ve bir sonraki adımını gör.',exams:'Sonuçlarını zaman içinde birlikte değerlendirelim.',stats:'Çalışma süreni, çözdüğün soru ve testleri birlikte incele.',friends:'Birlikte çalış, birbirinizi tatlı bir şekilde motive edin.',journal:'Günün düşüncelerine küçük bir alan.',analysis:'Kayıtlarından anlamlı gözlemlere.',settings:'Çalışma alanını kendine göre düzenle.'};
 const profile=state?.education?.profile;
 const yksEnabled=profile?.yks_goal??true;
 const schoolEnabled=Boolean(profile&&(profile.education_level!=='graduate'||state?.education?.courses.some(course=>course.context==='school')||state?.education?.results.length));
 const visibleNavigation=navigation.filter(item=>item.id==='topics'?yksEnabled:item.id==='tasks'?profile?.modules.tasks??true:item.id==='exams'?profile?.modules.results??true:item.id==='stats'?profile?.modules.statistics??true:item.id==='journal'?profile?.modules.journal??true:true);
 if(!state)return <main className="login-page">{error?<div role="alert" className="notice error"><AlertCircle size={18}/><span>{error}</span><button className="button secondary" onClick={()=>void refresh()}>Tekrar dene</button></div>:<p className="loading" role="status">Çalışma alanı yükleniyor…</p>}</main>;
 if(state.configured&&!state.authenticated)return <Login/>;
 if(state.education?.needs_onboarding)return <EducationCommandContext value={educationCommand}><main style={{maxWidth:1200,margin:'auto',padding:'24px'}}><StudentClassroom state={state}/>{error&&<p role="alert" className="notice error">{error}</p>}<EducationSetup education={state.education} command={educationCommand} busy={busy} onDone={()=>{setPage('today');setWelcome(true);}}/></main></EducationCommandContext>;
 return <EducationCommandContext value={educationCommand}><ModalErrorContext value={error}><div className="app-shell">
   <a className="skip-link" href="#main">İçeriğe geç</a>
   <aside className={'sidebar '+(mobileMenu?'is-open':'')}>
     <div className="brand"><span className="brand-mark">y</span><span>YKSim<span className="brand-dot">.</span></span><button className="mobile-only icon-button" onClick={e=>{e.preventDefault();setMobileMenu(false)}} aria-label="Menüyü kapat"><X size={20}/></button></div>
     <div className="workspace-label">KİŞİSEL ÇALIŞMA ALANIN</div>
     <nav aria-label="Ana gezinme">{visibleNavigation.map(({id,label,icon:Icon})=><button key={id} className={'nav-item '+(page===id?'active':'')} aria-current={page===id?'page':undefined} onClick={()=>go(id)}><Icon size={19}/><span>{label}</span>{page===id&&<span className="nav-dot"/>}</button>)}</nav>
     <div className="sidebar-bottom"><div className="exam-target"><div className="target-icon"><BookOpen size={20}/></div><div><strong>{yksEnabled?'YKS '+(state.settings?.exam_year??new Date().getFullYear()):profile?levelLabels[profile.education_level]:'Çalışma alanım'}</strong><span>{state.education?.terms.find(term=>term.id===profile?.active_term_id)?.name??'Hedefine doğru'}</span></div></div><button className="profile-button" onClick={()=>go('settings')}><span className="avatar" aria-hidden="true">{initials}</span><span><strong>{displayName}</strong><small>Kişisel hesap</small></span><Settings2 size={16}/></button></div>
   </aside>
   {mobileMenu&&<button className="menu-scrim" aria-label="Menüyü kapat" onClick={()=>setMobileMenu(false)}/>}
   <div className="main-shell">
     <header className="topbar"><div className="breadcrumbs"><button className="mobile-only icon-button" aria-label="Menüyü aç" onClick={()=>setMobileMenu(true)}><Menu size={22}/></button><span>Çalışma alanım</span><ChevronRight size={14}/><strong>{navigation.find(n=>n.id===page)?.label}</strong></div><div className="topbar-right"><span className={'sync-status '+(!online?'warning':'')}>{!online?<WifiOff size={15}/>:<CloudCheck size={15}/>}<span>{!online?'Çevrimdışı':busy?'Kaydediliyor…':state?.authenticated?'Hesabın güncel':'Kurulum bekliyor'}</span></span><span className="avatar small" aria-hidden="true">{initials}</span></div></header>
     <main id="main" data-page={page}>
       {state?.authenticated&&<StudentClassroom state={state}/>}
       <div className="page-heading"><div><p className="eyebrow">{page==='today'?(today?formatDay(today):'Bugün'):'YKSim / '+navigation.find(n=>n.id===page)?.label}</p><h1>{title}</h1><p>{descriptions[page]}</p></div>{page==='today'&&(profile?.modules.tasks??true)&&<button className="button secondary" onClick={()=>{setPage('tasks');setNewTask(true)}}><ListTodo size={17}/>Günü planla<ArrowUpRight size={16}/></button>}</div>
       {!state?.configured&&<div className="setup-banner"><ShieldCheck size={22}/><div><strong>Kişisel alanın kurulum için hazır.</strong><p>Veritabanı bağlantısı henüz kurulmadı. Kayıtların oluşmadan önce hesabını bağlamalısın.</p></div><button className="text-button" onClick={()=>go('settings')}>Kurulum bilgileri<ChevronRight size={16}/></button></div>}
       {state&&!state.configured&&(page==='today'||page==='stats'||page==='exams')&&<div className="preview-banner" role="status"><ChartNoAxesCombined size={21}/><div><strong>{previewEnabled?'Örnek grafik önizlemesi açık.':'Örnek grafik önizlemesi kapalı.'}</strong><p>{previewEnabled?'Örnek görevler ve grafikler yalnızca önizleme içindir; gerçek kayıtların değişmez.':'Gerçek boş görünümü izliyorsun. İstersen örnek grafikleri aç.'}</p></div><button className="button secondary" aria-pressed={previewEnabled} onClick={()=>{const next=!previewEnabled;setPreviewChoice(next);localStorage.setItem('yksim-chart-preview',String(next))}}>{previewEnabled?'Gerçek boş görünümü göster':'Örnekleri göster'}</button></div>}
       {error&&<div role="alert" className="notice error"><AlertCircle size={18}/><span>{error}</span><button className="icon-button" aria-label="Uyarıyı kapat" onClick={()=>setError('')}><X size={16}/></button></div>}
       {page==='today'&&(!profile||welcome)&&<div className="setup-banner"><GraduationCap size={22}/><div><strong>{welcome?'Çalışma alanın hazır.':'Okul ve üniversite derslerine de yer aç.'}</strong><p>{welcome?'İlk görevini oluşturabilir, dersini seçip sayacı başlatabilir veya sınav sonuçlarını girebilirsin.':'YKS geçmişini koruyarak öğrenci profilini ve derslerini kişiselleştir.'}</p></div><button className="text-button" onClick={()=>{setPersonalizing(true);go('settings');}}>Öğrenci profilim<ChevronRight size={16}/></button>{welcome&&<button className="icon-button" aria-label="Karşılama bilgisini kapat" onClick={()=>setWelcome(false)}><X size={16}/></button>}</div>}
       {todayState&&page==='today'&&<Today state={todayState} preview={previewEnabled} command={command} busy={busy} offset={offset} go={go} openTimer={openTimer} expandTimer={openFocusTimer} addTask={()=>{go('tasks');setNewTask(true)}} openExamDateSettings={openExamDateSettings} openPractice={openPractice}/>}
       {state&&page==='tasks'&&<Tasks state={state} command={command} busy={busy} requestNew={newTask} onNewHandled={()=>setNewTask(false)}/>}
       {state&&page==='topics'&&<Topics state={state} command={command} busy={busy}/>}
       {state&&page==='settings'&&<><div className="settings-tabs"><button aria-pressed={personalizing} className={personalizing?'active':''} onClick={()=>setPersonalizing(true)}>Öğrenci alanım</button><button aria-pressed={!personalizing} className={!personalizing?'active':''} onClick={()=>setPersonalizing(false)}>Genel ayarlar</button></div>{personalizing?<EducationSettings state={state} command={educationCommand} busy={busy} onSaved={()=>{setWelcome(true);go('today');}}/>:<Preferences state={state} command={command} busy={busy} initialTab={settingsInitialTab} theme={theme} appearance={appearance} reduced={reduced} simple={simple} setTheme={v=>{preferenceDirty.current=true;setTheme(v);localStorage.setItem('yksim-theme',v)}} setAppearance={v=>{setAppearance(v);localStorage.setItem('yksim-appearance',v)}} setReduced={v=>{preferenceDirty.current=true;setReduced(v);localStorage.setItem('yksim-reduced',String(v))}} setSimple={v=>{preferenceDirty.current=true;setSimple(v);localStorage.setItem('yksim-simple',String(v))}}/>}</>}
       {state&&page==='exams'&&<>{schoolEnabled&&yksEnabled&&<div className="settings-tabs"><button className={resultView==='school'?'active':''} onClick={()=>setResultView('school')}>Ders Sınavları</button><button className={resultView==='yks'?'active':''} onClick={()=>setResultView('yks')}>YKS Denemeleri</button></div>}{state.education&&schoolEnabled&&(!yksEnabled||resultView==='school')?<SchoolResults education={state.education} command={educationCommand} busy={busy}/>:<Exams key={linkedDate??'all'} initialDate={linkedDate??undefined} state={previewEnabled&&todayState?todayState:state} command={command} busy={busy} preview={previewEnabled}/>}</>}
       {state&&page==='journal'&&<Journal key={linkedDate??'today'} initialDate={linkedDate??undefined} state={state} command={command} busy={busy}/>}
       {state&&page==='analysis'&&<Analysis onOpenDay={date=>goFromReport('stats',date)} onOpenTasks={()=>go('tasks')} onOpenJournal={()=>go('journal')} journalAnalysisEnabled={state.settings?.journal_analysis_enabled===true}/>}
       {state&&page==='stats'&&<StatisticsWorkspace initialDate={linkedDate} state={state} practiceState={previewEnabled&&todayState?todayState:state} command={command} busy={busy} preview={previewEnabled} go={goFromReport} view={statisticsView} onViewChange={setStatisticsView}/>}
       {state&&page==='friends'&&<FriendsWorkspace/>}
       <footer className="page-footer"><span>Her gün aynı olmak zorunda değil.</span><a href="/classroom">Hesap ve sınıf alanı</a><span>YKSim <span className="subtle">·</span> Kişisel çalışma alanın</span></footer>
     </main>
   </div>
   <nav className="bottom-nav" aria-label="Mobil gezinme">{visibleNavigation.slice(0,3).map(({id,label,icon:Icon})=><button key={id} onClick={()=>go(id)} aria-current={page===id?'page':undefined}><Icon size={21}/>{label}</button>)}<button onClick={()=>go('settings')} aria-current={page==='settings'?'page':undefined}><Settings2 size={21}/>Ayarlar</button></nav>
   {state&&((profile?.modules.timer??true)||state.sessions.some(session=>session.status!=='finished'))&&<TimerPanel state={state} command={command} busy={busy} offset={offset} expanded={timerOpen} focus={timerFocus} origin={timerOrigin} onFocus={openFocusTimer} onClose={closeTimer}/>}
 </div></ModalErrorContext></EducationCommandContext>
}
