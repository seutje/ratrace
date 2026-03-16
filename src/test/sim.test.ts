import { createBlankWorld, createStarterWorld } from '../sim/world';
import { advanceWorld, stepWorld } from '../sim/stepWorld';
import { ticksPerSecond } from '../sim/constants';
import { BuildingKind, AgentState, TileType, WorldState } from '../sim/types';
import { findPath } from '../sim/pathfinding';
import { getCongestionSpeedFactor } from '../sim/traffic';
import { setTile, tileCenter, toClockNumber } from '../sim/utils';

const stepTimes = (world: WorldState, ticks: number) => {
  let current = world;
  for (let index = 0; index < ticks; index += 1) {
    current = stepWorld(current);
  }
  return current;
};

describe('world generation', () => {
  it('creates the same starter world for the same seed', () => {
    expect(createStarterWorld(11)).toEqual(createStarterWorld(11));
  });

  it('includes expected primitives and defaults', () => {
    const world = createStarterWorld(7);

    expect(ticksPerSecond).toBe(60);
    expect(toClockNumber(world.minutesOfDay)).toBe(700);
    expect(world.entities.agents[0]?.state).toBe(AgentState.Idle);
    expect(world.metrics.mapVersion).toBe(1);
  });
});

describe('simulation time', () => {
  it('advances one game hour after 60 ticks', () => {
    const world = stepTimes(createStarterWorld(7), 60);
    expect(toClockNumber(world.minutesOfDay)).toBe(800);
  });

  it('rolls over from 23:00 to 00:00 and increments the day', () => {
    const world = createStarterWorld(7);
    world.minutesOfDay = 23 * 60;

    const next = stepTimes(world, 60);
    expect(toClockNumber(next.minutesOfDay)).toBe(0);
    expect(next.day).toBe(2);
  });

  it('is independent of render frame count for the same elapsed budget', () => {
    const initial = createStarterWorld(7);
    const oneChunk = advanceWorld(initial, 1000, 0);

    let multiChunkWorld = initial;
    let carry = 0;
    for (let index = 0; index < 10; index += 1) {
      const advanced = advanceWorld(multiChunkWorld, 100, carry);
      multiChunkWorld = advanced.world;
      carry = advanced.carryMs;
    }

    expect(multiChunkWorld).toEqual(oneChunk.world);
  });
});

describe('agent behavior', () => {
  it('moves through workday states in order', () => {
    let world = createStarterWorld(7);
    world.minutesOfDay = 8 * 60 + 50;

    const states = new Set<AgentState>();
    for (let index = 0; index < 900; index += 1) {
      world = stepWorld(world);
      states.add(world.entities.agents[0]!.state);
    }

    expect(states.has(AgentState.MovingToWork)).toBe(true);
    expect(states.has(AgentState.Working)).toBe(true);
    expect(states.has(AgentState.MovingHome)).toBe(true);
    expect(states.has(AgentState.Sleeping)).toBe(true);
  });

  it('moves an agent incrementally instead of teleporting', () => {
    let world = createStarterWorld(7);
    world.minutesOfDay = 8 * 60 + 59;
    const start = world.entities.agents[0]!.pos;

    world = stepWorld(world);
    const afterOneTick = world.entities.agents[0]!.pos;
    const workplace = world.entities.buildings.find((building) => building.id === world.entities.agents[0]!.workId)!;
    const distanceAfterOneTick = Math.hypot(afterOneTick.x - start.x, afterOneTick.y - start.y);
    const distanceToTarget = Math.hypot(workplace.tile.x + 0.5 - afterOneTick.x, workplace.tile.y + 0.5 - afterOneTick.y);

    expect(distanceAfterOneTick).toBeGreaterThan(0);
    expect(distanceToTarget).toBeGreaterThan(0);
  });

  it('keeps path computations stable while destination does not change', () => {
    let world = createStarterWorld(7);
    world.minutesOfDay = 9 * 60;

    world = stepWorld(world);
    const count = world.entities.agents[0]!.routeComputeCount;
    world = stepTimes(world, 5);

    expect(world.entities.agents[0]!.routeComputeCount).toBe(count);
  });
});

