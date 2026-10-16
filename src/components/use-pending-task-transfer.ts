'use client';

import {useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';
import type {Task} from '@/lib/domain/types';

type Drag = {
  task: Task; pointerId: number; handle: HTMLButtonElement; signature: string;
  startX: number; startY: number; x: number; y: number; moved: boolean;
};

function targetAt(x: number, y: number) {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-task-today-drop]')?.dataset.taskTodayDrop ?? null;
}

/** Capture the handle for mouse, pen and touch; hit-test the destination by coordinates. */
export function usePendingTaskTransfer(tasks: Task[], disabled: boolean, commit: (task: Task) => void) {
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const latestCommit = useRef(commit);
  const [preview, setPreview] = useState<{id: string; target: string | null} | null>(null);
  const signature = tasks.map(task => task.id + ':' + task.revision + ':' + task.plan_date).join(',');
  useLayoutEffect(() => {latestCommit.current = commit;}, [commit]);

  const finish = useCallback((save: boolean) => {
    const active = drag.current;
    drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setPreview(null);
    if (!active) return;
    const accepted = save && active.moved && targetAt(active.x, active.y) !== null;
    if (active.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId);
    if (accepted) latestCommit.current(active.task);
  }, []);

  useEffect(() => {
    const cancel = () => finish(false);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drag.current) {event.preventDefault(); cancel();}
    };
    document.addEventListener('keydown', escape);
    window.addEventListener('blur', cancel);
    return () => {
      document.removeEventListener('keydown', escape);
      window.removeEventListener('blur', cancel);
      const active = drag.current;
      drag.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (active?.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId);
    };
  }, [finish]);

  useEffect(() => {
    if (drag.current && (disabled || drag.current.signature !== signature)) queueMicrotask(() => finish(false));
  }, [disabled, signature, finish]);

  const updateTarget = () => {
    const active = drag.current;
    if (!active?.moved) return;
    const target = targetAt(active.x, active.y);
    setPreview(previous => previous?.id === active.task.id && previous.target === target
      ? previous : {id: active.task.id, target});
  };

  const autoScroll = () => {
    const active = drag.current;
    if (!active?.moved) return;
    const edge = 88;
    const distance = active.y < edge ? active.y - edge
      : active.y > window.innerHeight - edge ? active.y - window.innerHeight + edge : 0;
    if (distance) {window.scrollBy(0, Math.sign(distance) * Math.min(16, Math.abs(distance) / 4)); updateTarget();}
    frame.current = requestAnimationFrame(autoScroll);
  };

  const handleProps = (task: Task) => ({
    onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
      if (disabled || event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      event.currentTarget.focus({preventScroll: true});
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {task, pointerId: event.pointerId, handle: event.currentTarget, signature,
        startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false};
    },
    onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      active.x = event.clientX; active.y = event.clientY;
      if (!active.moved && Math.hypot(active.x - active.startX, active.y - active.startY) < 6) return;
      if (!active.moved) {active.moved = true; frame.current = requestAnimationFrame(autoScroll);}
      updateTarget();
    },
    onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
      if (drag.current?.pointerId !== event.pointerId) return;
      drag.current.x = event.clientX; drag.current.y = event.clientY;
      finish(!disabled && drag.current.signature === signature);
    },
    onPointerCancel() {finish(false);},
    onLostPointerCapture(event: ReactPointerEvent<HTMLButtonElement>) {
      if (drag.current?.pointerId === event.pointerId) finish(false);
    },
  });

  return {draggingId: preview?.id, dropTarget: preview?.target, handleProps};
}
