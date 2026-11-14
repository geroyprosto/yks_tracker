'use client';

import Image from 'next/image';
import {useEffect, useRef, type ReactNode} from 'react';
import {X} from 'lucide-react';
import type {AgentHouseAgentId} from '@/lib/agent-house';
import {agentRooms} from './agent-house-meta';
import styles from './agent-house.module.css';

export function AgentHouseRoom({selected, sample, onClose, children}: {
  selected: AgentHouseAgentId; sample: boolean; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const room = agentRooms[selected];
  useEffect(() => {
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    heading.current?.focus();
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
    };
  }, []);

  return <dialog ref={dialog} className={styles.roomDialog} data-room={selected} data-testid="agent-room-report" aria-labelledby="agent-report-heading"
    onCancel={event => {event.preventDefault(); onClose();}}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),summary,input:not(:disabled),textarea:not(:disabled),[href],[tabindex="0"]'))
        .filter(element => element.getClientRects().length > 0);
      const first = controls[0]; const last = controls.at(-1);
      const active = document.activeElement;
      if (!controls.includes(active as HTMLElement) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <div className={styles.notebook}>
      <button className={styles.close} type="button" aria-label="Eve dön" title="Eve dön" onClick={onClose}><X size={20} aria-hidden="true"/></button>
      <header className={styles.noteHeader}>
        <Image src={`/agent-house/mascot-${selected}-v1.png`} width={84} height={84} alt="" className={styles.portrait}/>
        <div><span className={styles.noteFrom}>{room.name}{sample ? ' · Örnek rapor' : ''}</span><h2 id="agent-report-heading" ref={heading} tabIndex={-1}>{room.title}</h2></div>
      </header>
      {children}
    </div>
  </dialog>;
}
