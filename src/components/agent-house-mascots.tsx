'use client';

import Image from 'next/image';
import {useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode} from 'react';
import {Hand, Pause, PencilLine, Play} from 'lucide-react';
import type {AgentHouseAgentId} from '@/lib/agent-house';
import {getHouseFrame, HOUSE_DOORS} from '@/lib/agent-house-motion';
import {agentRooms} from './agent-house-meta';
import styles from './agent-house-scene.module.css';

const FRAME_INTERVAL = 160;
const REDUCED = 1;
const HIDDEN = 2;

function environmentSnapshot() {
  return (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reduced === 'true' ? REDUCED : 0)
    | (document.visibilityState === 'hidden' ? HIDDEN : 0);
}

function serverEnvironmentSnapshot() { return 0; }

function subscribeEnvironment(notify: () => void) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const observer = new MutationObserver(notify);
  preference.addEventListener('change', notify);
  document.addEventListener('visibilitychange', notify);
  observer.observe(document.documentElement, {attributes:true, attributeFilter:['data-reduced']});
  return () => {
    preference.removeEventListener('change', notify);
    document.removeEventListener('visibilitychange', notify);
    observer.disconnect();
  };
}

// Only active, visible time advances the decorative scene. Pausing retains the
// last displayed frame, so returning from another tab cannot fast-forward it.
function useSceneTime(running: boolean) {
  const elapsed = useRef(0);
  const [time, setTime] = useState(0);
  useEffect(() => {
    if (!running) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      elapsed.current += Math.min(now - previous, FRAME_INTERVAL * 2);
      previous = now;
      setTime(elapsed.current);
    }, FRAME_INTERVAL);
    return () => window.clearInterval(timer);
  }, [running]);
  return time;
}

type MotionStyle = CSSProperties & Record<`--${string}`, string>;

export function AgentHouseMascots({children, selected, rooms, reduceMotion, onSelect}: {
  children: ReactNode;
  selected: AgentHouseAgentId;
  rooms: ReadonlyArray<{id: AgentHouseAgentId; color: string}>;
  reduceMotion: boolean;
  onSelect: (id: AgentHouseAgentId) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const environment = useSyncExternalStore(subscribeEnvironment, environmentSnapshot, serverEnvironmentSnapshot);
  const reduced = reduceMotion || Boolean(environment & REDUCED);
  const running = !reduced && !userPaused && inView && !(environment & HIDDEN);
  const motion = reduced ? 'reduced' : running ? 'running' : 'paused';
  const time = useSceneTime(running);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting && entry.intersectionRatio > 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <>
    <div className={styles.canvas} ref={canvas} data-motion={motion}>
      {children}
      <div className={styles.motionLayer} data-testid="agent-house-motion" data-motion={motion}>
        {HOUSE_DOORS.map(door => <span key={door.id} className={styles.doorway} aria-hidden="true" data-door-id={door.id} data-orientation={door.orientation} style={{left:`${door.x}%`, top:`${door.y}%`}}/>)}
        {getHouseFrame(time).map((frame, index) => <button key={frame.id} type="button" className={styles.mascot} aria-label={`${agentRooms[frame.id].name} notunu aç`} onClick={() => onSelect(frame.id)}
          data-mascot-id={frame.id} data-mascot-state={reduced ? 'idle' : frame.state} data-target-room={frame.targetRoom} data-selected={selected === frame.id}
          style={{'--mascot-x':`${frame.x}cqw`, '--mascot-y':`${frame.y * 2 / 3}cqw`, '--mascot-facing':frame.facing === 'left' ? '-1' : '1', '--mascot-delay':`${index * -.31}s`, '--room-accent':rooms.find(room => room.id === frame.id)?.color ?? '#f5d58e', zIndex:Math.round(frame.y)} as MotionStyle}>
          <div className={styles.mascotFigure}>
            <span className={styles.mascotShadow}/>
            <span className={styles.mascotPose}>
              <Image className={styles.mascotBody} data-testid={`agent-mascot-${frame.id}`} src={`/agent-house/mascot-${frame.id}-v1.png`} alt="" width={1254} height={1254} sizes="(max-width:520px) 40px, (max-width:1000px) 80px, 100px" loading="eager" draggable={false}/>
            </span>
            <span className={styles.mascotSpark}/>
            {!reduced && frame.state === 'working' && <span className={styles.activityBubble} data-activity="working"><PencilLine size={13}/><i/></span>}
            {!reduced && frame.state === 'visiting' && <span className={styles.activityBubble} data-activity="visiting"><Hand size={13}/></span>}
          </div>
        </button>)}
      </div>
    </div>
    <div className={styles.motionControls}>
      <button type="button" className={styles.motionToggle} disabled={reduced} aria-label={userPaused || reduced ? 'Hareketi başlat' : 'Hareketi durdur'} title={userPaused || reduced ? 'Hareketi başlat' : 'Hareketi durdur'} onClick={() => setUserPaused(value => !value)}>
        {userPaused || reduced ? <Play size={14} aria-hidden="true"/> : <Pause size={14} aria-hidden="true"/>}
      </button>
    </div>
  </>;
}
