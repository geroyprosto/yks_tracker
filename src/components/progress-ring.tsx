'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import type { RingSegment } from '@/lib/progress-breakdown';

const RADIUS = 70;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const RISE_DURATION = 850;
const subscribeToHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;
const percentage = (value: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(value);

function point(angle: number) {
  const radians = (angle - 90) * Math.PI / 180;
  return { x: 90 + RADIUS * Math.cos(radians), y: 90 + RADIUS * Math.sin(radians) };
}

function motionDisabled() {
  if (typeof window === 'undefined') return true;
  const root = document.documentElement;
  return root.dataset.reduced === 'true' || root.dataset.simple === 'true' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function AnimatedPercent({ value }: { value: number }) {
  const target = Number.isFinite(value) ? value : 0;
  const [display, setDisplay] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    let frame = 0;
    const from = current.current;
    if (from === target) return;
    if (motionDisabled()) {
      frame = requestAnimationFrame(() => {
        current.current = target;
        setDisplay(target);
      });
      return () => cancelAnimationFrame(frame);
    }
    const started = performance.now();
    const tick = (now: number) => {
      if (motionDisabled()) {
        current.current = target;
        setDisplay(target);
        return;
      }
      const elapsed = Math.min(1, (now - started) / RISE_DURATION);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      const next = from + (target - from) * eased;
      current.current = next;
      setDisplay(next);
      if (elapsed < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return <>%{Math.round(display)}</>;
}

function AnimatedArc({ length, offset, color, gradient, midpoint, label, entering }: {
  length: number; offset: number; color: number; gradient: string;
  midpoint: { x: number; y: number }; label: string | null; entering: boolean;
}) {
  const [drawn, setDrawn] = useState(() => ({
    length: entering && !motionDisabled() ? 0 : length,
    offset,
  }));

  useEffect(() => {
    let nextFrame = 0;
    const update = () => setDrawn(previous =>
      previous.length === length && previous.offset === offset ? previous : { length, offset });
    if (motionDisabled()) {
      nextFrame = requestAnimationFrame(update);
      return () => cancelAnimationFrame(nextFrame);
    }
    // Commit the zero-length entering arc before growing it on a later frame.
    const firstFrame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(update);
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(nextFrame);
    };
  }, [length, offset]);

  const dasharray = drawn.length.toFixed(3) + ' ' + Math.max(0, CIRCUMFERENCE - drawn.length).toFixed(3);
  return <g style={{ '--segment-color': 'var(--ring-' + (color + 1) + ')' } as CSSProperties}>
    <circle className="donut-glow" cx="90" cy="90" r={RADIUS} transform="rotate(-90 90 90)"
      strokeDasharray={dasharray} strokeDashoffset={-drawn.offset} />
    <circle className="donut-segment" cx="90" cy="90" r={RADIUS} transform="rotate(-90 90 90)"
      strokeDasharray={dasharray} strokeDashoffset={-drawn.offset} stroke={'url(#' + gradient + ')'} />
    {label && <text className={'donut-arc-label' + (entering ? ' is-entering' : '')}
      x={midpoint.x} y={midpoint.y} dominantBaseline="central" textAnchor="middle">{label}</text>}
  </g>;
}

export function Donut({ segments, center, caption, label, empty = false }: {
  segments: RingSegment[]; center: ReactNode; caption: string; label: string; empty?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const root = useRef<HTMLDivElement>(null);
  const hydrated = useSyncExternalStore(subscribeToHydration, clientHydrated, serverHydrated);
  const visible = segments.filter(segment => Number.isFinite(segment.value) && segment.value > 0);
  const sum = visible.reduce((total, segment) => total + segment.value, 0);
  const previousSum = useRef(sum);
  const scale = sum > 100 ? 100 / sum : 1;

  const arcs = visible.map((segment, index) => {
    const start = visible.slice(0, index).reduce((total, item) => total + item.value * scale * 3.6, 0);
    const extent = segment.value * scale * 3.6;
    const gap = visible.length > 1 || sum < 99.99 ? Math.min(2.5, extent * .16) : .01;

    return {
      ...segment,
      length: Math.max(0, extent - gap) / 360 * CIRCUMFERENCE,
      offset: (start + gap / 2) / 360 * CIRCUMFERENCE,
      midpoint: point(start + extent / 2),
      scaledValue: segment.value * scale,
    };
  });

  useEffect(() => {
    const previous = previousSum.current;
    previousSum.current = sum;

    if (sum <= previous + .001 || motionDisabled()) return;
    root.current?.querySelector('.donut-aura')?.animate(
      [{ opacity: .07, strokeWidth: '34px' }, { opacity: .24, strokeWidth: '40px' }, { opacity: .07, strokeWidth: '34px' }],
      { duration: RISE_DURATION, easing: 'ease-out' },
    );
  }, [sum]);

  return <div ref={root} className={'neon-donut ' + (empty ? 'is-empty' : '')} role="img" aria-label={label}>
    <svg viewBox="0 0 180 180" aria-hidden="true">
      <defs>{arcs.map(segment => <linearGradient key={segment.key} id={id + '-' + segment.color} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style={{ stopColor: 'var(--ring-' + (segment.color + 1) + '-start, color-mix(in srgb, var(--ring-' + (segment.color + 1) + ') 80%, white))' }} />
        <stop offset="100%" style={{ stopColor: 'var(--ring-' + (segment.color + 1) + '-end, var(--ring-' + (segment.color + 1) + '))' }} />
      </linearGradient>)}</defs>
      <circle className="donut-aura" cx="90" cy="90" r={RADIUS} />
      <circle className="donut-track" cx="90" cy="90" r={RADIUS} />
      <circle className="donut-inner-edge" cx="90" cy="90" r="54" />
      {arcs.map(segment => <AnimatedArc key={segment.key} length={segment.length} offset={segment.offset}
        color={segment.color} gradient={id + '-' + segment.color} midpoint={segment.midpoint}
        label={segment.scaledValue >= 13 ? Math.round(segment.scaledValue) + '%' : null}
        entering={hydrated} />)}
    </svg>
    <div className="donut-center"><strong>{center}</strong><span>{caption}</span></div>
  </div>;
}

export function Ring({ value, label, detail, segments, color = 0, showLegend = true }: {
  value: number | null; label: string; detail: string; segments?: RingSegment[]; color?: number; showLegend?: boolean;
}) {
  const progress = value === null ? null : Math.min(100, Math.max(0, value));
  const parts = segments ?? (progress === null ? [] : [{ key: 'completed', label: 'Tamamlanan', value: progress, color }]);
  const remaining = progress === null ? null : Math.max(0, 100 - progress);
  return <div className="neon-metric">
    <Donut segments={parts} center={value === null ? '—' : <AnimatedPercent value={value} />}
      caption={value === null ? 'HENÜZ PLAN YOK' : 'TAMAMLANDI'}
      label={label + ': ' + (value === null ? 'tanımlı değil' : '%' + percentage(value))} empty={value === null || value === 0} />
    <h3>{label}</h3><p className="metric-detail">{detail}</p>
    {showLegend && <ul className="ring-legend">
      {parts.map(part => <li key={part.key}><span className="legend-dot" style={{ '--legend-color': 'var(--ring-' + (part.color + 1) + ')' } as CSSProperties} /><span>{part.label}</span><b>%{percentage(part.value)}</b></li>)}
      {remaining !== null && <li className="remaining"><span className="legend-dot" /><span>Kalan</span><b>%{percentage(remaining)}</b></li>}
      {progress === null && <li className="remaining"><span className="legend-dot" /><span>Plan ekleyince hesaplanır</span></li>}
    </ul>}
    {value !== null && value > 100 && <span className="goal-excess">Hedefin %{percentage(value - 100)} üzerinde</span>}
  </div>;
}



