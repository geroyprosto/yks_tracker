'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { ModalErrorContext,ModalRetryContext } from './modal';
import { Analysis } from './analysis';
import { StudentClassroom } from './classroom/student';
import { Login } from './login';
import {EducationCommandContext} from './course-selector';
import {EducationSetup} from './education-setup';
import {EducationSettings} from './education-settings';
import {SchoolResults} from './school-results';
import type {EducationCommand} from '@/lib/education-ui';
import {levelLabels} from '@/lib/education-ui';
import {createSaveMetrics,type SaveMeasurement} from '@/lib/save-metrics';
import {createStudyCommandQueue,CommandRequestError} from '@/lib/study-command-queue';
import {useStudyRealtime} from '@/lib/realtime-client';

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
 const [queuedJobs,setQueuedJobs]=useState(0);
 const [queuePaused,setQueuePaused]=useState(false);
 const [queuedEducation,setQueuedEducation]=useState(false);
 const [reconciling,setReconciling]=useState(false);
 const [error,setError]=useState('');
 const [viewError,setViewError]=useState('');
 const [canRetryView,setCanRetryView]=useState(false);
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
 const commandQueue=useRef<ReturnType<typeof createStudyCommandQueue>|null>(null);
 const pendingForms=useRef(new Map<HTMLFormElement|string,Promise<boolean>>());
 const queueError=useRef(false);
 const dirtyRefresh=useRef(false);
 useEffect(()=>()=>commandQueue.current?.dispose(),[]);
 useEffect(()=>{
   if(!queuedJobs)return;
   const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
   window.addEventListener('beforeunload',warn);
   return()=>window.removeEventListener('beforeunload',warn);
 },[queuedJobs]);
 const mutationEpoch=useRef(0);
 const readSequence=useRef(0);
 const stateRead=useRef<{epoch:number;allowPending:boolean;promise:Promise<AppState|null>}|null>(null);
 const reconciliationTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const cancelQueuedReconciliation=useCallback(()=>{
   if(reconciliationTimer.current!==null)clearTimeout(reconciliationTimer.current);
   reconciliationTimer.current=null;
 },[]);
 const expireSession=useCallback(()=>{
   commandQueue.current?.dispose();commandQueue.current=null;pendingForms.current.clear();
   cancelQueuedReconciliation();mutationEpoch.current++;readSequence.current++;
   pending.current=false;dirtyRefresh.current=false;queueError.current=false;
   setBusy(false);setQueuedJobs(0);setQueuePaused(false);setQueuedEducation(false);setReconciling(false);setError('');setViewError('');setCanRetryView(false);
   setState(emptyState(true));
 },[cancelQueuedReconciliation]);
 useEffect(()=>cancelQueuedReconciliation,[cancelQueuedReconciliation]);
 const preferenceDirty=useRef(false);
 const saveMetrics=useRef(createSaveMetrics());
 const metricsRoot=useRef<HTMLDivElement|null>(null);
 const pendingVisibility=useRef<{measurement:SaveMeasurement;previous:AppState;source:'optimistic'|'authoritative'}|null>(null);
 const publishMetrics=useCallback(()=>{
   metricsRoot.current?.setAttribute('data-save-metrics',saveMetrics.current.serialize());
 },[]);
 useLayoutEffect(()=>{
   const visible=pendingVisibility.current;
   if(visible&&state&&state!==visible.previous){
     visible.measurement.visible(visible.source);
     pendingVisibility.current=null;
   }
   // This is the React DOM commit, before paint; no extra render or request is needed.
   publishMetrics();
 },[state,publishMetrics]);
 const installState=useCallback((incoming:AppState)=>{
   const s={...emptyState(incoming.configured),...incoming};
   setOffset(new Date(s.server_now).getTime()-Date.now());
   setState(commandQueue.current?commandQueue.current.install(s):s);
   if(s.settings&&!preferenceDirty.current){setTheme(normalizeTheme(s.settings.theme)??'ocean');setReduced(s.settings.reduced_motion);setSimple(s.settings.simple_view)}
   return s;
 },[]);
 const refresh=useCallback((allowPending=false):Promise<AppState|null>=>{
   const epoch=mutationEpoch.current;
   if(pending.current&&!allowPending)return Promise.resolve(null);
   if(stateRead.current?.epoch===epoch&&stateRead.current.allowPending===allowPending)return stateRead.current.promise;
   const sequence=++readSequence.current;
   const current=()=>epoch===mutationEpoch.current&&sequence===readSequence.current&&(!pending.current||allowPending);
   const promise=(async()=>{
     setReconciling(true);setViewError('');setCanRetryView(false);
     for(let attempt=0;attempt<3;attempt++){
       if(!current())return null;
       let retryable=true;
       try{
         const response=await fetch('/api/state',{cache:'no-store'});
         retryable=response.status>=500;
         const body=await response.json();
         if(!current())return null;
         if(body.redirect){window.location.assign(body.redirect);return null;}
         if(!response.ok&&response.status!==401)throw new Error(body.error?.message??'Veriler yüklenemedi.');
         const latest=installState(body);
         setReconciling(false);setViewError('');setCanRetryView(false);
         if(!queueError.current)setError('');
         return latest;
       }catch(e){
         if(!current())return null;
         // Retry only this read. A confirmed write must never be sent again to
         // repair its display, and a newer mutation invalidates the whole read.
         if(retryable&&attempt<2){await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));continue;}
         setReconciling(false);setCanRetryView(retryable);
         setViewError(retryable?'Görünüm güncellenemedi. Yeniden deneyebilirsin.':e instanceof Error?e.message:'Veriler yüklenemedi.');
         return null;
       }
     }
     return null;
   })();
   stateRead.current={epoch,allowPending,promise};
   void promise.finally(()=>{if(stateRead.current?.promise===promise)stateRead.current=null;});
   return promise;
 },[installState]);
 const reconcileSaved=useCallback((measurement?:SaveMeasurement)=>{
   cancelQueuedReconciliation();
   const epoch=mutationEpoch.current;
   setReconciling(true);
   const reconcile=()=>{
     reconciliationTimer.current=null;
     // A later command cancels this read. Keep the epoch guard even before fetch
     // so an older queued reconciliation never adopts a newer mutation's state.
     if(pending.current||epoch!==mutationEpoch.current)return;
     const finishRefresh=measurement?.refresh();
     void refresh().then(latest=>{
       finishRefresh?.(Boolean(latest));publishMetrics();
     });
   };
   reconciliationTimer.current=setTimeout(reconcile,500);
 },[refresh,publishMetrics,cancelQueuedReconciliation]);
 const requestStateRefresh=useCallback(()=>{
   if(pending.current){dirtyRefresh.current=true;return;}
   const read=stateRead.current;
   if(read&&read.epoch===mutationEpoch.current){
     // Dirty hints may describe changes made after an active read's snapshot.
     // Coalesce them into one trailing read once the current read finishes.
     dirtyRefresh.current=true;
     void read.promise.then(()=>{
       if(pending.current||read.epoch!==mutationEpoch.current||!dirtyRefresh.current)return;
       dirtyRefresh.current=false;reconcileSaved();
     });
     return;
   }
   reconcileSaved();
 },[reconcileSaved]);
 const realtime=useStudyRealtime({enabled:Boolean(state?.authenticated&&state?.configured),onDirty:requestStateRefresh,onReconnect:requestStateRefresh});
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
   const reconnect=()=>{setOnline(navigator.onLine);if(navigator.onLine&&!pending.current&&reconciliationTimer.current===null)void refresh()};
   window.addEventListener('online',reconnect);window.addEventListener('offline',reconnect);window.addEventListener('focus',reconnect);
   const interval=setInterval(()=>{if(navigator.onLine&&!pending.current&&reconciliationTimer.current===null&&document.visibilityState==='visible')void refresh()},30000);
   if('serviceWorker' in navigator)void navigator.serviceWorker.register('/sw.js').catch(()=>{});
   return()=>{window.removeEventListener('online',reconnect);window.removeEventListener('offline',reconnect);window.removeEventListener('focus',reconnect);clearInterval(interval)};
 },[refresh]);
 useEffect(()=>{
   const query=window.matchMedia('(prefers-color-scheme: dark)');
   const update=()=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.appearance=theme==='white'?'light':theme==='black'?'dark':appearance==='system'?(query.matches?'dark':'light'):appearance;document.documentElement.dataset.reduced=String(reduced);document.documentElement.dataset.simple=String(simple)};
   update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);
 },[theme,appearance,reduced,simple]);
 const command:CommandFn=async(type,payload,options)=>{
   const enteredAt=performance.now();
   if(!state?.authenticated){setError('Kayıt oluşturmak için önce hesap kurulumunu tamamlayıp giriş yapmalısın.');return false}
   if(!navigator.onLine){setError('Şu anda çevrimdışısın. Değişiklik henüz kaydedilmedi; tekrar bağlanınca yeniden dene.');return false}
   const durableForm=type.endsWith('.create')||['exam.update','practice.update','journal.update','settings.update','plan.update',
     'education.profile.save','education.draft.save','education.results.batch'].includes(type)||(type==='task.update'&&'title' in payload);
   const submittingForm=document.activeElement instanceof HTMLElement?document.activeElement.closest('form'):null;
   const formKey=durableForm?(submittingForm??JSON.stringify({type,payload})):null;
   // A second submit of the same open form observes its existing completion.
   // Direct timer/task controls always enqueue distinct intents and request IDs.
   if(formKey&&pendingForms.current.has(formKey))return pendingForms.current.get(formKey)!;
   const now=new Date(Date.now()+offset).toISOString();
   const requestId=crypto.randomUUID();
   if(!pending.current||Boolean(commandQueue.current?.count)){
     if(commandQueue.current?.paused)return false;
     if(!commandQueue.current)commandQueue.current=createStudyCommandQueue(state,{
       send:async(command,minimal,measurement)=>{
         const education=command.type.startsWith('education.');
         const response=await fetch(education?'/api/education':'/api/command',{method:'POST',headers:{'Content-Type':'application/json',...(minimal?{Prefer:'return=minimal'}:{})},
           body:JSON.stringify(education?{...command,type:command.type.slice(10)}:command),...(command.type==='timer.finish'?{keepalive:true}:{})});
         measurement?.response(response.status,response.headers.get('server-timing'));
         const data=await response.json();const receivedAt=performance.now();
         if(response.status===401)expireSession();
         if(!response.ok)throw new CommandRequestError(data.error?.message??'İşlem kaydedilemedi.',response.status);
         return education?{...data.result,state:data.state?{...commandQueue.current!.confirmed,education:data.state}:undefined,partialState:true,receivedAt}:{...data,receivedAt};
       },
       recover:async()=>{
         try{const response=await fetch('/api/state',{cache:'no-store'});const latest=await response.json();
           if(latest.redirect){window.location.assign(latest.redirect);return null;}
           if(response.status===401){expireSession();return null;}
           return response.ok?{...emptyState(true),...latest}:null;
         }catch{return null;}
       },
       change:(visible,count,paused)=>{
         pending.current=count>0;setBusy(count>0);setQueuedJobs(count);setQueuePaused(paused);setQueuedEducation(commandQueue.current?.hasPendingEducation??false);setState(visible);publishMetrics();
       },
       error:message=>{queueError.current=true;setError(message);publishMetrics();},
       committed:(latest,partial)=>{mutationEpoch.current++;if(!partial){setOffset(Date.parse(latest.server_now)-Date.now());setViewError('');setCanRetryView(false);}
         if(latest.settings&&!preferenceDirty.current){setTheme(normalizeTheme(latest.settings.theme)??'ocean');setReduced(latest.settings.reduced_motion);setSimple(latest.settings.simple_view);}
       },
       settled:(measurement,needsRefresh)=>{
         mutationEpoch.current++;
         if(needsRefresh||dirtyRefresh.current){dirtyRefresh.current=false;reconcileSaved(measurement);}
         else setReconciling(false);
       },
     });
     cancelQueuedReconciliation();mutationEpoch.current++;queueError.current=false;setError('');setReconciling(false);
     const previous=commandQueue.current.state;
     const measurement=saveMetrics.current.start(type,enteredAt);
     const done=commandQueue.current.enqueue({request_id:requestId,type,payload},now,measurement);
     if(!done)return false;
     if(formKey){pendingForms.current.set(formKey,done);void done.finally(()=>{if(pendingForms.current.get(formKey)===done)pendingForms.current.delete(formKey);});}
     if(commandQueue.current.state!==previous)pendingVisibility.current={measurement,previous,source:'optimistic'};
     publishMetrics();
     // A task form may close on local acceptance while retaining its durable
     // result for draft recovery. Pending/retry status stays with the queue.
     options?.onAccepted?.();
     // Direct controls report local acceptance. Forms keep their durable result.
     const immediate=type.startsWith('timer.')||type==='task.delete'||(type==='task.update'&&!('title' in payload));
     return immediate?true:done;
   }
   return false;
 };
 const educationCommand:EducationCommand=(type,payload)=>command('education.'+type,payload);
 const retryQueue=()=>{queueError.current=false;setError('');void commandQueue.current?.retry();};
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
 const instantBusy=busy&&(queuedJobs===0||queuePaused);
 const initials=displayName.split(/\s+/).map(part=>Array.from(part)[0]).filter(Boolean).slice(0,2).join('').toLocaleUpperCase('tr-TR');
 const title=page==='today'?'Merhaba, '+displayName+'.':page==='analysis'?'Çalışma Analizi':navigation.find(n=>n.id===page)?.label;
 const descriptions:Record<PageId,string>={today:'Kendi ritminde, hedefe doğru. İşte bugünün çalışma alanı.',tasks:'Planını oluştur, adım adım ilerle.',topics:'Ne öğrendiğini ve bir sonraki adımını gör.',exams:'Sonuçlarını zaman içinde birlikte değerlendirelim.',stats:'Çalışma süreni, çözdüğün soru ve testleri birlikte incele.',friends:'Birlikte çalış, birbirinizi tatlı bir şekilde motive edin.',journal:'Günün düşüncelerine küçük bir alan.',analysis:'Kayıtlarından anlamlı gözlemlere.',settings:'Çalışma alanını kendine göre düzenle.'};
 const profile=state?.education?.profile;
 const yksEnabled=profile?.yks_goal??true;
 const schoolEnabled=Boolean(profile&&(profile.education_level!=='graduate'||state?.education?.courses.some(course=>course.context==='school')||state?.education?.results.length));
 const visibleNavigation=navigation.filter(item=>item.id==='topics'?yksEnabled:item.id==='tasks'?profile?.modules.tasks??true:item.id==='exams'?profile?.modules.results??true:item.id==='stats'?profile?.modules.statistics??true:item.id==='journal'?profile?.modules.journal??true:true);
 const viewNotice=viewError&&<div role="alert" className="notice error"><AlertCircle size={18}/><span>{viewError}</span>{canRetryView&&<button className="button secondary" disabled={reconciling||busy} onClick={()=>void refresh()}>Görünümü yeniden dene</button>}</div>;
 if(!state)return <main className="login-page">{viewError||error?<div role="alert" className="notice error"><AlertCircle size={18}/><span>{viewError||error}</span><button className="button secondary" disabled={reconciling} onClick={()=>void refresh()}>Tekrar dene</button></div>:<p className="loading" role="status">Çalışma alanı yükleniyor…</p>}</main>;
 if(state.configured&&!state.authenticated)return <Login/>;
 if(state.education?.needs_onboarding)return <EducationCommandContext value={educationCommand}><main style={{maxWidth:1200,margin:'auto',padding:'24px'}}><StudentClassroom state={state}/>{error&&<div role="alert" className="notice error">{error}{queuePaused&&<button className="button secondary" onClick={retryQueue}>Bekleyen kayıtları yeniden dene</button>}</div>}{viewNotice}<EducationSetup education={state.education} command={educationCommand} busy={busy} onDone={()=>{setPage('today');setWelcome(true);}}/></main></EducationCommandContext>;
 return <EducationCommandContext value={educationCommand}><ModalErrorContext value={error}><ModalRetryContext value={queuePaused?retryQueue:null}><div className="app-shell" ref={metricsRoot} data-save-metrics="[]" data-realtime-status={realtime.status}>
   <a className="skip-link" href="#main">İçeriğe geç</a>
   <aside className={'sidebar '+(mobileMenu?'is-open':'')}>
     <div className="brand"><span className="brand-mark">y</span><span>YKSim<span className="brand-dot">.</span></span><button className="mobile-only icon-button" onClick={e=>{e.preventDefault();setMobileMenu(false)}} aria-label="Menüyü kapat"><X size={20}/></button></div>
     <div className="workspace-label">KİŞİSEL ÇALIŞMA ALANIN</div>
     <nav aria-label="Ana gezinme">{visibleNavigation.map(({id,label,icon:Icon})=><button key={id} className={'nav-item '+(page===id?'active':'')} aria-current={page===id?'page':undefined} onClick={()=>go(id)}><Icon size={19}/><span>{label}</span>{page===id&&<span className="nav-dot"/>}</button>)}</nav>
     <div className="sidebar-bottom"><div className="exam-target"><div className="target-icon"><BookOpen size={20}/></div><div><strong>{yksEnabled?'YKS '+(state.settings?.exam_year??new Date().getFullYear()):profile?levelLabels[profile.education_level]:'Çalışma alanım'}</strong><span>{state.education?.terms.find(term=>term.id===profile?.active_term_id)?.name??'Hedefine doğru'}</span></div></div><button className="profile-button" onClick={()=>go('settings')}><span className="avatar" aria-hidden="true">{initials}</span><span><strong>{displayName}</strong><small>Kişisel hesap</small></span><Settings2 size={16}/></button></div>
   </aside>
   {mobileMenu&&<button className="menu-scrim" aria-label="Menüyü kapat" onClick={()=>setMobileMenu(false)}/>}
   <div className="main-shell">
     <header className="topbar"><div className="breadcrumbs"><button className="mobile-only icon-button" aria-label="Menüyü aç" onClick={()=>setMobileMenu(true)}><Menu size={22}/></button><span>Çalışma alanım</span><ChevronRight size={14}/><strong>{navigation.find(n=>n.id===page)?.label}</strong></div><div className="topbar-right"><span className={'sync-status '+(!online?'warning':'')} aria-live="polite" data-pending-commands={queuedJobs}>{!online?<WifiOff size={15}/>:<CloudCheck size={15}/>}<span>{!online?'Çevrimdışı':queuePaused?'Kayıtlar bekliyor':reconciling?'Görünüm güncelleniyor…':busy?queuedJobs?`Kaydediliyor… ${queuedJobs} işlem`:'Kaydediliyor…':viewError?'Görünüm güncel değil':state?.authenticated?'Hesabın güncel':'Kurulum bekliyor'}</span></span><span className="avatar small" aria-hidden="true">{initials}</span></div></header>
     <main id="main" data-page={page}>
       {state?.authenticated&&<StudentClassroom state={state}/>}
       <div className="page-heading"><div><p className="eyebrow">{page==='today'?(today?formatDay(today):'Bugün'):'YKSim / '+navigation.find(n=>n.id===page)?.label}</p><h1>{title}</h1><p>{descriptions[page]}</p></div>{page==='today'&&(profile?.modules.tasks??true)&&<button className="button secondary" onClick={()=>{setPage('tasks');setNewTask(true)}}><ListTodo size={17}/>Günü planla<ArrowUpRight size={16}/></button>}</div>
       {!state?.configured&&<div className="setup-banner"><ShieldCheck size={22}/><div><strong>Kişisel alanın kurulum için hazır.</strong><p>Veritabanı bağlantısı henüz kurulmadı. Kayıtların oluşmadan önce hesabını bağlamalısın.</p></div><button className="text-button" onClick={()=>go('settings')}>Kurulum bilgileri<ChevronRight size={16}/></button></div>}
       {state&&!state.configured&&(page==='today'||page==='stats'||page==='exams')&&<div className="preview-banner" role="status"><ChartNoAxesCombined size={21}/><div><strong>{previewEnabled?'Örnek grafik önizlemesi açık.':'Örnek grafik önizlemesi kapalı.'}</strong><p>{previewEnabled?'Örnek görevler ve grafikler yalnızca önizleme içindir; gerçek kayıtların değişmez.':'Gerçek boş görünümü izliyorsun. İstersen örnek grafikleri aç.'}</p></div><button className="button secondary" aria-pressed={previewEnabled} onClick={()=>{const next=!previewEnabled;setPreviewChoice(next);localStorage.setItem('yksim-chart-preview',String(next))}}>{previewEnabled?'Gerçek boş görünümü göster':'Örnekleri göster'}</button></div>}
       {error&&<div role="alert" className="notice error"><AlertCircle size={18}/><span>{error}</span>{queuePaused&&<button className="button secondary" onClick={retryQueue}>Bekleyen kayıtları yeniden dene</button>}{!queuePaused&&<button className="icon-button" aria-label="Uyarıyı kapat" onClick={()=>setError('')}><X size={16}/></button>}</div>}
       {viewNotice}
       {page==='today'&&(!profile||welcome)&&<div className="setup-banner"><GraduationCap size={22}/><div><strong>{welcome?'Çalışma alanın hazır.':'Okul ve üniversite derslerine de yer aç.'}</strong><p>{welcome?'İlk görevini oluşturabilir, dersini seçip sayacı başlatabilir veya sınav sonuçlarını girebilirsin.':'YKS geçmişini koruyarak öğrenci profilini ve derslerini kişiselleştir.'}</p></div><button className="text-button" onClick={()=>{setPersonalizing(true);go('settings');}}>Öğrenci profilim<ChevronRight size={16}/></button>{welcome&&<button className="icon-button" aria-label="Karşılama bilgisini kapat" onClick={()=>setWelcome(false)}><X size={16}/></button>}</div>}
       {todayState&&page==='today'&&<Today state={todayState} preview={previewEnabled} command={command} busy={instantBusy} offset={offset} go={go} openTimer={openTimer} expandTimer={openFocusTimer} addTask={()=>{go('tasks');setNewTask(true)}} openExamDateSettings={openExamDateSettings} openPractice={openPractice}/>}
       {state&&page==='tasks'&&<Tasks state={state} command={command} busy={instantBusy} requestNew={newTask} onNewHandled={()=>setNewTask(false)}/>}
       {state&&page==='topics'&&<Topics state={state} command={command} busy={instantBusy}/>}
       {state&&page==='settings'&&<><div className="settings-tabs"><button aria-pressed={personalizing} className={personalizing?'active':''} onClick={()=>setPersonalizing(true)}>Öğrenci alanım</button><button aria-pressed={!personalizing} className={!personalizing?'active':''} onClick={()=>setPersonalizing(false)}>Genel ayarlar</button></div>{personalizing?<EducationSettings state={state} command={educationCommand} busy={instantBusy||queuedEducation} onSaved={()=>{setWelcome(true);go('today');}}/>:<Preferences state={state} command={command} busy={instantBusy} initialTab={settingsInitialTab} theme={theme} appearance={appearance} reduced={reduced} simple={simple} setTheme={v=>{preferenceDirty.current=true;setTheme(v);localStorage.setItem('yksim-theme',v)}} setAppearance={v=>{setAppearance(v);localStorage.setItem('yksim-appearance',v)}} setReduced={v=>{preferenceDirty.current=true;setReduced(v);localStorage.setItem('yksim-reduced',String(v))}} setSimple={v=>{preferenceDirty.current=true;setSimple(v);localStorage.setItem('yksim-simple',String(v))}}/>}</>}
       {state&&page==='exams'&&<>{schoolEnabled&&yksEnabled&&<div className="settings-tabs"><button className={resultView==='school'?'active':''} onClick={()=>setResultView('school')}>Ders Sınavları</button><button className={resultView==='yks'?'active':''} onClick={()=>setResultView('yks')}>YKS Denemeleri</button></div>}{state.education&&schoolEnabled&&(!yksEnabled||resultView==='school')?<SchoolResults education={state.education} command={educationCommand} busy={instantBusy||queuedEducation}/>:<Exams key={linkedDate??'all'} initialDate={linkedDate??undefined} state={previewEnabled&&todayState?todayState:state} command={command} busy={instantBusy} preview={previewEnabled}/>}</>}
       {state&&page==='journal'&&<Journal key={linkedDate??'today'} initialDate={linkedDate??undefined} state={state} command={command} busy={instantBusy}/>}
       {state&&page==='analysis'&&<Analysis onOpenDay={date=>goFromReport('stats',date)} onOpenTasks={()=>go('tasks')} onOpenJournal={()=>go('journal')} journalAnalysisEnabled={state.settings?.journal_analysis_enabled===true}/>}
       {state&&page==='stats'&&<StatisticsWorkspace initialDate={linkedDate} state={state} practiceState={previewEnabled&&todayState?todayState:state} command={command} busy={instantBusy} preview={previewEnabled} go={goFromReport} view={statisticsView} onViewChange={setStatisticsView}/>}
       {state&&page==='friends'&&<FriendsWorkspace/>}
       <footer className="page-footer"><span>Her gün aynı olmak zorunda değil.</span><a href="/classroom">Hesap ve sınıf alanı</a><span>YKSim <span className="subtle">·</span> Kişisel çalışma alanın</span></footer>
     </main>
   </div>
   <nav className="bottom-nav" aria-label="Mobil gezinme">{visibleNavigation.slice(0,3).map(({id,label,icon:Icon})=><button key={id} onClick={()=>go(id)} aria-current={page===id?'page':undefined}><Icon size={21}/>{label}</button>)}<button onClick={()=>go('settings')} aria-current={page==='settings'?'page':undefined}><Settings2 size={21}/>Ayarlar</button></nav>
   {state&&((profile?.modules.timer??true)||state.sessions.some(session=>session.status!=='finished'))&&<TimerPanel state={state} command={command} busy={instantBusy} offset={offset} expanded={timerOpen} focus={timerFocus} origin={timerOrigin} onFocus={openFocusTimer} onClose={closeTimer}/>}
 </div></ModalRetryContext></ModalErrorContext></EducationCommandContext>
}
