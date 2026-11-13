'use client';

import type {CSSProperties, ReactNode} from 'react';
import type {AgentHouseAgentId} from '@/lib/agent-house';
import styles from './agent-house-scene.module.css';

type Room = {id: AgentHouseAgentId; label: string; name: string; x: number; y: number; color: string; floor: string; wall: string};

const rooms: Room[] = [
  {id: 'strategy', label: 'YKS Stratejisti', name: 'Kütüphane', x: 0, y: 0, color: '#a9c9e8', floor: '#7e817c', wall: '#445c68'},
  {id: 'tracking', label: 'YKSİM Takipçisi', name: 'Kayıt odası', x: 200, y: 0, color: '#9ad9c4', floor: '#848779', wall: '#48675b'},
  {id: 'discovery', label: 'Keşif', name: 'Atölye', x: 400, y: 0, color: '#c4b6ef', floor: '#807883', wall: '#62536f'},
  {id: 'awareness', label: 'Öz Farkındalık', name: 'Dinlenme odası', x: 0, y: 200, color: '#e7b4b5', floor: '#aa8876', wall: '#795c60'},
  {id: 'leader', label: 'Lider', name: 'Ortak çalışma odası', x: 200, y: 200, color: '#f0d39a', floor: '#a38b67', wall: '#796445'},
  {id: 'daily', label: 'Günlük Rehber', name: 'Planlama odası', x: 400, y: 200, color: '#edba91', floor: '#a38a76', wall: '#79634c'},
];

