'use client';

import {useContext, useEffect, useState, type FormEvent} from 'react';
import {Maximize2, Minus, Pause, Play, Plus, Square} from 'lucide-react';
import type {AppState, StudySession, StudyType} from '@/lib/domain/types';
import {clockText, type CommandFn} from '@/lib/ui';
import {sessionSeconds} from '@/lib/timing';
import {Modal, ModalErrorContext} from './modal';
import {TimerFocusView, type FocusOrigin} from './timer-focus-view';
import {CourseSelector} from './course-selector';

type Exam = 'TYT' | 'AYT';
type TimerMode = 'stopwatch' | 'countdown';
type Activity = 'Ders çalışması' | 'Soru çözümü' | 'Branş denemesi' | 'Deneme çözümü' | 'Deneme analizi' | 'Tekrar';
const fallbackSubjects: Record<Exam, readonly string[]> = {
  TYT: ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji', 'Coğrafya'],
  AYT: ['Matematik', 'Fizik', 'Kimya', 'Biyoloji'],
};
const activities: {label: Activity; studyType: StudyType}[] = [
  {label: 'Ders çalışması', studyType: 'Konu anlatımı'},
  {label: 'Soru çözümü', studyType: 'Soru çözümü'},
  {label: 'Branş denemesi', studyType: 'Soru çözümü'},
  {label: 'Deneme çözümü', studyType: 'Soru çözümü'},
  {label: 'Deneme analizi', studyType: 'Yanlış analizi'},
  {label: 'Tekrar', studyType: 'Tekrar'},
];
const minutePresets = [25, 40, 50, 90];

function recentCountdownMinutes(sessions: StudySession[]) {
  const latest = sessions.reduce<StudySession | null>((result, session) =>
    session.mode === 'countdown' && session.target_seconds &&
    (!result || Date.parse(session.started_at) > Date.parse(result.started_at)) ? session : result, null);
  return latest?.target_seconds ? Math.min(360, Math.max(1, Math.round(latest.target_seconds / 60))) : 40;
}
function recentCourse(sessions: StudySession[], subjects: Record<Exam, readonly string[]>) {
  const latest = sessions.reduce<StudySession | null>((result, session) => {
    const [exam, ...parts] = session.subject?.split(' ') ?? [];
    if ((exam !== 'TYT' && exam !== 'AYT') || !subjects[exam].includes(parts.join(' '))) return result;
    return !result || Date.parse(session.started_at) > Date.parse(result.started_at) ? session : result;
  }, null);
  return latest?.subject ?? null;
}

type TimerPanelProps = {
  state: AppState; command: CommandFn; busy: boolean; offset: number; expanded: boolean;
  focus: boolean; origin: FocusOrigin | null; onFocus: (source: HTMLElement) => void; onClose: () => void;
};

