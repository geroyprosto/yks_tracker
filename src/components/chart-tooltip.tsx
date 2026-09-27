'use client';

import {useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import styles from './chart-tooltip.module.css';

export type ChartDetail = {title: string; value: string; context?: string; note?: string};
type ActiveDetail = {key: string; detail: ChartDetail; anchor: HTMLElement; x: number; y: number; pinned: boolean; appearance?: string; accent?: string};

/** Shared HTML tooltip: escapes chart clipping and remains readable at viewport edges. */
export function useChartTooltip(className?: string) {
  const id = useId();
  const [active, setActive] = useState<ActiveDetail | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerKind = useRef('mouse');
  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const close = useCallback(() => {cancelClose(); setActive(null);}, [cancelClose]);
  const leave = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setActive(current => current?.pinned ? current : null), 120);
  }, [cancelClose]);

  useEffect(() => () => cancelClose(), [cancelClose]);
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {if (event.key === 'Escape') close();};
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !active.anchor.contains(event.target) &&
        !document.getElementById(id)?.contains(event.target)) close();
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && document.getElementById(id)?.contains(event.target)) return;
      close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [active, close, id]);

  function show(key: string, detail: ChartDetail, anchor: HTMLElement, pinned = false, position?: {x: number; y: number}) {
    cancelClose();
    const rect = anchor.getBoundingClientRect();
    const theme = anchor.closest<HTMLElement>('[data-appearance]');
    setActive({key, detail, anchor, pinned, x: position?.x ?? rect.left + rect.width / 2, y: position?.y ?? rect.top + rect.height / 2,
      appearance: theme?.dataset.appearance, accent: theme?.dataset.accent});
  }

  function triggerProps(key: string, detail: ChartDetail) {
    return {
      'aria-label': [detail.title, detail.value, detail.context, detail.note].filter(Boolean).join('. '),
      'aria-describedby': active?.key === key ? id : undefined,
      'data-tooltip-active': active?.key === key || undefined,
      onPointerEnter: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.pointerType !== 'touch') show(key, detail, event.currentTarget, false, {x: event.clientX, y: event.clientY});
      },
      onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {pointerKind.current = event.pointerType;},
      onPointerLeave: leave,
      onFocus: (event: React.FocusEvent<HTMLButtonElement>) => show(key, detail, event.currentTarget, event.currentTarget.matches(':focus-visible')),
      onBlur: close,
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => show(key, detail, event.currentTarget, event.detail === 0 || pointerKind.current === 'touch'),
    };
  }

  return {triggerProps, close, tooltip: active ? <ChartTooltip id={id} active={active} className={className} onPointerEnter={cancelClose} onPointerLeave={leave}/> : null};
}

function ChartTooltip({id, active, className, onPointerEnter, onPointerLeave}: {
  id: string; active: ActiveDetail; className?: string; onPointerEnter: () => void; onPointerLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tooltip = ref.current;
    if (!tooltip) return;
    const {width, height} = tooltip.getBoundingClientRect();
    const edge = 12, gap = 16;
    const left = Math.max(edge, Math.min(active.x - width / 2, window.innerWidth - width - edge));
    const above = active.y - height - gap;
    const top = Math.max(edge, Math.min(above >= edge ? above : active.y + gap, window.innerHeight - height - edge));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.visibility = 'visible';
  }, [active]);

  return createPortal(<div ref={ref} id={id} role="tooltip" className={`${styles.tooltip}${className ? ` ${className}` : ''}`}
    data-appearance={active.appearance} data-accent={active.accent}
    style={{visibility: 'hidden'}} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
    <span className={styles.title}>{active.detail.title}</span>
    <strong className={styles.value}>{active.detail.value}</strong>
    {active.detail.context && <span className={styles.context}>{active.detail.context}</span>}
    {active.detail.note && <span className={styles.note}>{active.detail.note}</span>}
  </div>, document.body);
}

/** A real button above the SVG keeps its point reachable by keyboard and touch. */
export function ChartPoint({x, y, detail, pointKey, tooltip, children}: {
  x: number; y: number; detail: ChartDetail; pointKey: string;
  tooltip: ReturnType<typeof useChartTooltip>; children?: ReactNode;
}) {
  return <button type="button" className={styles.point} style={{left: `${x}%`, top: `${y}%`} as CSSProperties}
    data-chart-point="true" {...tooltip.triggerProps(pointKey, detail)} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const points = [...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[data-chart-point]')];
      const index = points.indexOf(event.currentTarget);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 :
        (index + (event.key === 'ArrowRight' ? 1 : -1) + points.length) % points.length;
      event.preventDefault();
      points[next]?.focus();
    }}>{children}</button>;
}
