'use client';

import {useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';
import type {Task} from '@/lib/domain/types';

type Drag = {
  pointerId: number; handle: HTMLButtonElement; items: Task[]; centers: number[];
  from: number; to: number; startY: number; clientY: number; moved: boolean;
  signature: string; commit: (id: string, from: number, to: number) => void;
};

/** Pointer capture keeps the same handle working for a mouse, pen or touch. */
export function useTaskReorder(items: Task[], disabled: boolean, commit: Drag['commit']) {
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const [preview, setPreview] = useState<{id: string; ids: string[]} | null>(null);
  const signature = items.map(task => task.id + ':' + task.revision).join(',');

  useLayoutEffect(() => {
    // React moves the captured handle with its row. Restore capture after that
    // DOM move, before the next pointer event (also required for touch).
    const active = drag.current;
    if (active && preview) active.handle.setPointerCapture(active.pointerId);
  }, [preview]);

  const finish = useCallback((save: boolean) => {
    const active = drag.current;
    drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setPreview(null);
    if (!active) return;
    if (active.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId);
    if (save && active.moved && active.from !== active.to) active.commit(active.items[active.from].id, active.from, active.to);
  }, []);

  useEffect(() => {
    const cancel = () => finish(false);
    const escape = (event: KeyboardEvent) => {if (event.key === 'Escape' && drag.current) {event.preventDefault(); cancel();}};
    document.addEventListener('keydown', escape);
    window.addEventListener('blur', cancel);
    return () => {
      document.removeEventListener('keydown', escape);
      window.removeEventListener('blur', cancel);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [finish]);

  useEffect(() => {
    // A filter/date change or an external edit invalidates the captured order.
    if (drag.current && (disabled || drag.current.signature !== signature)) queueMicrotask(() => finish(false));
  }, [disabled, signature, finish]);

  const updateTarget = () => {
    const active = drag.current;
    if (!active?.moved) return;
    const pageY = active.clientY + window.scrollY;
    const to = active.centers.reduce((closest, center, index) =>
      Math.abs(center - pageY) < Math.abs(active.centers[closest] - pageY) ? index : closest, active.from);
    if (to === active.to) return;
    active.to = to;
    const ids = active.items.map(task => task.id);
    ids.splice(to, 0, ids.splice(active.from, 1)[0]);
    setPreview({id: active.items[active.from].id, ids});
  };

  const autoScroll = () => {
    const active = drag.current;
    if (!active?.moved) return;
    const edge = 88;
    const distance = active.clientY < edge ? active.clientY - edge
      : active.clientY > window.innerHeight - edge ? active.clientY - window.innerHeight + edge : 0;
    if (distance) {window.scrollBy(0, Math.sign(distance) * Math.min(16, Math.abs(distance) / 4)); updateTarget();}
    frame.current = requestAnimationFrame(autoScroll);
  };

  const handleProps = (task: Task) => ({
    onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
      if (disabled || items.length < 2 || event.button !== 0 || !event.isPrimary) return;
      const list = event.currentTarget.closest('.task-list');
      const rows = Array.from(list?.querySelectorAll<HTMLElement>('[data-task-id]') ?? []);
      const centers = items.map(item => {
        const rect = rows.find(row => row.dataset.taskId === item.id)?.getBoundingClientRect();
        return rect ? window.scrollY + rect.top + rect.height / 2 : NaN;
      });
      if (centers.some(center => !Number.isFinite(center))) return;
      event.preventDefault();
      event.currentTarget.focus({preventScroll: true});
      event.currentTarget.setPointerCapture(event.pointerId);
      const from = items.findIndex(item => item.id === task.id);
      drag.current = {pointerId: event.pointerId, handle: event.currentTarget, items, centers, from, to: from,
        startY: event.clientY, clientY: event.clientY, moved: false, signature, commit};
    },
    onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      active.clientY = event.clientY;
      if (!active.moved && Math.abs(event.clientY - active.startY) < 6) return;
      if (!active.moved) {
        active.moved = true;
        setPreview({id: task.id, ids: active.items.map(item => item.id)});
        frame.current = requestAnimationFrame(autoScroll);
      }
      updateTarget();
    },
    onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {if (drag.current?.pointerId === event.pointerId) finish(true);},
    onPointerCancel() {finish(false);},
    onLostPointerCapture(event: ReactPointerEvent<HTMLButtonElement>) {
      const active = drag.current;
      if (active?.pointerId === event.pointerId && !active.handle.hasPointerCapture(active.pointerId)) finish(false);
    },
  });

  const orderedItems = preview ? preview.ids.map(id => items.find(task => task.id === id)).filter((task): task is Task => Boolean(task)) : items;
  return {orderedItems, draggingId: preview?.id, handleProps};
}
