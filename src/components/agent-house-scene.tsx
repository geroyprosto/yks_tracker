'use client';

import Image from 'next/image';
import {useState, type CSSProperties} from 'react';
import {ArrowUpRight, MousePointer2} from 'lucide-react';
import type {AgentHouseAgentId} from '@/lib/agent-house';
import styles from './agent-house-scene.module.css';

type Room = {
  id: AgentHouseAgentId; label: string; name: string; description: string; color: string;
  left: number; top: number; width: number; height: number; mascotX: number; mascotY: number;
};

// Coordinates are percentages of the 1536 × 1024 artwork, never of the legend.
const rooms: Room[] = [
  {id:'strategy', label:'YKS Stratejisti', name:'Kütüphane', description:'Hedeflerini ve çalışma yöntemini birlikte incele.', color:'#a9d4f2', left:9, top:10.8, width:26.1, height:33.7, mascotX:22, mascotY:43},
  {id:'tracking', label:'YKSİM Takipçisi', name:'Kayıt odası', description:'Çalışma kayıtlarını ve ilerleme tablolarını aç.', color:'#b4dfbd', left:37.1, top:10.8, width:25.7, height:33.7, mascotX:50, mascotY:43},
  {id:'discovery', label:'Keşif', name:'Fikir atölyesi', description:'Sana uygun kaynaklara ve yeni fikirlere göz at.', color:'#d2c0f5', left:65.1, top:10.8, width:25.8, height:33.7, mascotX:78, mascotY:43},
  {id:'awareness', label:'Öz Farkındalık', name:'Dinlenme odası', description:'Odak ve günlük düzen için küçük adımları keşfet.', color:'#f2b7c4', left:9, top:48.1, width:26.1, height:37.5, mascotX:22, mascotY:85.4},
  {id:'leader', label:'Lider', name:'Buluşma odası', description:'Ekibin ortak değerlendirmesini ve ilk adımını gör.', color:'#f5d58e', left:37.1, top:48.1, width:25.7, height:37.5, mascotX:50, mascotY:85.4},
  {id:'daily', label:'Günlük Rehber', name:'Planlama odası', description:'Günlük programını ve çalışma bloklarını aç.', color:'#f6bd93', left:65.1, top:48.1, width:25.8, height:37.5, mascotX:78, mascotY:85.4},
];

type SceneStyle = CSSProperties & Record<`--${string}`, string>;

function roomStyle(room: Room): SceneStyle {
  return {
    '--room-accent':room.color,
    '--hit-left':`${room.left}%`, '--hit-width':`${room.width}%`,
    // 1cqw is one percent of the world width. The artwork is exactly 3:2.
    '--hit-top':`${room.top * 2 / 3}cqw`, '--hit-height':`${room.height * 2 / 3}cqw`,
  };
}

export function AgentHouseScene({selected, onSelect, readyIds = [], reduceMotion = false}: {
  selected: AgentHouseAgentId;
  onSelect: (id: AgentHouseAgentId) => void;
  readyIds?: AgentHouseAgentId[];
  reduceMotion?: boolean;
}) {
  const [hovered, setHovered] = useState<AgentHouseAgentId | null>(null);
  const [focused, setFocused] = useState<AgentHouseAgentId | null>(null);
  const active = rooms.find(room => room.id === (hovered ?? focused ?? selected)) ?? rooms[4];
  return <div className={styles.scene} data-testid="agent-house-scene" data-reduced={reduceMotion}>
    <div className={styles.world}>
      <div className={styles.canvas}>
        <Image className={styles.house} src="/agent-house/pixel-house-v1.png" alt="" fill sizes="(max-width:760px) 100vw, 1060px" loading="eager" draggable={false}/>
        <div className={styles.atmosphere} aria-hidden="true">
          <span className={styles.firelight}/><span className={styles.lamplight}/><span className={styles.twinkle}/><span className={styles.twinkle}/>
        </div>
        {rooms.map((room, index) => <div key={room.id} className={styles.mascot} data-mascot-id={room.id} data-selected={selected === room.id} style={{left:`${room.mascotX}%`, top:`${room.mascotY}%`, '--mascot-duration':`${4 + index * .35}s`, '--mascot-delay':`${index * -.65}s`, '--room-accent':room.color} as SceneStyle} aria-hidden="true">
          <span className={styles.mascotShadow}/>
          <Image className={styles.mascotBody} data-testid={`agent-mascot-${room.id}`} src={`/agent-house/mascot-${room.id}-v1.png`} alt="" width={1254} height={1254} sizes="(max-width:520px) 40px, (max-width:1000px) 80px, 100px" loading="eager" draggable={false}/>
          <span className={styles.mascotSpark}/>
        </div>)}
      </div>
      <nav className={styles.rooms} aria-label="Evin odaları">
        {rooms.map((room, index) => <button key={room.id} type="button" style={roomStyle(room)} className={styles.roomButton}
          aria-label={`${room.label} odası`} aria-pressed={selected === room.id} data-room-id={room.id}
          onPointerEnter={() => setHovered(room.id)} onPointerLeave={() => setHovered(null)}
          onFocus={() => setFocused(room.id)} onBlur={() => setFocused(null)} onClick={() => onSelect(room.id)}>
          <span className={styles.floorTarget} data-testid={`agent-room-floor-${room.id}`} aria-hidden="true"><span className={styles.floorNumber}>{String(index + 1).padStart(2,'0')}</span><span className={styles.floorAction}>Raporu aç <ArrowUpRight size={13}/></span></span>
          <span className={styles.roomNumber} aria-hidden="true">{String(index + 1).padStart(2,'0')}</span>
          <span className={styles.roomCopy}><strong>{room.label}</strong><small>{room.name}</small></span>
          <span className={styles.dot} data-ready={readyIds.includes(room.id)} aria-label={readyIds.includes(room.id) ? 'Rapor hazır' : 'Odayı incele'}/>
          <ArrowUpRight className={styles.roomArrow} size={17} aria-hidden="true"/>
        </button>)}
      </nav>
      <div className={styles.caption} style={{'--room-accent':active.color} as SceneStyle}>
        <MousePointer2 size={16} aria-hidden="true"/><p><strong>{active.label}</strong><span>{active.description}</span></p>
        <span className={styles.hint}>Odaya ya da adına dokun</span>
      </div>
    </div>
  </div>;
}
