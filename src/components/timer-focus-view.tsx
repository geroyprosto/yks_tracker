'use client';

import {useEffect, useId, useRef, useState, type ReactNode} from 'react';
import {Check, Minimize2, Pause, Play, Square, Timer, X} from 'lucide-react';

export type FocusOrigin = {left: number; top: number; width: number; height: number};

type TimerFocusViewProps = {
  seconds: number;
  mode: 'stopwatch' | 'countdown';
  targetSeconds: number | null;
  title: string;
  subtitle: string;
  status: 'ready' | 'running' | 'paused' | 'done';
  preview: boolean;
  busy: boolean;
  origin: FocusOrigin | null;
  onMinimize: () => void;
  onPauseResume: () => void;
  onStart: (instant: number) => void;
  canStart: boolean;
  onFinish: () => Promise<boolean>;
  canFinish: boolean;
  setup?: ReactNode;
  review?: ReactNode;
  error?: string;
};

type FinishSnapshot = Pick<TimerFocusViewProps, 'seconds' | 'mode' | 'targetSeconds' | 'title' | 'subtitle' | 'status' | 'preview' | 'setup' | 'review'>;

function reducedMotion() {
  return document.documentElement.dataset.reduced === 'true'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function collapsedFrame(origin: FocusOrigin | null, screen: HTMLElement) {
  const {width, height} = screen.getBoundingClientRect();
  if (!origin || width <= 0 || height <= 0 || origin.width <= 0 || origin.height <= 0
    || origin.top >= window.innerHeight || origin.top + origin.height <= 0
    || origin.left >= window.innerWidth || origin.left + origin.width <= 0) {
    return {transform: 'translate(0, 12px) scale(.97)', opacity: 0, borderRadius: '24px'};
  }
  return {
    transform: `translate(${origin.left}px, ${origin.top}px) scale(${Math.min(1, origin.width / width)}, ${Math.min(1, origin.height / height)})`,
    opacity: .55,
    borderRadius: '20px',
  };
}

const expandedFrame = {transform: 'translate(0, 0) scale(1, 1)', opacity: 1, borderRadius: '0px'};

export function TimerFocusView(props: TimerFocusViewProps) {
  const {busy, origin, onMinimize, onPauseResume, onStart, canStart, onFinish, canFinish, error} = props;
  const [simpleMode, setSimpleMode] = useState(false);
  const [finishSnapshot, setFinishSnapshot] = useState<FinishSnapshot | null>(null);
  const [finishError, setFinishError] = useState('');
  const finishingRef = useRef(false);
  const {seconds, mode, targetSeconds, title, subtitle, status, preview, setup, review} = finishSnapshot ?? props;
  const finishing = finishSnapshot !== null;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const closingRef = useRef(false);
  const initialOrigin = useRef(origin);
  const titleId = useId();
  const descriptionId = useId();
  const simpleTriggerRef = useRef<HTMLButtonElement>(null);
  const simpleCloseRef = useRef<HTMLButtonElement>(null);
  const openedSimpleRef = useRef(false);

  useEffect(() => {
    if (simpleMode) {
      openedSimpleRef.current = true;
      simpleCloseRef.current?.focus({preventScroll: true});
    } else if (openedSimpleRef.current) {
      simpleTriggerRef.current?.focus({preventScroll: true});
    }
  }, [simpleMode]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const screen = screenRef.current;
    if (!dialog || !screen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closingRef.current = false;
    dialog.showModal();
    const firstInput = dialog.querySelector<HTMLElement>('.timer-setup [data-initial-focus]')
      ?? dialog.querySelector<HTMLElement>('.timer-setup input:not([type="hidden"]), .timer-setup select');
    (firstInput ?? dialog.querySelector<HTMLElement>('.focus-minimize'))?.focus({preventScroll: true});
    if (!reducedMotion()) {
      const animation = screen.animate([collapsedFrame(initialOrigin.current, screen), expandedFrame], {
        duration: 460, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both',
      });
      animationRef.current = animation;
      animation.onfinish = () => { animation.cancel(); animationRef.current = null; };
    }
    return () => {
      if (animationRef.current) {
        animationRef.current.onfinish = null;
        animationRef.current.cancel();
        animationRef.current = null;
      }
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true});
    };
  }, []);

  function minimize(afterFinish = false) {
    if (closingRef.current || (finishingRef.current && !afterFinish)) return;
    closingRef.current = true;
    const screen = screenRef.current;
    const currentTransform = screen ? getComputedStyle(screen).transform : 'none';
    const currentOpacity = screen ? getComputedStyle(screen).opacity : '1';
    if (animationRef.current) {
      animationRef.current.onfinish = null;
      animationRef.current.cancel();
    }
    if (!screen || reducedMotion()) {
      onMinimize();
      return;
    }
    const animation = screen.animate([
      {transform: currentTransform, opacity: currentOpacity, borderRadius: '0px'},
      collapsedFrame(initialOrigin.current, screen),
    ], {duration: 320, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards'});
    animationRef.current = animation;
    animation.onfinish = () => {
      animation.onfinish = null;
      onMinimize();
    };
  }

  async function finish() {
    if (finishingRef.current || busy || !canFinish) return;
    finishingRef.current = true;
    setFinishError('');
    setFinishSnapshot({seconds, mode, targetSeconds, title, subtitle, status, preview, setup, review});
    try {
      if (await onFinish()) {
        minimize(true);
        return;
      }
    } catch {
      setFinishError('Oturum bitirilemedi. Lütfen yeniden dene.');
    }
    finishingRef.current = false;
    setFinishSnapshot(null);
  }

  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const showHours = mode === 'countdown' ? (targetSeconds ?? safeSeconds) >= 3600 : safeSeconds >= 3600;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor(safeSeconds / 60) % 60;
  const remainder = safeSeconds % 60;
  const units = [
    ...(showHours ? [{unit: 'hours', label: 'Saat', value: hours}] : []),
    {unit: 'minutes', label: 'Dakika', value: minutes},
    {unit: 'seconds', label: 'Saniye', value: remainder},
  ];
  const progress = mode === 'countdown' && targetSeconds && targetSeconds > 0
    ? Math.min(1, Math.max(0, (targetSeconds - safeSeconds) / targetSeconds)) : 0;
  const statusLabel = status === 'done' ? 'Hedef süre tamamlandı'
    : status === 'paused' ? 'Duraklatıldı · Hazır olduğunda devam et'
    : status === 'ready' ? 'Kendine bir odak alanı aç'
    : mode === 'countdown' ? 'Geri sayım devam ediyor' : 'Odak süren birikiyor';
  const accessibleTime = `${showHours ? `${hours} saat ` : ''}${minutes} dakika ${remainder} saniye`;

  return <dialog ref={dialogRef} className="timer-focus-dialog" aria-label={simpleMode ? 'Sade mod' : 'Odak ekranı'} aria-describedby={simpleMode ? undefined : descriptionId} onCancel={event => {event.preventDefault(); if (simpleMode) setSimpleMode(false); else minimize();}}>
    <div ref={screenRef} className={`timer-focus-screen${simpleMode ? ' timer-focus-screen--simple' : ''}`} data-status={status}>
      {simpleMode ? <div className="simple-timer">
        <button ref={simpleCloseRef} type="button" className="simple-timer-close" aria-label="Sade modu kapat" title="Sade modu kapat (Esc)" onClick={() => setSimpleMode(false)}><X size={13} aria-hidden="true" /></button>
        <div className="simple-timer-content">
          <div className="simple-timer-digits" role="timer" aria-live="off" aria-label={`${hours} saat ${minutes} dakika ${remainder} saniye`}>
            {[
              {unit: 'hours', value: hours},
              {unit: 'minutes', value: minutes},
              {unit: 'seconds', value: remainder},
            ].map(({unit, value}) => <div className="simple-digit-unit" data-unit={unit} key={unit} aria-hidden="true"><span className="simple-digit-value">{String(value).padStart(2, '0')}</span></div>)}
          </div>
          {(error || finishError) && <p className="simple-timer-error" role="alert">{error || finishError}</p>}
          {review && status !== 'ready' && <div className="simple-timer-review">{review}</div>}
          <div className="simple-timer-actions">
            {status !== 'done' && <button type="button" className="simple-timer-control" aria-label={status === 'ready' ? 'Başlat' : status === 'paused' ? 'Sürdür' : 'Duraklat'} title={status === 'ready' ? 'Başlat' : status === 'paused' ? 'Sürdür' : 'Duraklat'} onClick={status === 'ready' ? () => onStart(Date.now()) : onPauseResume} disabled={busy || finishing || (status === 'ready' && !canStart)}>{status === 'running' ? <Pause size={22} fill="currentColor" aria-hidden="true" /> : <Play size={22} fill="currentColor" aria-hidden="true" />}</button>}
            {(status === 'paused' || status === 'done') && <button type="button" className="simple-timer-control" aria-label="Bitir" title={preview ? 'Örnek sayacı bitir' : 'Bitir ve kaydet'} onClick={() => void finish()} disabled={busy || finishing || !canFinish}><X size={24} strokeWidth={2.5} aria-hidden="true" /></button>}
          </div>
          {status === 'ready' && !canStart && <p className="simple-timer-hint">Başlamak için odak ekranında bir ders seç.</p>}
          {preview && <p className="simple-timer-preview">Örnek sayaç · Süre kaydedilmez.</p>}
        </div>
      </div> : <>
      <div className="focus-ambient" aria-hidden="true">
        <div className="focus-ambient-halo" />
        <div className="focus-ambient-orbit focus-ambient-orbit-outer" />
        <svg className="focus-progress-orbit" viewBox="0 0 600 600">
          <circle className="focus-progress-track" cx="300" cy="300" r="282" />
          <circle className="focus-progress-fill" cx="300" cy="300" r="282" pathLength="100" strokeDasharray={`${progress * 100} 100`} />
        </svg>
      </div>
      <header className="focus-screen-topbar">
        <span className="focus-brand"><Timer size={18} aria-hidden="true" /> YKSim <span>Odak alanın</span></span>
        <div className="focus-topbar-actions">{preview && <span className="focus-preview-badge">Örnek sayaç</span>}<button ref={simpleTriggerRef} type="button" className="focus-simple-trigger" onClick={() => setSimpleMode(true)}>Sade mod</button></div>
      </header>
      <div className="focus-timer-body">
        <div className="focus-timer-heading">
          <p className="focus-timer-eyebrow">{mode === 'countdown' ? 'Geri sayım' : 'Kronometre'}</p>
          <h2 id={titleId}>{title || 'Şimdi, kendine odaklan.'}</h2>
          {subtitle && <p className="focus-timer-subtitle">{subtitle}</p>}
        </div>
        <div className="focus-digits" role="timer" aria-live="off" aria-label={accessibleTime} data-units={units.length}>
          {units.map(({unit, label, value}) => <div className="focus-digit-unit" data-unit={unit} key={unit} aria-hidden="true">
            <span className="focus-digit-label">{label}</span>
            <div className="focus-digit-tile"><span className="focus-digit-value" key={value}>{String(value).padStart(2, '0')}</span></div>
          </div>)}
        </div>
        <p className="focus-timer-status" role="status" aria-live="polite"><span className={`focus-status-dot${status === 'running' ? ' is-running' : ''}`}>{status === 'done' && <Check size={12} />}</span>{statusLabel}</p>
        {(error || finishError) && <p className="focus-timer-error" role="alert">{error || finishError}</p>}
        {status === 'ready' ? setup : <>
          {review && <div className="focus-review">{review}</div>}
          <div className="focus-timer-actions">
            {status !== 'done' && <button type="button" className="button focus-pause" onClick={onPauseResume} disabled={busy || finishing}>
              {status === 'paused' ? <Play size={19} /> : <Pause size={19} />}
              {status === 'paused' ? 'Sayacı sürdür' : 'Sayacı duraklat'}
            </button>}
            <button type="button" className="button focus-finish" onClick={() => void finish()} disabled={busy || finishing || !canFinish}><Square size={16} />Sayacı bitir</button>
          </div>
        </>}
        <p className="focus-timer-note" id={descriptionId}>{preview ? 'Örnek mod · Bu süre çalışma kayıtlarına eklenmez.' : status === 'ready' ? 'Küçük bir başlangıç, güzel bir ilerleme.' : 'Duraklattığında mola süresi çalışmana eklenmez.'}</p>
      </div>
      <footer className="focus-screen-footer"><span>Tek bir şeye odaklan. Kendi ritminde ilerle.</span><button type="button" className="focus-minimize" onClick={() => minimize()} disabled={finishing} aria-label="Sayacı küçült" title="Sayacı küçült (Esc)"><Minimize2 size={21} /><span>Küçült</span></button></footer>
      </>}
    </div>
  </dialog>;
}


