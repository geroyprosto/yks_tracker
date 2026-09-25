'use client';

import {useEffect, useState, type CSSProperties} from 'react';
import {ArrowUpRight, Check, ChevronRight, ListTodo, Maximize2, NotebookPen, Pause, Play, Sparkles, Timer} from 'lucide-react';
import type {AppState} from '@/lib/domain/types';
import {combinedSegments} from '@/lib/progress-breakdown';
import {combinedProgress, taskProgress, timeProgress} from '@/lib/progress';
import {secondsByDay, sessionSeconds} from '@/lib/timing';
import {clockText, duration, localDate, type CommandFn} from '@/lib/ui';
import type {PageId} from './dashboard';
import {Modal} from './modal';
import {PracticeOverview} from './practice-overview';
import {Card, Empty, LinkButton, Ring} from './primitives';
import {TodayCalendar} from './today-calendar';
import {YksCountdown} from './yks-countdown';

export function Today({state, preview, command, busy, offset, go, openTimer, expandTimer, addTask, openExamDateSettings, openPractice}: {
  state: AppState;
  preview: boolean;
  command: CommandFn;
  busy: boolean;
  offset: number;
  go: (page: PageId, settingsTab?: 'connections') => void;
  openTimer: () => void;
  expandTimer: (source: HTMLElement) => void;
  addTask: () => void;
  openExamDateSettings: () => void;
  openPractice: () => void;
}) {
  const [editTarget, setEditTarget] = useState(false);
  const [latestAnalysis, setLatestAnalysis] = useState<{start:string;end:string;stale:boolean}|null>(null);
  useEffect(()=>{
    if(!state.authenticated||preview)return;
    const controller=new AbortController();
    void fetch('/api/analysis',{cache:'no-store',signal:controller.signal}).then(async response=>{
      if(!response.ok)return;
      const result=await response.json() as {reports?:Array<{start_date:string;end_date:string;status:string;stale:boolean}>};
      const latest=result.reports?.find(report=>report.status==='completed'&&
        Date.parse(report.end_date+'T12:00:00Z')-Date.parse(report.start_date+'T12:00:00Z')===13*86400000);
      if(!controller.signal.aborted&&latest)setLatestAnalysis({start:latest.start_date,end:latest.end_date,stale:latest.stale});
    }).catch(()=>{});
    return()=>controller.abort();
  },[state.authenticated,preview]);
  const [now, setNow] = useState(() => Date.now());
  const activeSession = state.sessions.find(session => session.status !== 'finished');

  const elapsed = activeSession ? sessionSeconds(activeSession, now + offset) : 0;
  const dialSeconds = activeSession?.mode === 'countdown'
    ? Math.max(0, (activeSession.target_seconds ?? 0) - elapsed) : elapsed;
  const dialTime = dialSeconds >= 3600
    ? clockText(dialSeconds)
    : String(Math.floor(dialSeconds / 60)).padStart(2, '0') + ':' + String(dialSeconds % 60).padStart(2, '0');
  const countdownDone = activeSession?.mode === 'countdown' && dialSeconds === 0;
  useEffect(() => {
    if (activeSession?.status !== 'running' || countdownDone) return;
    const frame = window.requestAnimationFrame(() => setNow(Date.now()));
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {window.cancelAnimationFrame(frame); window.clearInterval(interval);};
  }, [activeSession?.id, activeSession?.status, countdownDone]);
  const dialStatus = !activeSession ? 'Başlamaya hazır'
    : countdownDone ? 'Hedef süre doldu'
    : activeSession.status === 'paused' ? 'Duraklatıldı' : 'Çalışıyor';
  const dialMode = activeSession?.mode === 'countdown' ? 'Geri sayım' : activeSession ? 'Kronometre' : 'Odak sayacı';
  const tickCount = activeSession?.mode === 'countdown' && activeSession.target_seconds
    ? Math.round(Math.min(1, elapsed / activeSession.target_seconds) * 60)
    : activeSession ? Math.floor(elapsed % 60) : 0;
  const today = localDate();
  const tasks = state.tasks.filter(task => task.plan_date === today);
  const todayJournal = state.journal_entries.find(entry => entry.journal_date === today);
  const plan = state.day_plans.filter(item => item.plan_date === today).sort((a, b) => b.version - a.version)[0];
  const target = plan?.target_minutes ?? state.settings?.weekday_targets[(new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7] ?? state.settings?.daily_target_minutes ?? 360;
  const factors = plan?.difficulty_factors ?? state.settings?.difficulty_factors ?? {easy: 1, medium: 1.25, hard: 1.5};
  const progress = taskProgress(tasks, factors);
  const totals = secondsByDay(state, state.settings?.timezone ?? 'Europe/Istanbul', Date.parse(state.server_now));
  const seconds = totals[today] ?? 0;
  const time = timeProgress(seconds, target);
  const combined = combinedProgress(progress, time, plan?.task_share ?? state.settings?.task_share ?? .7);
  const taskShare = plan?.task_share ?? state.settings?.task_share ?? .7;
  const completed = tasks.filter(task => task.progress === 1).length;
  const days = Array.from({length: 7}, (_, index) => {
    const date = new Date(today + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() - 6 + index);
    return date.toISOString().slice(0, 10);
  });
  const max = Math.max(target * 60, ...days.map(day => totals[day] ?? 0), 1);
  const weekTotal = days.reduce((sum, day) => sum + (totals[day] ?? 0), 0);

  return <>
    {editTarget && <Modal title="Bugünün süre hedefi" onClose={() => setEditTarget(false)}><form className="form-grid" onSubmit={async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      if (plan && await command('plan.update', {plan_date: today, expected_revision: plan.version, target_minutes: Number(form.get('target'))})) setEditTarget(false);
    }}><label className="span-2">Net çalışma hedefi (dakika)<input type="number" min="0" max="1440" required name="target" defaultValue={target}/></label><p className="footnote span-2">Yalnız bugünün planını değiştirir. Önceki hedef sürümü korunur. Sıfır hedef tanımlı değil olarak gösterilir.</p><div className="form-actions span-2"><button className="button secondary" type="button" onClick={() => setEditTarget(false)}>Vazgeç</button><button className="button primary" disabled={busy || !state.authenticated}>Hedefi kaydet</button></div></form></Modal>}

    <div className="overview-grid">
      <Card className="daily-card" title="Günlük plan ilerlemesi" eyebrow="BUGÜNÜN ÖZETİ" action={<span className="pill">{tasks.length} görev</span>}>
        <div className="neon-metrics"><Ring value={progress} label="Görev ilerlemesi" detail={tasks.length ? completed + ' / ' + tasks.length + ' görev tamamlandı' : 'Henüz plan oluşturulmadı'}/><Ring value={time} color={1} label="Net çalışma süresi" detail={duration(seconds) + ' / ' + duration(target * 60)}/><Ring value={combined} segments={combinedSegments(progress, time, taskShare)} label="Günlük plan ilerlemesi" detail={progress === null ? 'Yalnız tanımlı süre hedefinden' : 'Görev ve süre birlikte'}/></div>
        <div className="plan-ratio"><span>Planın dağılımı:</span><span><i className="legend-dot" style={{background: 'var(--ring-1)'}}/><b>%{Math.round(taskShare * 100)}</b> görev</span><span><i className="legend-dot" style={{background: 'var(--ring-2)'}}/><b>%{Math.round((1 - taskShare) * 100)}</b> süre</span></div>
        <div className="card-bottom"><span>{progress === null || time === null ? 'Yalnız tanımlı bileşenlerin payı kullanılır.' : 'Halkadaki bölümler puana katkıyı gösterir.'}</span><button className="text-button" disabled={preview} onClick={() => setEditTarget(true)}>Hedefi düzenle<ChevronRight size={15}/></button></div>
      </Card>
      <Card className="focus-card gradient-card" title="Odak oturumu" eyebrow="ÇALIŞMA ZAMANI">
        <div className="focus-card-scene">
          <div className="focus-dial" role="timer" aria-live="off" aria-label={dialMode + ': ' + dialTime + '. ' + dialStatus}>
            <div className="focus-dial-ticks" aria-hidden="true">
              {Array.from({length: 60}, (_, index) => <span
                key={index}
                className={'focus-dial-tick' + (index % 5 === 0 ? ' is-major' : '') + (index < tickCount || (!activeSession && index === 0) ? ' is-lit' : '') + (activeSession && index === tickCount % 60 ? ' is-current' : '')}
                style={{'--tick-angle': index * 6 + 'deg'} as CSSProperties}
              />)}
            </div>
            <div className="focus-dial-face" aria-hidden="true">
              <Timer size={16}/>
              <span className="focus-dial-mode">{dialMode}</span>
              <strong className={dialTime.length > 5 ? 'is-long' : ''}>{dialTime}</strong>
              <small>{dialTime.length > 5 ? 'saat : dakika : saniye' : 'dakika : saniye'}</small>
              <span className="focus-dial-status"><i className={activeSession?.status === 'running' && !countdownDone ? 'is-running' : ''}/>{dialStatus}</span>
            </div>
          </div>
          <div className="focus-card-copy">
            <h3>{activeSession?.title ?? 'Bir süre ayır, odaklan.'}</h3>
            <p>{activeSession ? countdownDone ? 'Süren doldu. Oturumunu kaydedebilirsin.' : activeSession.mode === 'countdown' ? 'Kalan süreyi burada takip et.' : 'Geçen çalışma süreni burada takip et.' : 'Görev seçerek veya plansız çalışarak başla.'}</p>
          </div>
          <div className="focus-card-actions">
            {activeSession && !countdownDone && <button className="focus-card-toggle" type="button" disabled={busy} onClick={() => void command(activeSession.status === 'running' ? 'timer.pause' : 'timer.resume', {id: activeSession.id, expected_revision: activeSession.revision})}>{activeSession.status === 'running' ? <Pause size={16}/> : <Play size={16}/>}<span>{activeSession.status === 'running' ? 'Duraklat' : 'Sürdür'}</span></button>}
            <button className="button primary wide" disabled={!state.authenticated} onClick={openTimer}><Play size={16}/>Çalışma sayacını aç</button>
          </div>
          <span className="focus-note">Kronometre veya geri sayım</span>
        </div>
        <button className="focus-card-expand" type="button" aria-label="Sayacı büyüt" title="Odak ekranını aç" onClick={event => expandTimer(event.currentTarget.closest<HTMLElement>('.focus-card') ?? event.currentTarget)}><Maximize2 size={16}/><span>Büyüt</span></button>
      </Card>
    </div>

    <div className="content-grid today-primary-grid">
      <div className="column">
        <Card className="tasks-summary-card gradient-card" title="Bugünün görevleri" action={<button className="button small secondary" disabled={preview} onClick={addTask}>+ Görev ekle</button>}>
          <div className="mini-tabs"><span className="selected">Tümü <b>{tasks.length}</b></span><span>Tamamlanan <b>{completed}</b></span></div>
          {tasks.length === 0 ? <Empty icon={<ListTodo size={27}/>} title="Bugün için temiz bir sayfa" text="Aklındaki çalışmaları bir plana dönüştür. İlk görevini ekleyerek başlayabilirsin." action={<button className="text-button" onClick={addTask}>İlk görevimi oluştur<ArrowUpRight size={16}/></button>}/> : <div className="task-preview">{tasks.slice(0, 5).map(task => <div className="task-line" key={task.id}><button className={'check-button ' + (task.progress === 1 ? 'checked' : '')} aria-label={task.title + (task.progress === 1 ? ' tamamlamasını geri al' : ' görevini tamamla')} disabled={busy || preview} onClick={() => void command('task.update', {id: task.id, expected_revision: task.revision, progress: task.progress === 1 ? 0 : 1, steps: task.steps.map(step => ({...step, completed: task.progress !== 1}))})}>{task.progress === 1 && <Check size={15}/>}</button><div><strong className={task.progress === 1 ? 'done' : ''}>{task.title}</strong><small>{task.exam} {task.subject ?? 'Plansız'} · {task.study_type}</small></div><span className="pill">{task.planned_minutes} dk</span></div>)}</div>}
          <div className="card-bottom"><span>{completed} tamamlandı · {tasks.length - completed} seni bekliyor</span><LinkButton onClick={() => go('tasks')}>Tüm görevler</LinkButton></div>
        </Card>
        <Card className="rhythm-card gradient-card today-rhythm-card" title="Çalışma ritmin" eyebrow="SON 7 GÜN" action={<LinkButton onClick={() => go('stats')}>İstatistikler</LinkButton>}>
          <div className="chart-summary"><strong>{duration(weekTotal)}</strong><span>toplam net çalışma</span></div>
          <div className="week-chart" role="img" aria-label={'Son yedi gün toplam çalışma ' + duration(weekTotal)}>{days.map(day => <div className={'day-bar ' + (day === today ? 'current' : '')} key={day}><span className="bar-value">{totals[day] ? Math.round(totals[day] / 60) + ' dk' : '—'}</span><div className="bar-track"><div style={{height: Math.max(0, 100 * (totals[day] ?? 0) / max) + '%'}}/></div><span>{new Intl.DateTimeFormat('tr-TR', {weekday: 'short', timeZone: 'UTC'}).format(new Date(day + 'T12:00:00Z'))}</span></div>)}</div>
          <p className="footnote">— Kayıt olmayan günler. Henüz çalışma yapılmadığı anlamına gelmez.</p>
        </Card>
        <div className="today-practice-card"><PracticeOverview state={state} preview={preview} onOpen={openPractice}/></div>
      </div>
      <div className="column">
        <TodayCalendar authenticated={state.authenticated} onOpenSettings={() => go('settings', 'connections')}/>
        <YksCountdown examDate={state.settings?.exam_date ?? null} preview={preview} examYear={state.settings?.exam_year ?? 2027} onSetDate={openExamDateSettings}/>
        {latestAnalysis&&<Card className="ambient-card" title="Son iki haftalık analiz" action={<Sparkles size={19} className="muted-icon"/>}><p className="soft-copy">{latestAnalysis.start} – {latestAnalysis.end}{latestAnalysis.stale?' · Kayıtlar değişti':''}</p><LinkButton onClick={()=>go('analysis')}>Raporu aç</LinkButton></Card>}
        <Card className="ambient-card journal-preview-card" title="Günden bir not" action={<NotebookPen size={19} className="muted-icon"/>}><div className="journal-preview-body"><p className="soft-copy">{todayJournal?.original_text.trim().slice(0, 180) || 'Bugün neler iyi gitti, aklında neler kaldı?'}</p><LinkButton onClick={() => go('journal')}>{todayJournal ? 'Günlüğü aç' : 'Bir not yaz'}</LinkButton></div></Card>
      </div>
    </div>


  </>;
}



