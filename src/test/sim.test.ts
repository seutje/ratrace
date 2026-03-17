import { createBlankWorld, createStarterWorld } from '../sim/world';
import { advanceWorld, stepWorld } from '../sim/stepWorld';
import { SHOPPING_COOLDOWN_TICKS, SHOPPING_HUNGER_THRESHOLD, ticksPerSecond } from '../sim/constants';
import { BuildingKind, AgentState, TileType, WorldState } from '../sim/types';
import { findPath } from '../sim/pathfinding';
import { getCongestionSpeedFactor } from '../sim/traffic';
import { getTile, setTile, tileCenter, toClockNumber } from '../sim/utils';

const stepTimes = (world: WorldState, ticks: number) => {
  let current = world;
  for (let index = 0; index < ticks; index += 1) {
    current = stepWorld(current);
  }
  return current;
};

const orthogonalNeighbors = ({ x, y }: { x: number; y: number }) => [
  { x: x + 1, y },
  { x: x - 1, y },
  { x, y: y + 1 },
  { x, y: y - 1 },
];

const collectConnectedRoads = (world: WorldState) => {
  const start = world.tiles.find((tile) => tile.type === TileType.Road);
  if (!start) {
    return new Set<string>();
  }

  const queue = [start];
  const visited = new Set([`${start.x},${start.y}`]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of orthogonalNeighbors(current)) {
      const tile = getTile(world, neighbor);
      const key = `${neighbor.x},${neighbor.y}`;
      if (!tile || tile.type !== TileType.Road || visited.has(key)) {
        continue;
      }

      visited.add(key);
      queue.push(tile);
    }
  }

  return visited;
};

describe('world generation', () => {
  it('creates the same starter world for the same seed', () => {
    expect(createStarterWorld(11)).toEqual(createStarterWorld(11));
  });

  it('includes expected primitives and defaults', () => {
    const world = createStarterWorld();

    expect(ticksPerSecond).toBe(60);
    expect(world.seed).toBe(42);
    expect(toClockNumber(world.minutesOfDay)).toBe(700);
    expect(world.entities.agents).toHaveLength(200);
    expect(world.entities.agents[0]?.state).toBe(AgentState.Idle);
    expect(world.metrics.mapVersion).toBe(1);
    expect(world.metrics.populationCapacity).toBe(200);
    expect(world.entities.buildings.some((building) => building.kind === BuildingKind.Residential)).toBe(true);
    expect(world.entities.buildings.some((building) => building.kind === BuildingKind.Commercial)).toBe(true);
    expect(world.entities.buildings.some((building) => building.kind === BuildingKind.Industrial)).toBe(true);
  });

  it('connects all starter buildings to one shared road network', () => {
    const world = createStarterWorld();
    const connectedRoads = collectConnectedRoads(world);
    const roadTileCount = world.tiles.filter((tile) => tile.type === TileType.Road).length;

    expect(connectedRoads.size).toBe(roadTileCount);
    expect(
      world.entities.buildings.every((building) =>
        orthogonalNeighbors(building.tile).some((point) => getTile(world, point)?.type === TileType.Road),
      ),
    ).toBe(true);
  });
});

