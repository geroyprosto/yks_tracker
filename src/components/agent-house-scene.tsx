'use client';

import Image from 'next/image';
import type {CSSProperties} from 'react';
import type {AgentHouseAgentId} from '@/lib/agent-house';
import {AgentHouseMascots} from './agent-house-mascots';
import styles from './agent-house-scene.module.css';

type Room = {
  id: AgentHouseAgentId; label: string; name: string; description: string; color: string;
  left: number; top: number; width: number; height: number;
};

// Coordinates are percentages of the 1536 × 1024 artwork, never of the legend.
const rooms: Room[] = [
  {id:'strategy', label:'YKS Stratejisti', name:'Kütüphane', description:'Hedeflerini ve çalışma yöntemini birlikte incele.', color:'#a9d4f2', left:9, top:10.8, width:26.1, height:33.7},
  {id:'tracking', label:'YKSİM Takipçisi', name:'Kayıt odası', description:'Çalışma kayıtlarını ve ilerleme tablolarını aç.', color:'#b4dfbd', left:37.1, top:10.8, width:25.7, height:33.7},
  {id:'discovery', label:'Keşif', name:'Fikir atölyesi', description:'Sana uygun kaynaklara ve yeni fikirlere göz at.', color:'#d2c0f5', left:65.1, top:10.8, width:25.8, height:33.7},
  {id:'awareness', label:'Öz Farkındalık', name:'Dinlenme odası', description:'Odak ve günlük düzen için küçük adımları keşfet.', color:'#f2b7c4', left:9, top:48.1, width:26.1, height:37.5},
  {id:'leader', label:'Lider', name:'Buluşma odası', description:'Ekibin ortak değerlendirmesini ve ilk adımını gör.', color:'#f5d58e', left:37.1, top:48.1, width:25.7, height:37.5},
  {id:'daily', label:'Günlük Rehber', name:'Planlama odası', description:'Günlük programını ve çalışma bloklarını aç.', color:'#f6bd93', left:65.1, top:48.1, width:25.8, height:37.5},
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
  return <div className={styles.scene} data-testid="agent-house-scene" data-reduced={reduceMotion}>
    <div className={styles.world}>
      <AgentHouseMascots selected={selected} rooms={rooms} reduceMotion={reduceMotion}>
        <Image className={styles.house} src="/agent-house/pixel-house-v1.png" alt="" fill sizes="(max-width:760px) 100vw, 1060px" loading="eager" draggable={false}/>
        <div className={styles.atmosphere} aria-hidden="true">
          <span className={styles.firelight}/><span className={styles.lamplight}/><span className={styles.twinkle}/><span className={styles.twinkle}/>
        </div>
      </AgentHouseMascots>
      <nav className={styles.rooms} aria-label="Evin odaları">
        {rooms.map(room => <button key={room.id} type="button" style={roomStyle(room)} className={styles.roomButton}
          aria-label={`${room.label} odası`} aria-pressed={selected === room.id} data-room-id={room.id}
          onClick={() => onSelect(room.id)}>
          <span className={styles.floorTarget} data-testid={`agent-room-floor-${room.id}`} aria-hidden="true"/>
          <span className={styles.roomCopy}>{room.label}</span>
          <span className={styles.dot} data-ready={readyIds.includes(room.id)} aria-label={readyIds.includes(room.id) ? 'Rapor hazır' : 'Odayı incele'}/>
        </button>)}
      </nav>
    </div>
  </div>;
}