export function TimerPanel({state, command, busy, offset, expanded, focus, origin, onFocus, onClose}: TimerPanelProps) {
  const error = useContext(ModalErrorContext);
  const [now, setNow] = useState(() => Date.now());
  const [courseId,setCourseId]=useState<string|undefined>(undefined);
  const modern=Boolean(state.education?.profile);
  const yks=state.education?.profile?.yks_goal??true;
  const availableCourses=(state.education?.courses??[]).filter(course=>!course.archived&&(course.context==='yks'?yks:course.term_id===state.education?.profile?.active_term_id));
  const recentId=[...state.sessions].sort((a,b)=>b.started_at.localeCompare(a.started_at)).find(session=>availableCourses.some(course=>course.id===session.course_id))?.course_id;
  const selectedCourseId=courseId??recentId??'';
  const pickedCourse=availableCourses.find(course=>course.id===selectedCourseId);
  const unavailableCourse=modern&&Boolean(selectedCourseId)&&!pickedCourse;
  const [examChoice, setExamChoice] = useState<Exam | null>(null);
  // undefined follows the latest saved course; null is an intentional course-free selection.
  const [courseChoice, setCourseChoice] = useState<string | null | undefined>(undefined);
  const [activity, setActivity] = useState<Activity>('Ders çalışması');
  const [mode, setMode] = useState<TimerMode>('countdown');
  const [minuteInput, setMinuteInput] = useState<string | null>(null);
  const [review, setReview] = useState({sessionId: '', minutes: ''});
  // A sample can run in the unconfigured workspace without creating study records.
  const [sampleSession, setSampleSession] = useState<StudySession | null>(null);

  const realActive = state.sessions.find(session => session.status !== 'finished');
  const preview = !state.configured && !realActive;
  const active = realActive ?? (preview ? sampleSession : null);
  const ticking = active?.status === 'running' || expanded;
  useEffect(() => {
    if (!ticking) return;
    const frame = requestAnimationFrame(() => setNow(Date.now()));
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => {cancelAnimationFrame(frame); clearInterval(interval);};
  }, [ticking]);

  const seconds = active ? sessionSeconds(active, now + (preview ? 0 : offset)) : 0;
  const remaining = active?.mode === 'countdown' ? Math.max(0, (active.target_seconds ?? 0) - seconds) : seconds;
  const done = active?.mode === 'countdown' && remaining === 0;
  const needsReview = seconds > 21600 && active?.mode === 'stopwatch';
  const confirmedMinutes = active && review.sessionId === active.id ? review.minutes : '';
  const confirmedSeconds = confirmedMinutes.trim() === '' ? null : Math.round(Number(confirmedMinutes) * 60);
  const reviewValid = !needsReview || (confirmedSeconds !== null && Number.isFinite(confirmedSeconds) && confirmedSeconds >= 0 && confirmedSeconds <= seconds);

  const catalogSubjects: Record<Exam, readonly string[]> = state.topics.length ? {
    TYT: [...new Set(state.topics.filter(topic => topic.exam === 'TYT').map(topic => topic.subject))].sort((left, right) => left.localeCompare(right, 'tr')),
    AYT: [...new Set(state.topics.filter(topic => topic.exam === 'AYT').map(topic => topic.subject))].sort((left, right) => left.localeCompare(right, 'tr')),
  } : fallbackSubjects;
  const lastCourse = recentCourse(state.sessions, catalogSubjects);
  const selectedCourse = courseChoice === undefined ? lastCourse : courseChoice;
  const exam: Exam = examChoice ?? (selectedCourse?.startsWith('AYT ') ? 'AYT' : 'TYT');
  const subjectName = selectedCourse?.startsWith(exam + ' ') ? selectedCourse.slice(4) : null;
  const effectiveActivity = !yks && activity.toLocaleLowerCase('tr-TR').includes('deneme') ? 'Ders çalışması' : activity;
  const selectedActivity = activities.find(item => item.label === effectiveActivity)!;
  const canOmitCourse = effectiveActivity === 'Deneme çözümü' || effectiveActivity === 'Deneme analizi';
  const generatedTitle = modern ? pickedCourse ? (pickedCourse.context==='yks'?pickedCourse.exam+' ':'')+pickedCourse.name+(effectiveActivity==='Ders çalışması'?'':' · '+effectiveActivity) : 'Serbest çalışma' : subjectName
    ? effectiveActivity === 'Ders çalışması' ? exam + ' ' + subjectName : exam + ' ' + subjectName + ' ' + effectiveActivity.toLocaleLowerCase('tr-TR')
    : canOmitCourse ? exam + ' ' + effectiveActivity.toLocaleLowerCase('tr-TR') : '';
  const rememberedMinutes = recentCountdownMinutes(state.sessions);
  const displayedMinutes = minuteInput ?? String(rememberedMinutes);
  const durationMinutes = Number(displayedMinutes);
  const durationValid = mode !== 'countdown' || (Number.isInteger(durationMinutes) && durationMinutes >= 1 && durationMinutes <= 360);
  const canStart = !!generatedTitle && durationValid && !unavailableCourse;
  const targetSeconds = mode === 'countdown' && durationValid ? durationMinutes * 60 : null;

  const transition = async (type: 'timer.pause' | 'timer.resume' | 'timer.finish') => {
    if (!active) return false;
    if (type === 'timer.finish' && !reviewValid) return false;
    if (preview) {
      const instant = Date.now();
      setNow(instant);
      setSampleSession(session => {
        if (!session) return null;
        if (type === 'timer.finish') return null;
        return {...session, status: type === 'timer.pause' ? 'paused' : 'running', accumulated_seconds: sessionSeconds(session, instant), active_since: type === 'timer.resume' ? new Date(instant).toISOString() : null, revision: session.revision + 1};
      });
      return true;
    }
    return command(type, {id: active.id, expected_revision: active.revision, ...(type === 'timer.finish' && needsReview ? {confirmed_seconds: confirmedSeconds} : {})});
  };

  const start = async (event: FormEvent<HTMLFormElement>, isFocus: boolean, instant: number) => {
    event.preventDefault();
    if (busy || !canStart) return;
    const payload = {
      title: generatedTitle,
      task_id: null,
      topic_id: null,
      subject: modern ? pickedCourse?.name??null : subjectName ? exam + ' ' + subjectName : null,
      ...(modern?{course_id:pickedCourse?.id??null}:{}),
      study_type: selectedActivity.studyType,
      mode,
      target_seconds: targetSeconds,
    };
    if (mode === 'countdown') setMinuteInput(String(durationMinutes));
    if (preview) {
      const stamp = new Date(instant).toISOString();
      setNow(instant);
      setSampleSession({id: '__focus_timer_preview__', ...payload, status: 'running', started_at: stamp, active_since: stamp, accumulated_seconds: 0, finished_at: null, revision: 1});
    } else if (await command('timer.start', payload) && !isFocus) {
      onClose();
    }
  };

  const setup = (isFocus: boolean) => <form className={'timer-setup timer-setup--' + (isFocus ? 'focus' : 'modal')} onSubmit={event => void start(event, isFocus, Date.now())}>
    <div className="timer-setup-head">
      <p className="eyebrow">Yeni odak oturumu</p>
      <h3>{isFocus ? 'Bugün neye odaklanacaksın?' : 'Ne çalışacaksın?'}</h3>
      <p className="timer-setup-intro">Dersini ve çalışma türünü seç. Başlamak için başka bir şey yazman gerekmiyor.</p>
    </div>

    <div className="timer-setup-section">
      {modern?<><CourseSelector state={state} value={selectedCourseId} onChange={setCourseId} disabled={busy} initialFocus/>{unavailableCourse&&<p role="status" className="notice">Seçili ders artık aktif çalışma alanında değil. Başlamadan önce başka bir ders seç veya ders seçimini kaldır.</p>}</>:<>
      <span className="timer-setup-label">Ders</span>
      <div className="timer-exam-tabs" role="group" aria-label="Sınav bölümü">
        {(['TYT', 'AYT'] as const).map(item => <button key={item} type="button" className="timer-exam-tab" data-active={exam === item} data-initial-focus={exam === item ? true : undefined} aria-pressed={exam === item} onClick={() => {setExamChoice(item); setCourseChoice(null);}}>{item}</button>)}
      </div>
      <div className="timer-subjects" role="group" aria-label={exam + ' dersi'}>
        {catalogSubjects[exam].map(subject => <button key={subject} type="button" className="timer-subject-option" data-active={subjectName === subject} aria-pressed={subjectName === subject} onClick={() => setCourseChoice(subjectName === subject ? null : exam + ' ' + subject)}>{subject}</button>)}
      </div>
      <p className="timer-subject-hint">Tam deneme için ders seçmeden “Deneme çözümü” veya “Deneme analizi” seçebilirsin.</p></>}
    </div>

    <div className="timer-setup-section">
      <span className="timer-setup-label">Çalışma türü</span>
      <div className="timer-study-types" role="group" aria-label="Çalışma türü">
        {activities.filter(item=>yks||!item.label.includes('deneme')&&!item.label.includes('Deneme')).map(item => <button key={item.label} type="button" className="timer-study-option" data-active={effectiveActivity === item.label} aria-pressed={effectiveActivity === item.label} onClick={() => setActivity(item.label)}>{item.label}</button>)}
      </div>
    </div>

    <div className="timer-setup-section timer-setup-time">
      <span className="timer-setup-label">Sayaç</span>
      <div className="timer-mode-toggle" role="group" aria-label="Sayaç türü">
        <button type="button" className="timer-mode-option" data-active={mode === 'countdown'} aria-pressed={mode === 'countdown'} onClick={() => setMode('countdown')}>Geri sayım</button>
        <button type="button" className="timer-mode-option" data-active={mode === 'stopwatch'} aria-pressed={mode === 'stopwatch'} onClick={() => setMode('stopwatch')}>Kronometre</button>
      </div>
      {mode === 'countdown' && <div className="timer-duration">
        <div className="timer-duration-presets" role="group" aria-label="Hazır süreler">
          {minutePresets.map(value => <button key={value} type="button" className="timer-preset" data-active={durationMinutes === value} aria-pressed={durationMinutes === value} onClick={() => setMinuteInput(String(value))}>{value} dk</button>)}
        </div>
        <div className="timer-duration-control">
          <button type="button" className="timer-stepper-button" aria-label="Süreyi 5 dakika azalt" disabled={durationMinutes <= 1} onClick={() => setMinuteInput(String(Math.max(1, (Number.isFinite(durationMinutes) ? durationMinutes : rememberedMinutes) - 5)))}><Minus size={17}/></button>
          <label className="timer-duration-field"><span className="sr-only">Süre (dakika)</span><input className="timer-minutes-input" type="number" min="1" max="360" step="1" inputMode="numeric" value={displayedMinutes} onChange={event => setMinuteInput(event.target.value)} required disabled={busy}/><span>dk</span></label>
          <button type="button" className="timer-stepper-button" aria-label="Süreyi 5 dakika artır" disabled={durationMinutes >= 360} onClick={() => setMinuteInput(String(Math.min(360, (Number.isFinite(durationMinutes) ? durationMinutes : rememberedMinutes) + 5)))}><Plus size={17}/></button>
        </div>
        <p className="timer-duration-hint">Son kullandığın süre: {rememberedMinutes} dk</p>
      </div>}
    </div>

    <div className="timer-setup-actions">
      <span className="timer-setup-summary" aria-live="polite">{generatedTitle || 'Başlamak için bir ders seç'}</span>
      {!isFocus && <button type="button" className="button secondary" onClick={onClose}>Vazgeç</button>}
      <button type="submit" className="button primary timer-start" disabled={busy || !canStart || (!preview && !state.authenticated)}><Play size={17}/>Çalışmaya başla</button>
    </div>
  </form>;

  const reviewField = needsReview ? <label className="review-box">Sayaç 6 saatten uzun açık kaldı. Gerçekte çalıştığın net dakikayı doğrula.<input type="number" min="0" max={Math.floor(seconds / 60)} value={confirmedMinutes} onChange={event => setReview({sessionId: active!.id, minutes: event.target.value})} placeholder="Net dakika"/></label> : undefined;

  if (expanded && focus) return <TimerFocusView
    seconds={active ? remaining : mode === 'countdown' ? (targetSeconds ?? 0) : 0}
    mode={active?.mode ?? mode}
    targetSeconds={active ? active.target_seconds : targetSeconds}
    title={active?.title ?? (generatedTitle || 'Dersini seç, odaklanmaya başla')}
    subtitle={active ? [active.study_type, active.subject].filter(Boolean).join(' · ') : 'Kendi ritminde çalışmaya başla.'}
    status={active ? (done ? 'done' : active.status === 'paused' ? 'paused' : 'running') : 'ready'}
    preview={preview} busy={busy} origin={origin} onMinimize={onClose}
    onPauseResume={() => void transition(active?.status === 'running' ? 'timer.pause' : 'timer.resume')}
    onFinish={() => transition('timer.finish')} canFinish={reviewValid} review={reviewField} error={error}
    setup={!active ? setup(true) : undefined}
  />;

  if (!expanded && active) return <div className="floating-timer"><button aria-label="Odak ekranını aç" onClick={event => onFocus(event.currentTarget)}><span className={'live-dot ' + (active.status === 'paused' ? 'is-paused' : '')}/><span className="floating-title">{preview ? 'Örnek · ' : ''}{active.title}</span><strong>{clockText(remaining)}</strong><Maximize2 size={18}/></button></div>;
  if (!expanded) return null;
  return <Modal title={active ? 'Çalışma sayacı' : 'Çalışmaya başla'} onClose={onClose}>{active ? <div className="timer-content"><p className="eyebrow">{active.study_type} {active.subject && '· ' + active.subject}</p><h3>{active.title}</h3><div className="timer-digits" aria-label="Çalışma süresi">{clockText(remaining)}</div><span className="pill">{done ? 'Hedef süre doldu' : active.status === 'paused' ? 'Duraklatıldı · mola süreye eklenmez' : active.mode === 'countdown' ? 'Geri sayım' : 'Kronometre'}</span>{reviewField}<div className="timer-actions">{!done && <button className="button secondary" disabled={busy} onClick={() => void transition(active.status === 'running' ? 'timer.pause' : 'timer.resume')}>{active.status === 'running' ? <Pause size={18}/> : <Play size={18}/>} {active.status === 'running' ? 'Duraklat' : 'Sürdür'}</button>}<button className="button primary" disabled={busy || !reviewValid} onClick={async () => {if (await transition('timer.finish')) onClose();}}><Square size={16}/>{done ? 'Oturumu kaydet' : 'Bitir ve kaydet'}</button></div><button className="text-button timer-modal-expand" type="button" onClick={event => onFocus(event.currentTarget.closest<HTMLElement>('.modal') ?? event.currentTarget)}><Maximize2 size={17}/>Büyük ekranda aç</button><p className="footnote">Sayaç görevini otomatik tamamlamaz. Ekran kilitliyken sesli uyarı garanti edilmez. Geri sayımda en fazla hedef süre kaydedilir.</p></div> : setup(false)}</Modal>;
}
