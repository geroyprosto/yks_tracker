import type { AgentHouseAgentId } from './agent-house';

type Point = { x: number; y: number };
type Facing = 'left' | 'right';
type Activity = 'idle' | 'walking' | 'working' | 'visiting';
type Door = Point & { id: string; orientation: 'horizontal' | 'vertical' };

export type MascotFrame = Point & {
  id: AgentHouseAgentId;
  state: Activity;
  targetRoom: AgentHouseAgentId;
  facing: Facing;
};

export const HOUSE_CYCLE_MS = 180_000;

// Foot positions and door centers are percentages of the 1536 × 1024 artwork.
export const HOUSE_DOORS = [
  { id: 'library-records', x: 36.1, y: 40, orientation: 'vertical' },
  { id: 'records-workshop', x: 64, y: 40, orientation: 'vertical' },
  { id: 'lounge-common', x: 36.1, y: 81, orientation: 'vertical' },
  { id: 'common-planning', x: 64, y: 81, orientation: 'vertical' },
] as const satisfies readonly Door[];

const routines = [
  { id: 'strategy', home: { x: 22, y: 43 }, desk: { x: 22.5, y: 34 }, wander: { x: 27, y: 41.7 }, visitAt: 26_000, guest: 'tracking', guestX: 43.5, door: HOUSE_DOORS[0] },
  { id: 'tracking', home: { x: 50, y: 43 }, desk: { x: 50, y: 34 }, wander: { x: 55, y: 41.7 }, visitAt: 51_000, guest: 'discovery', guestX: 71.5, door: HOUSE_DOORS[1] },
  { id: 'discovery', home: { x: 78, y: 43 }, desk: { x: 84, y: 34 }, wander: { x: 73, y: 41.7 }, visitAt: 76_000, guest: 'tracking', guestX: 57.5, door: HOUSE_DOORS[1] },
  { id: 'awareness', home: { x: 22, y: 85.4 }, desk: { x: 22, y: 74 }, wander: { x: 27, y: 83.5 }, visitAt: 101_000, guest: 'leader', guestX: 43, door: HOUSE_DOORS[2] },
  { id: 'leader', home: { x: 50, y: 85.4 }, desk: { x: 50, y: 76 }, wander: { x: 45, y: 83.5 }, visitAt: 126_000, guest: 'daily', guestX: 72, door: HOUSE_DOORS[3] },
  { id: 'daily', home: { x: 78, y: 85.4 }, desk: { x: 78, y: 73 }, wander: { x: 83, y: 83.5 }, visitAt: 151_000, guest: 'leader', guestX: 57.5, door: HOUSE_DOORS[3] },
] as const;

type Routine = typeof routines[number];
type Segment = {
  start: number; end: number; from: Point; to: Point;
  state: Activity; targetRoom: AgentHouseAgentId; facing: Facing;
};

const workingMs = 15_000;
const visitingMs = 5_000;
const wanderRestMs = 900;
const speed = 4.75;

function walkingTime(from: Point, to: Point) {
  // Y percentages cover two thirds the onscreen distance of X percentages.
  return Math.hypot(to.x - from.x, (to.y - from.y) * 2 / 3) * 1000 / speed;
}

function buildTimeline(room: Routine, index: number): Segment[] {
  let at = 0;
  let position: Point = room.home;
  let facing: Facing = 'right';
  const segments: Segment[] = [];

  function append(to: Point, duration: number, state: Activity, targetRoom: AgentHouseAgentId = room.id) {
    if (duration <= 0) return;
    if (to.x !== position.x) facing = to.x > position.x ? 'right' : 'left';
    segments.push({ start: at, end: at + duration, from: position, to, state, targetRoom, facing });
    at += duration;
    position = to;
  }

  function walk(to: Point, targetRoom: AgentHouseAgentId = room.id) {
    append(to, walkingTime(position, to), 'walking', targetRoom);
  }

  function work() {
    walk(room.desk);
    append(room.desk, workingMs, 'working');
    walk(room.home);
  }

  function wander() {
    walk(room.wander);
    append(room.wander, wanderRestMs, 'idle');
    walk(room.home);
  }

  function visit() {
    const lane = { x: room.home.x, y: room.door.y };
    const stop = { x: room.guestX, y: room.door.y };
    walk(lane, room.guest);
    walk(room.door, room.guest);
    walk(stop, room.guest);
    append(stop, visitingMs, 'visiting', room.guest);
    walk(room.door);
    walk(lane);
    walk(room.home);
  }

  const events = [
    { time: 1_250 + index * 1_150, run: work },
    { time: 20_500 + index * 1_100, run: wander },
    { time: room.visitAt, run: visit },
    ...routines.filter(visitor => visitor.guest === room.id).map(visitor => ({ time: visitor.visitAt + 1_250, run: work })),
  ].sort((a, b) => a.time - b.time);

  const workRoundTrip = 2 * walkingTime(room.home, room.desk) + workingMs;
  const wanderRoundTrip = 2 * walkingTime(room.home, room.wander) + wanderRestMs;
  const pause = 4_000 + index * 150;

  function fillGap(until: number) {
    // Leave the mascot at home before each scheduled event, including the loop.
    while (at + 2 * pause + workRoundTrip <= until) {
      append(room.home, pause, 'idle');
      work();
      if (at + 2 * pause + wanderRoundTrip <= until) {
        append(room.home, pause, 'idle');
        wander();
      }
    }
    append(room.home, until - at, 'idle');
  }

  for (const event of events) {
    fillGap(event.time);
    event.run();
  }
  fillGap(HOUSE_CYCLE_MS);
  // Keep the resting pose consistent across the loop boundary.
  segments[0].facing = facing;
  return segments;
}

const timelines = routines.map((room, index) => ({ id: room.id, segments: buildTimeline(room, index) }));

export function getHouseFrame(elapsedMs: number): MascotFrame[] {
  const time = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs % HOUSE_CYCLE_MS : 0;
  return timelines.map(({ id, segments }) => {
    const segment = segments.find(candidate => time < candidate.end) ?? segments[segments.length - 1];
    const { start, end, from, to, state, targetRoom, facing } = segment;
    const progress = (time - start) / (end - start);
    return {
      id, state, targetRoom, facing,
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
    };
  });
}