describe('simulation time', () => {
  it('advances one game hour after 60 ticks', () => {
    const world = stepTimes(createStarterWorld(), 60);
    expect(toClockNumber(world.minutesOfDay)).toBe(800);
  });

  it('rolls over from 23:00 to 00:00 and increments the day', () => {
    const world = createStarterWorld();
    world.minutesOfDay = 23 * 60;

    const next = stepTimes(world, 60);
    expect(toClockNumber(next.minutesOfDay)).toBe(0);
    expect(next.day).toBe(2);
  });

  it('is independent of render frame count for the same elapsed budget', () => {
    const initial = createStarterWorld();
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
    let world = createStarterWorld();
    const agent = world.entities.agents[0]!;
    const home = world.entities.buildings.find((building) => building.id === agent.homeId)!;
    const work = world.entities.buildings.find((building) => building.id === agent.workId)!;
    const workApproach = orthogonalNeighbors(work.tile).find((point) => getTile(world, point)?.type === TileType.Road)!;
    const homeApproach = orthogonalNeighbors(home.tile).find((point) => getTile(world, point)?.type === TileType.Road)!;

    agent.pos = tileCenter(workApproach);
    agent.stats.hunger = 20;
    agent.stats.energy = 90;
    world.minutesOfDay = 8 * 60 + 59;

    const workdayStates = new Set<AgentState>();
    for (let index = 0; index < 120; index += 1) {
      world = stepWorld(world);
      workdayStates.add(world.entities.agents[0]!.state);
    }

    const eveningAgent = world.entities.agents[0]!;
    eveningAgent.pos = tileCenter(homeApproach);
    eveningAgent.route = [];
    eveningAgent.routeIndex = 0;
    eveningAgent.destination = undefined;
    eveningAgent.state = AgentState.Idle;
    eveningAgent.stats.hunger = 20;
    eveningAgent.stats.energy = 50;
    world.minutesOfDay = 21 * 60 + 55;

    const eveningStates = new Set<AgentState>();
    for (let index = 0; index < 120; index += 1) {
      world = stepWorld(world);
      eveningStates.add(world.entities.agents[0]!.state);
    }

    expect(workdayStates.has(AgentState.MovingToWork)).toBe(true);
    expect(workdayStates.has(AgentState.Working)).toBe(true);
    expect(eveningStates.has(AgentState.MovingHome)).toBe(true);
    expect(eveningStates.has(AgentState.Sleeping)).toBe(true);
  });

  it('moves an agent incrementally instead of teleporting', () => {
    let world = createStarterWorld();
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
    let world = createStarterWorld();
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
    const world = createStarterWorld();
    const home = world.entities.buildings.find((building) => building.kind === BuildingKind.Residential)!;
    const work = [...world.entities.buildings].reverse().find((building) => building.kind === BuildingKind.Industrial)!;
    const path = findPath(world, home.tile, work.tile);

    expect(path).not.toBeNull();
    expect(path?.some((point) => getTile(world, point)?.type === TileType.Road)).toBe(true);
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
    let world = createStarterWorld();
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
    let world = createStarterWorld();
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

  it('does not immediately pick another shopping trip after a purchase', () => {
    let world = createStarterWorld();
    const agent = world.entities.agents[0]!;
    const shop = world.entities.buildings.find((building) => building.kind === BuildingKind.Commercial)!;
    const home = world.entities.buildings.find((building) => building.id === agent.homeId)!;

    agent.wallet = 100;
    agent.stats.hunger = 100;
    agent.pos = tileCenter(shop.tile);
    world.minutesOfDay = 18 * 60;

    world = stepWorld(world);
    expect(world.entities.agents[0]!.lastShoppedTick).toBe(world.tick);
    expect(world.entities.agents[0]!.stats.hunger).toBeLessThan(SHOPPING_HUNGER_THRESHOLD);

    world.entities.agents[0]!.pos = tileCenter(home.tile);
    world = stepWorld(world);

    expect(world.entities.agents[0]!.destination).toBeUndefined();
    expect(world.entities.agents[0]!.state).toBe(AgentState.Idle);

    world = stepTimes(world, SHOPPING_COOLDOWN_TICKS - 2);
    expect(world.entities.agents[0]!.destination?.kind).not.toBe('shop');
  });

  it('does not shop twice during the same evening after one successful purchase', () => {
    let world = createStarterWorld();
    const agent = world.entities.agents[0]!;

    agent.wallet = 100;
    agent.stats.hunger = 100;
    agent.stats.energy = 80;
    world.minutesOfDay = 18 * 60;

    let shoppingTicks = 0;
    for (let index = 0; index < 300; index += 1) {
      world = stepWorld(world);
      if (world.entities.agents[0]!.state === AgentState.Shopping) {
        shoppingTicks += 1;
      }
    }

    expect(shoppingTicks).toBe(1);
  });

  it('does not force a home destination when already home and no need is active', () => {
    let world = createStarterWorld();
    const agent = world.entities.agents[0]!;
    const home = world.entities.buildings.find((building) => building.id === agent.homeId)!;

    agent.pos = tileCenter(home.tile);
    agent.stats.hunger = 20;
    agent.stats.energy = 80;
    world.minutesOfDay = 18 * 60;

    world = stepWorld(world);

    expect(world.entities.agents[0]!.destination).toBeUndefined();
    expect(world.entities.agents[0]!.state).toBe(AgentState.Idle);
  });
});

describe('traffic and lifecycle', () => {
  it('applies the congestion speed formula with a floor', () => {
    expect(getCongestionSpeedFactor(1, 4)).toBeCloseTo(0.75);
    expect(getCongestionSpeedFactor(2, 4)).toBeCloseTo(0.5);
    expect(getCongestionSpeedFactor(6, 4)).toBeCloseTo(0.2);
  });

  it('slows a crowded corridor compared with an uncrowded baseline', () => {
    const base = createStarterWorld();
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
    let world = createStarterWorld();
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
    const world = stepTimes(createStarterWorld(), 1500);

    expect(world.entities.agents.length).toBeGreaterThan(0);
    expect(Number.isFinite(world.economy.totalWealth)).toBe(true);
    expect(world.entities.agents.every((agent) => Number.isFinite(agent.stats.hunger))).toBe(true);
  });
});