describe('pathfinding', () => {
  it('finds a simple path on a small grid', () => {
    const world = createBlankWorld(4, 4);
    const path = findPath(world, { x: 0, y: 0 }, { x: 3, y: 0 });

    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('prefers the starter road corridor over a shorter off-road shortcut when roads are cheaper', () => {
    const world = createStarterWorld(7);
    const path = findPath(world, { x: 3, y: 9 }, { x: 14, y: 9 });

    expect(path).not.toBeNull();
    expect(path).toContainEqual({ x: 3, y: 8 });
    expect(path).toContainEqual({ x: 3, y: 6 });
    expect(path).toContainEqual({ x: 14, y: 6 });
    expect(path).toContainEqual({ x: 14, y: 8 });
  });

  it('returns null when the goal is blocked off', () => {
    const world = createBlankWorld(3, 3);
    setTile(world, { x: 1, y: 0 }, { x: 1, y: 0, type: TileType.Blocked });
    setTile(world, { x: 0, y: 1 }, { x: 0, y: 1, type: TileType.Blocked });
    setTile(world, { x: 1, y: 1 }, { x: 1, y: 1, type: TileType.Blocked });

    const path = findPath(world, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).toBeNull();
  });
});

describe('economy', () => {
  it('pays wages during work and deducts wallet during shopping', () => {
    let world = createStarterWorld(7);
    const agent = world.entities.agents[0]!;
    agent.pos = tileCenter(world.entities.buildings.find((building) => building.id === agent.workId)!.tile);
    agent.state = AgentState.Working;
    world.minutesOfDay = 9 * 60;
    const initialWallet = agent.wallet;

    world = stepWorld(world);
    const afterWork = world.entities.agents[0]!;
    expect(afterWork.wallet).toBeGreaterThan(initialWallet);

    const shop = world.entities.buildings.find((building) => building.kind === BuildingKind.Commercial)!;
    afterWork.pos = tileCenter(shop.tile);
    afterWork.stats.hunger = 90;
    world.minutesOfDay = 18 * 60;

    world = stepWorld(world);
    expect(world.entities.agents[0]!.wallet).toBeLessThan(afterWork.wallet);
  });

  it('prevents shopping when wallet is zero', () => {
    let world = createStarterWorld(7);
    const agent = world.entities.agents[0]!;
    const shop = world.entities.buildings.find((building) => building.kind === BuildingKind.Commercial)!;
    agent.wallet = 0;
    agent.stats.hunger = 100;
    agent.pos = tileCenter(shop.tile);
    world.minutesOfDay = 18 * 60;

    world = stepWorld(world);

    expect(world.entities.buildings.find((building) => building.id === shop.id)!.stock).toBe(shop.stock);
    expect(world.entities.agents[0]!.thought).toContain('broke');
  });
});

describe('traffic and lifecycle', () => {
  it('applies the congestion speed formula with a floor', () => {
    expect(getCongestionSpeedFactor(1, 4)).toBeCloseTo(0.75);
    expect(getCongestionSpeedFactor(2, 4)).toBeCloseTo(0.5);
    expect(getCongestionSpeedFactor(6, 4)).toBeCloseTo(0.2);
  });

  it('slows a crowded corridor compared with an uncrowded baseline', () => {
    const base = createStarterWorld(7);
    base.minutesOfDay = 9 * 60;
    const crowded = structuredClone(base) as WorldState;
    const corridor = { x: 9.5, y: 6.5 };

    crowded.entities.agents.push(
      ...Array.from({ length: 6 }, (_, index) => ({
        ...structuredClone(crowded.entities.agents[0]!),
        id: `crowd-${index}`,
        pos: corridor,
      })),
    );

    const baseAfter = stepWorld(base);
    const crowdedAfter = stepWorld(crowded);

    expect(crowdedAfter.metrics.trafficPeak).toBeGreaterThan(baseAfter.metrics.trafficPeak);
  });

  it('spawns and removes agents without leaving dangling selection', () => {
    let world = createStarterWorld(7);
    world.selectedAgentId = world.entities.agents[0]!.id;
    world.entities.agents[0]!.stats.happiness = 0;
    world.entities.agents[0]!.stats.hunger = 100;
    world.entities.agents[0]!.daysInCity = 5;
    world.minutesOfDay = 23 * 60 + 59;

    world = stepWorld(world);

    expect(world.selectedAgentId).toBeUndefined();
    expect(world.entities.agents.every((agent) => Number.isFinite(agent.pos.x) && Number.isFinite(agent.pos.y))).toBe(true);
  });

  it('remains stable over a longer deterministic soak', () => {
    const world = stepTimes(createStarterWorld(7), 4000);

    expect(world.entities.agents.length).toBeGreaterThan(0);
    expect(Number.isFinite(world.economy.totalWealth)).toBe(true);
    expect(world.entities.agents.every((agent) => Number.isFinite(agent.stats.hunger))).toBe(true);
  });
});