const point = (x: number, y: number, z = 0): [number, number] => [420 + (x - y) * .86, 100 + (x + y) * .44 - z];
const points = (...values: [number, number][]) => values.map(value => value.join(',')).join(' ');
function shade(hex: string, multiplier: number) {
  const rgb = [1, 3, 5].map(index => Math.min(255, Math.round(parseInt(hex.slice(index, index + 2), 16) * multiplier)));
  return `#${rgb.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

function Tile({x, y, width, depth, z = 0, fill, ...rest}: {
  x: number; y: number; width: number; depth: number; z?: number; fill: string;
  stroke?: string; strokeWidth?: number; strokeDasharray?: string; opacity?: number;
}) {
  return <polygon points={points(point(x, y, z), point(x + width, y, z), point(x + width, y + depth, z), point(x, y + depth, z))} fill={fill} {...rest}/>;
}

function Box({x, y, width, depth, height, z = 0, fill}: {
  x: number; y: number; width: number; depth: number; height: number; z?: number; fill: string;
}) {
  return <g>
    <polygon points={points(point(x, y + depth, z), point(x + width, y + depth, z), point(x + width, y + depth, z + height), point(x, y + depth, z + height))} fill={shade(fill, .69)}/>
    <polygon points={points(point(x + width, y, z), point(x + width, y + depth, z), point(x + width, y + depth, z + height), point(x + width, y, z + height))} fill={shade(fill, .84)}/>
    <Tile x={x} y={y} width={width} depth={depth} z={z + height} fill={fill}/>
  </g>;
}

function Plant({x, y, tall = false}: {x: number; y: number; tall?: boolean}) {
  const [cx, cy] = point(x + 8, y + 8, tall ? 40 : 23);
  return <g>
    <Box x={x} y={y} width={16} depth={16} height={tall ? 18 : 11} fill="#bd8b64"/>
    <path d={`M${cx} ${cy + 16}v-22`} stroke="#6d8461" strokeWidth="3"/>
    <ellipse cx={cx - 7} cy={cy - 3} rx="7" ry="14" fill="#7a9a69" transform={`rotate(-36 ${cx - 7} ${cy - 3})`}/>
    <ellipse cx={cx + 7} cy={cy - 10} rx="7" ry="14" fill="#aac18b" transform={`rotate(35 ${cx + 7} ${cy - 10})`}/>
    <ellipse cx={cx - 3} cy={cy - 15} rx="6" ry="12" fill="#8bab74"/>
  </g>;
}

function Bookshelf({x, y, fill = '#a27c58'}: {x: number; y: number; fill?: string}) {
  const books = ['#e4b981', '#9fbdc1', '#d6a0a2', '#b7c49d', '#c0b1cb'];
  return <g>
    <Box x={x} y={y} width={75} depth={16} height={61} fill={fill}/>
    {[12, 33].map(z => <g key={z}>
      <Box x={x + 4} y={y + 15} width={67} depth={2} height={19} z={z} fill="#4a3b36"/>
      {Array.from({length: 9}, (_, index) => <Box key={index} x={x + 7 + index * 7} y={y + 15} width={5} depth={3} height={12 + index % 3 * 2} z={z + 2} fill={books[(index + z) % books.length]}/>)}
      <Box x={x + 2} y={y + 14} width={72} depth={5} height={3} z={z - 2} fill={shade(fill, 1.15)}/>
    </g>)}
  </g>;
}

function Chair({x, y, color}: {x: number; y: number; color: string}) {
  return <g><Box x={x + 4} y={y + 4} width={16} depth={16} height={13} fill="#4f4541"/>
    <Box x={x} y={y} width={25} depth={24} height={7} z={13} fill={color}/>
    <Box x={x} y={y + 21} width={25} depth={5} height={25} z={13} fill={shade(color, .92)}/></g>;
}

function Desk({x, y, color, screen = false}: {x: number; y: number; color: string; screen?: boolean}) {
  return <g>
    {[0, 70].flatMap(dx => [0, 32].map(dy => <Box key={`${dx}-${dy}`} x={x + dx} y={y + dy} width={6} depth={6} height={27} fill="#655043"/>))}
    <Box x={x - 4} y={y - 3} width={84} depth={45} height={5} z={27} fill="#d5b18a"/>
    <Tile x={x + 36} y={y + 9} width={25} depth={20} z={32.1} fill="#f5e8ca"/>
    {[14, 19, 24].map(dy => <Tile key={dy} x={x + 40} y={y + dy} width={16} depth={1} z={32.2} fill="#a2947e"/>)}
    {screen ? <g><Box x={x + 6} y={y + 6} width={25} depth={2} height={19} z={32} fill="#4c5960"/>
      <Box x={x + 8} y={y + 8} width={21} depth={.5} height={14} z={35} fill={color}/>
      <Tile x={x + 4} y={y + 9} width={29} depth={16} z={32.3} fill="#748086"/></g>
      : <Box x={x + 5} y={y + 6} width={22} depth={28} height={4} z={32} fill={color}/>}
    <Chair x={x + 27} y={y + 50} color={color}/>
  </g>;
}

function Agent({x, y, color}: {x: number; y: number; color: string}) {
  const [cx, cy] = point(x, y);
  return <g className={styles.agent}>
    <ellipse cx={cx} cy={cy} rx="13" ry="6" fill="#241e1b" opacity=".2"/>
    <path d={`M${cx - 4} ${cy - 15}l-2 13m10-13 2 13`} stroke="#3c4350" strokeWidth="5" strokeLinecap="round"/>
    <path d={`M${cx - 7} ${cy - 30}q7-4 14 0l2 15h-18z`} fill={color}/>
    <path d={`M${cx - 8} ${cy - 27}l-4 12m20-12 4 12`} stroke="#d6a380" strokeWidth="4" strokeLinecap="round"/>
    <circle cx={cx} cy={cy - 38} r="7" fill="#e9bc96"/>
    <path d={`M${cx - 7} ${cy - 38}q-2-12 9-9 8 2 5 12l-4-7-10 4z`} fill="#4b3733"/>
  </g>;
}

function Furniture({room}: {room: Room}) {
  const {x, y, id, color} = room;
  let scene: ReactNode;
  if (id === 'awareness') {
    scene = <><Plant x={x + 16} y={y + 16} tall/>
      <Box x={x + 62} y={y + 25} width={91} depth={34} height={19} fill="#c99093"/>
      <Box x={x + 60} y={y + 22} width={95} depth={9} height={35} fill="#bb858d"/>
      <Box x={x + 60} y={y + 30} width={9} depth={33} height={29} fill="#d9a0a0"/>
      <Box x={x + 146} y={y + 30} width={9} depth={33} height={29} fill="#d9a0a0"/>
      <Box x={x + 76} y={y + 35} width={25} depth={22} height={5} z={19} fill="#e2bfa8"/>
      <Box x={x + 104} y={y + 36} width={29} depth={21} height={4} z={19} fill="#bc8c98"/>
      <Tile x={x + 44} y={y + 77} width={103} depth={53} z={1} fill="#7f8580" stroke="#d1b595" strokeWidth={2}/>
      <Box x={x + 76} y={y + 82} width={44} depth={26} height={17} fill="#cda77d"/>
      <Box x={x + 86} y={y + 89} width={19} depth={12} height={3} z={17} fill="#e2cfa9"/>
      <Agent x={x + 146} y={y + 108} color={color}/></>;
  } else if (id === 'strategy') {
    scene = <><Bookshelf x={x + 17} y={y + 8}/><Bookshelf x={x + 101} y={y + 8} fill="#8d785f"/>
      <Tile x={x + 35} y={y + 71} width={112} depth={70} z={1} fill="#596b7e" stroke="#c2b79b" strokeWidth={2}/>
      <Desk x={x + 42} y={y + 58} color={color}/><Agent x={x + 147} y={y + 85} color={color}/></>;
  } else if (id === 'tracking') {
    scene = <><Box x={x + 24} y={y + 8} width={42} depth={20} height={55} fill="#93aaa1"/>
      {[11, 29, 47].map(z => <Box key={z} x={x + 29} y={y + 28} width={31} depth={2} height={2} z={z} fill="#d0c8aa"/>)}
      <Desk x={x + 60} y={y + 45} color={color} screen/>
      <Plant x={x + 151} y={y + 18}/><Agent x={x + 29} y={y + 101} color={color}/></>;
  } else if (id === 'discovery') {
    scene = <><Bookshelf x={x + 87} y={y + 8} fill="#93859b"/>
      <Desk x={x + 30} y={y + 54} color={color} screen/>
      <Box x={x + 145} y={y + 76} width={25} depth={24} height={31} fill="#838099"/>
      <Box x={x + 151} y={y + 82} width={13} depth={13} height={16} z={31} fill="#c7b7a0"/>
      <Plant x={x + 16} y={y + 17}/><Agent x={x + 144} y={y + 123} color={color}/></>;
  } else if (id === 'leader') {
    scene = <><Bookshelf x={x + 92} y={y + 8}/>
      <Tile x={x + 23} y={y + 54} width={132} depth={98} z={1} fill="#7a6652" stroke="#cba77b" strokeWidth={3}/>
      <Desk x={x + 43} y={y + 58} color={color}/><Plant x={x + 20} y={y + 15} tall/>
      <Agent x={x + 151} y={y + 106} color={color}/></>;
  } else {
    const [bx, by] = point(x + 88, y + 8, 43);
    scene = <><polygon points={points(point(x + 81, y + 7, 55), point(x + 158, y + 7, 55), point(x + 158, y + 7, 17), point(x + 81, y + 7, 17))} fill="#dac7a8" stroke="#9a754f" strokeWidth="3"/>
      {[0, 1, 2, 3].map(index => <g key={index} transform={`translate(${bx + index * 14} ${by + index * 7.15})`}><path d="M0 0l10 5v12l-10-5z" fill={['#bc8e78', '#91a69e', '#b49ebc', '#b8a175'][index]}/></g>)}
      <Desk x={x + 39} y={y + 65} color={color}/><Plant x={x + 19} y={y + 17} tall/>
      <Agent x={x + 147} y={y + 103} color={color}/></>;
  }
  return <g>{scene}</g>;
}

export function AgentHouseScene({selected, onSelect, readyIds = []}: {
  selected: AgentHouseAgentId;
  onSelect: (id: AgentHouseAgentId) => void;
  readyIds?: AgentHouseAgentId[];
}) {
  const roomButton = (room: Room, overlay: boolean) => {
    const [cx, cy] = point(room.x + 95, room.y + 151);
    const position: CSSProperties & {'--room-accent': string} = {
      ...(overlay ? {left: `${cx / 1000 * 100}%`, top: `${(cy + 15) / 590 * 100}%`} : {}),
      '--room-accent': room.color,
    };
    return <button key={room.id} type="button" className={overlay ? styles.hotspot : styles.roomButton}
      style={position}
      aria-pressed={selected === room.id} onClick={() => onSelect(room.id)}
      aria-label={`${room.label} odası`} data-room-id={room.id}>
      <span className={`${styles.dot} ${readyIds.includes(room.id) ? styles.ready : ''}`} aria-hidden="true"/>
      <span>{room.label}</span><span className={styles.roomName}>{room.name}</span>
    </button>;
  };

  return <div className={styles.scene} data-testid="agent-house-scene">
    <div className={styles.canvas}>
      <svg viewBox="0 0 1000 590" className={styles.house} aria-hidden="true" focusable="false">
        <ellipse cx="510" cy="375" rx="381" ry="151" fill="#191b17" opacity=".14"/>
        <Box x={-17} y={-17} width={616} depth={404} height={13} z={-21} fill="#6e5a48"/>
        <Tile x={-17} y={-17} width={616} depth={404} z={-8} fill="#493e37"/>
        {[...rooms].sort((a, b) => (a.x + a.y) - (b.x + b.y)).map(room => <g key={room.id} className={`${styles.room} ${selected === room.id ? styles.selectedRoom : ''}`}>
          <Tile x={room.x} y={room.y} width={180} depth={170} fill={room.floor}/>
          {Array.from({length: 10}, (_, index) => <g key={index}>
            <Tile x={room.x} y={room.y + index * 17} width={180} depth={1} z={.2} fill="#493e35" opacity={.2}/>
            {[0, 1].map(seam => <Tile key={seam} x={room.x + 30 + seam * 85 + (index % 2) * 36} y={room.y + index * 17} width={1} depth={17} z={.3} fill="#493e35" opacity={.17}/>)}
          </g>)}
          <Box x={room.x - 6} y={room.y - 6} width={186} depth={6} height={63} fill={room.wall}/>
          <Box x={room.x - 6} y={room.y} width={6} depth={170} height={63} fill={shade(room.wall, .95)}/>
          <Box x={room.x - 7} y={room.y - 7} width={188} depth={8} height={4} z={63} fill="#aa8d70"/>
          <Box x={room.x - 7} y={room.y - 1} width={8} depth={172} height={4} z={63} fill="#aa8d70"/>
          <Box x={room.x + 1} y={room.y} width={179} depth={2} height={6} fill="#b49371"/>
          <Box x={room.x} y={room.y + 1} width={2} depth={169} height={6} fill="#b49371"/>
          <Furniture room={room}/>
          <Box x={room.x} y={room.y + 170} width={180} depth={5} height={7} fill="#b69b7b"/>
          <Box x={room.x + 180} y={room.y} width={5} depth={175} height={7} fill="#a48769"/>
          <Tile x={room.x + 2} y={room.y + 2} width={175} depth={165} z={8} fill="none" stroke={room.color} strokeWidth={3} opacity={selected === room.id ? .95 : 0}/>
        </g>)}
        <Plant x={-42} y={310} tall/><Plant x={603} y={345} tall/>
        <Box x={268} y={389} width={90} depth={23} height={5} z={-9} fill="#b6a182"/>
        <Box x={268} y={412} width={90} depth={20} height={5} z={-15} fill="#9e8b74"/>
      </svg>
      <div className={styles.hotspots}>{rooms.map(room => roomButton(room, true))}</div>
    </div>
    <div className={styles.mobileRooms} aria-label="Evin odaları">{rooms.map(room => roomButton(room, false))}</div>
  </div>;
}
