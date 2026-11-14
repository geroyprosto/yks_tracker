import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentHouseAgentId } from '../src/lib/agent-house';
import { getHouseFrame, HOUSE_CYCLE_MS, HOUSE_DOORS } from '../src/lib/agent-house-motion';

const home = {
  strategy: [22, 43], tracking: [50, 43], discovery: [78, 43],
  awareness: [22, 85.4], leader: [50, 85.4], daily: [78, 85.4],
} satisfies Record<AgentHouseAgentId, [number, number]>;

test('the motion model starts at home and repeats without a loop jump', () => {
  const opening = getHouseFrame(0);
  assert.equal(opening.length, 6);
  assert.equal(new Set(opening.map(actor => actor.id)).size, 6);
  for (const actor of opening) {
    assert.deepEqual([actor.x, actor.y], home[actor.id]);
    assert.equal(actor.state, 'idle');
    assert.equal(actor.targetRoom, actor.id);
  }
  for (const invalid of [-10, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.deepEqual(getHouseFrame(invalid), opening);
  }
  assert.deepEqual(getHouseFrame(HOUSE_CYCLE_MS - 1), opening);
  assert.deepEqual(getHouseFrame(HOUSE_CYCLE_MS), opening);
  assert.deepEqual(getHouseFrame(HOUSE_CYCLE_MS * 127 + 33000), getHouseFrame(33000));
});

test('movement stays on the credited floor lanes and crosses partitions only at doorways', () => {
  const stepMs = 20;
  let prior = getHouseFrame(0);
  for (let time = stepMs; time <= HOUSE_CYCLE_MS; time += stepMs) {
    const frame = getHouseFrame(time);
    for (const [index, actor] of frame.entries()) {
      const old = prior[index];
      const distance = Math.hypot(actor.x - old.x, (actor.y - old.y) * 2 / 3);
      assert.ok(distance <= 5 * stepMs / 1000, `${actor.id} jumped at ${time}ms`);
      const upstairs = home[actor.id][1] < 50;
      assert.ok(actor.x >= 9 && actor.x <= 91);
      assert.ok(upstairs ? actor.y >= 34 && actor.y <= 43 : actor.y >= 73 && actor.y <= 85.4);
      for (const wall of [36.1, 64]) {
        if ((old.x < wall && actor.x >= wall) || (old.x > wall && actor.x <= wall)) {
          assert.equal(actor.state, 'walking');
          assert.ok(HOUSE_DOORS.some(door => door.x === wall && door.y === actor.y && old.y === door.y),
            `${actor.id} crossed ${wall} outside a door at ${time}ms`);
        }
      }
    }
    prior = frame;
  }
});

test('each mascot works, visits a neighboring host alone, then returns home', () => {
  const worked = new Set<AgentHouseAgentId>();
  const revisitedDesks = new Set<AgentHouseAgentId>();
  const visiting = new Set<AgentHouseAgentId>();
  const returned = new Set<AgentHouseAgentId>();
  for (let time = 0; time < HOUSE_CYCLE_MS; time += 250) {
    const actors = getHouseFrame(time);
    const guests = actors.filter(actor => actor.state === 'visiting');
    const traveling = actors.filter(actor => actor.targetRoom !== actor.id);
    assert.ok(traveling.length <= 1, `multiple guests at ${time}ms`);
    for (const guest of guests) {
      const host = actors.find(actor => actor.id === guest.targetRoom)!;
      assert.notEqual(guest.id, host.id);
      assert.equal(host.state, 'working');
      assert.ok(Math.abs(home[guest.id][0] - home[host.id][0]) === 28);
      visiting.add(guest.id);
    }
    for (const actor of actors) {
      if (actor.state === 'working') {
        assert.equal(actor.targetRoom, actor.id);
        if (time < 60_000) worked.add(actor.id);
        if (returned.has(actor.id)) revisitedDesks.add(actor.id);
      }
      if (visiting.has(actor.id) && actor.state === 'idle' && actor.x === home[actor.id][0] && actor.y === home[actor.id][1]) {
        returned.add(actor.id);
      }
    }
  }
  assert.equal(worked.size, 6);
  assert.equal(visiting.size, 6);
  assert.equal(returned.size, 6);
  assert.ok(revisitedDesks.size >= 4, 'early visitors keep working after returning');
});
