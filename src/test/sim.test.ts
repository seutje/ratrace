import { createBlankWorld, createStarterWorld } from '../sim/world';
import { advanceWorld, stepWorld } from '../sim/stepWorld';
import {
  SLEEP_MINIMUM_MINUTES,
  STARTER_POPULATION,
  SHOPPING_COOLDOWN_TICKS,
  SHOPPING_HUNGER_THRESHOLD,
  WORK_SHIFT_MINUTES,
  ticksPerSecond,
} from '../sim/constants';
import { BuildingKind, AgentState, TileType, WorldState } from '../sim/types';
import { findPath } from '../sim/pathfinding';
import { getCongestionSpeedFactor } from '../sim/traffic';
import { getAgentTrafficKey, getRouteTargetPoint } from '../sim/lanes';
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

const makeTestAgent = (overrides: Partial<WorldState['entities']['agents'][number]> = {}) => ({
  id: 'test-agent',
  name: 'Test Agent',
  pos: { x: 0.5, y: 0.5 },
  wallet: 20,
  stats: { hunger: 20, energy: 80, happiness: 70 },
  homeId: 'home',
  workId: 'work',
  state: AgentState.Idle,
  thought: 'Testing.',
  route: [],
  routeIndex: 0,
  routeComputeCount: 0,
  routeMapVersion: 0,
  destination: undefined,
  lastShoppedTick: undefined,
  sleepUntilTick: undefined,
  shiftDay: 0,
  shiftWorkMinutes: 0,
  paidShiftWorkMinutes: 0,
  lastCompletedShiftDay: 0,
  daysInCity: 0,
  ...overrides,
});

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

const getCenterDistance = (world: WorldState, { x, y }: { x: number; y: number }) =>
  Math.hypot(x - (world.width - 1) / 2, y - (world.height - 1) / 2);

const getEdgeBias = (world: WorldState, { x, y }: { x: number; y: number }) =>
  Math.max(Math.abs(x - (world.width - 1) / 2) / ((world.width - 1) / 2), Math.abs(y - (world.height - 1) / 2) / ((world.height - 1) / 2));

const nearestDistanceToKind = (
  world: WorldState,
  building: WorldState['entities']['buildings'][number],
  kind: BuildingKind,
) =>
  Math.min(
    ...world.entities.buildings
      .filter((candidate) => candidate.kind === kind)
      .map((candidate) => Math.hypot(candidate.tile.x - building.tile.x, candidate.tile.y - building.tile.y)),
  );

describe('world generation', () => {
  it('creates the same starter world for the same seed', () => {
    expect(createStarterWorld(11)).toEqual(createStarterWorld(11));
  });

  it('includes expected primitives and defaults', () => {
    const world = createStarterWorld();

    expect(ticksPerSecond).toBe(60);
    expect(world.seed).toBe(42);
    expect(toClockNumber(world.minutesOfDay)).toBe(700);
    expect(world.entities.agents).toHaveLength(STARTER_POPULATION);
    expect(world.entities.agents[0]?.state).toBe(AgentState.Idle);
    expect(world.metrics.mapVersion).toBe(1);
    expect(world.metrics.populationCapacity).toBeGreaterThanOrEqual(STARTER_POPULATION);
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

  it('keeps mixed-use zoning in the center and industry in outer clusters', () => {
    const world = createStarterWorld();
    const residential = world.entities.buildings.filter((building) => building.kind === BuildingKind.Residential);
    const commercial = world.entities.buildings.filter((building) => building.kind === BuildingKind.Commercial);
    const industrial = world.entities.buildings.filter((building) => building.kind === BuildingKind.Industrial);
    const centerRadius = Math.min(world.width, world.height) * 0.2;
    const averageCenterDistance = (buildings: typeof residential) =>
      buildings.reduce((sum, building) => sum + getCenterDistance(world, building.tile), 0) / buildings.length;
    const centerResidential = residential.filter((building) => getCenterDistance(world, building.tile) <= centerRadius);
    const centerCommercial = commercial.filter((building) => getCenterDistance(world, building.tile) <= centerRadius);
    const outerIndustry = industrial.filter((building) => getEdgeBias(world, building.tile) >= 0.7);
    const residentialNearIndustry = residential.filter(
      (building) => nearestDistanceToKind(world, building, BuildingKind.Industrial) <= 3.5,
    );
    const industrialQuadrants = new Set(
      industrial.map((building) =>
        `${building.tile.x < (world.width - 1) / 2 ? 'W' : 'E'}${building.tile.y < (world.height - 1) / 2 ? 'N' : 'S'}`,
      ),
    );

    expect(centerResidential.length).toBeGreaterThanOrEqual(Math.floor(residential.length * 0.25));
    expect(centerCommercial.length).toBeGreaterThanOrEqual(Math.floor(commercial.length * 0.25));
    expect(averageCenterDistance(residential)).toBeLessThan(averageCenterDistance(industrial));
    expect(averageCenterDistance(commercial)).toBeLessThan(averageCenterDistance(industrial));
    expect(outerIndustry.length).toBeGreaterThanOrEqual(Math.floor(industrial.length / 2));
    expect(industrialQuadrants.size).toBeGreaterThanOrEqual(4);
    expect(residentialNearIndustry.length).toBeGreaterThanOrEqual(Math.max(10, Math.floor(residential.length * 0.08)));
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
    eveningAgent.shiftDay = world.day;
    eveningAgent.shiftWorkMinutes = WORK_SHIFT_MINUTES;
    eveningAgent.paidShiftWorkMinutes = WORK_SHIFT_MINUTES;
    eveningAgent.lastCompletedShiftDay = world.day;
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

  it('keeps late agents on the job until their shift is complete', () => {
    let world = createStarterWorld();
    const agent = world.entities.agents[0]!;
    const work = world.entities.buildings.find((building) => building.id === agent.workId)!;
    const workApproach = orthogonalNeighbors(work.tile).find((point) => getTile(world, point)?.type === TileType.Road)!;

    agent.pos = tileCenter(workApproach);
    agent.stats.hunger = 20;
    agent.stats.energy = 90;
    world.minutesOfDay = 16 * 60 + 55;

    world = stepTimes(world, 30);

    expect(toClockNumber(world.minutesOfDay)).toBe(1725);
    expect(world.entities.agents[0]!.destination?.kind).toBe('work');
    expect(world.entities.agents[0]!.state).toBe(AgentState.Working);
    expect(world.entities.agents[0]!.shiftWorkMinutes).toBeGreaterThan(0);
  });

  it('keeps exhausted agents asleep until their minimum sleep block is complete', () => {
    let world = createStarterWorld();
    const agent = world.entities.agents[0]!;
    const home = world.entities.buildings.find((building) => building.id === agent.homeId)!;

    agent.pos = tileCenter(home.tile);
    agent.state = AgentState.Idle;
    agent.stats.hunger = 20;
    agent.stats.energy = 10;
    agent.shiftDay = world.day;
    agent.shiftWorkMinutes = 120;
    agent.paidShiftWorkMinutes = 120;
    agent.lastCompletedShiftDay = world.day - 1;
    world.minutesOfDay = 22 * 60;

    world = stepWorld(world);

    expect(world.entities.agents[0]!.state).toBe(AgentState.Sleeping);
    expect(world.entities.agents[0]!.sleepUntilTick).toBeGreaterThan(world.tick);

    world = stepTimes(world, SLEEP_MINIMUM_MINUTES - 2);

    expect(world.entities.agents[0]!.state).toBe(AgentState.Sleeping);
    expect(world.entities.agents[0]!.destination?.kind).toBe('home');
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

    world = stepTimes(world, 60);
    const afterWork = world.entities.agents[0]!;
    expect(afterWork.wallet).toBeGreaterThan(initialWallet);

    afterWork.shiftDay = world.day;
    afterWork.shiftWorkMinutes = WORK_SHIFT_MINUTES;
    afterWork.paidShiftWorkMinutes = WORK_SHIFT_MINUTES;
    afterWork.lastCompletedShiftDay = world.day;
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
    agent.shiftDay = world.day;
    agent.shiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.paidShiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.lastCompletedShiftDay = world.day;
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
    agent.shiftDay = world.day;
    agent.shiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.paidShiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.lastCompletedShiftDay = world.day;
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
    const shop = world.entities.buildings.find((building) => building.kind === BuildingKind.Commercial)!;

    agent.wallet = 100;
    agent.stats.hunger = 100;
    agent.stats.energy = 80;
    agent.shiftDay = world.day;
    agent.shiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.paidShiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.lastCompletedShiftDay = world.day;
    agent.pos = tileCenter(shop.tile);
    world.minutesOfDay = 18 * 60;

    let purchases = 0;
    for (let index = 0; index < 300; index += 1) {
      world = stepWorld(world);
      if (world.entities.agents[0]!.lastShoppedTick === world.tick) {
        purchases += 1;
      }
    }

    expect(purchases).toBe(1);
  });

  it('does not force a home destination when already home and no need is active', () => {
    let world = createStarterWorld();
    const agent = world.entities.agents[0]!;
    const home = world.entities.buildings.find((building) => building.id === agent.homeId)!;

    agent.pos = tileCenter(home.tile);
    agent.stats.hunger = 20;
    agent.stats.energy = 80;
    agent.shiftDay = world.day;
    agent.shiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.paidShiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.lastCompletedShiftDay = world.day;
    world.minutesOfDay = 18 * 60;

    world = stepWorld(world);

    expect(world.entities.agents[0]!.destination).toBeUndefined();
    expect(world.entities.agents[0]!.state).toBe(AgentState.Idle);
  });
});

describe('traffic and lifecycle', () => {
  it('allows multiple agents to overlap on residential tiles', () => {
    const world = createBlankWorld(2, 2);
    setTile(world, { x: 0, y: 0 }, { x: 0, y: 0, type: TileType.Residential, buildingId: 'home' });
    world.entities.buildings.push({
      id: 'home',
      kind: BuildingKind.Residential,
      tile: { x: 0, y: 0 },
      stock: 0,
      capacity: 3,
      label: 'home',
    });
    world.entities.agents.push(
      makeTestAgent({ id: 'resident-a', homeId: 'home', workId: 'home', pos: tileCenter({ x: 0, y: 0 }) }),
      makeTestAgent({ id: 'resident-b', homeId: 'home', workId: 'home', pos: tileCenter({ x: 0, y: 0 }) }),
    );

    const nextWorld = stepWorld(world);

    expect(nextWorld.entities.agents[0]!.pos).toEqual(tileCenter({ x: 0, y: 0 }));
    expect(nextWorld.entities.agents[1]!.pos).toEqual(tileCenter({ x: 0, y: 0 }));
  });

  it('uses separate lane keys for opposing traffic on the same road tile', () => {
    const world = createBlankWorld(3, 3);
    for (let x = 0; x < 3; x += 1) {
      setTile(world, { x, y: 1 }, { x, y: 1, type: TileType.Road });
    }

    const eastbound = makeTestAgent({
      pos: { x: 1.5, y: 1.5 },
      route: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      routeIndex: 1,
    });
    const westbound = makeTestAgent({
      id: 'test-agent-west',
      pos: { x: 1.5, y: 1.5 },
      route: [
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      routeIndex: 1,
    });

    expect(getAgentTrafficKey(world, eastbound)).toBe('1,1:east');
    expect(getAgentTrafficKey(world, westbound)).toBe('1,1:west');
  });

  it('targets the right-hand lane center for opposite directions', () => {
    const world = createBlankWorld(3, 3);
    for (let x = 0; x < 3; x += 1) {
      setTile(world, { x, y: 1 }, { x, y: 1, type: TileType.Road });
    }

    const eastbound = makeTestAgent({
      pos: { x: 0.5, y: 1.5 },
      route: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
      routeIndex: 1,
    });
    const westbound = makeTestAgent({
      id: 'test-agent-west',
      pos: { x: 2.5, y: 1.5 },
      route: [
        { x: 2, y: 1 },
        { x: 1, y: 1 },
      ],
      routeIndex: 1,
    });

    const eastboundTarget = getRouteTargetPoint(world, eastbound);
    const westboundTarget = getRouteTargetPoint(world, westbound);

    expect(eastboundTarget.x).toBeCloseTo(1.5);
    expect(eastboundTarget.y).toBeCloseTo(1.75);
    expect(westboundTarget.x).toBeCloseTo(1.5);
    expect(westboundTarget.y).toBeCloseTo(1.25);
  });

  it('keeps a stable lane target when an agent is exactly on the lane boundary', () => {
    const world = createBlankWorld(4, 4);
    for (let x = 0; x < 4; x += 1) {
      setTile(world, { x, y: 1 }, { x, y: 1, type: TileType.Road });
    }

    const eastbound = makeTestAgent({
      pos: { x: 1.5, y: 2 },
      route: [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 3, y: 1 },
      ],
      routeIndex: 1,
    });

    expect(getAgentTrafficKey(world, eastbound)).toBe('1,1:east');
    expect(getRouteTargetPoint(world, eastbound)).toEqual({ x: 2.5, y: 1.75 });
  });

  it('keeps road travel locked to the lane when stepping from a lane boundary', () => {
    const world = createBlankWorld(5, 3);
    setTile(world, { x: 0, y: 1 }, { x: 0, y: 1, type: TileType.Residential, buildingId: 'home' });
    setTile(world, { x: 1, y: 1 }, { x: 1, y: 1, type: TileType.Road });
    setTile(world, { x: 2, y: 1 }, { x: 2, y: 1, type: TileType.Road });
    setTile(world, { x: 3, y: 1 }, { x: 3, y: 1, type: TileType.Road });
    setTile(world, { x: 4, y: 1 }, { x: 4, y: 1, type: TileType.Industrial, buildingId: 'work' });

    world.entities.buildings.push(
      { id: 'home', kind: BuildingKind.Residential, tile: { x: 0, y: 1 }, stock: 0, capacity: 1, label: 'home' },
      { id: 'work', kind: BuildingKind.Industrial, tile: { x: 4, y: 1 }, stock: 4, capacity: 1, label: 'work' },
    );
    world.entities.agents.push(
      makeTestAgent({
        pos: { x: 1.5, y: 2 },
        homeId: 'home',
        workId: 'work',
        destination: { buildingId: 'work', kind: 'work' },
        route: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 3, y: 1 },
          { x: 4, y: 1 },
        ],
        routeIndex: 1,
        routeMapVersion: world.metrics.mapVersion,
        shiftDay: world.day,
      }),
    );

    const nextWorld = stepWorld(world);
    const movedAgent = nextWorld.entities.agents[0]!;

    expect(movedAgent.pos.x).toBeCloseTo(1.5);
    expect(movedAgent.pos.y).toBeCloseTo(1.85);
  });

  it('holds a following car at the lane boundary until the occupied road slot clears', () => {
    let world = createBlankWorld(5, 3);
    for (let x = 0; x < 5; x += 1) {
      setTile(world, { x, y: 1 }, { x, y: 1, type: TileType.Road });
    }
    setTile(world, { x: 0, y: 1 }, { x: 0, y: 1, type: TileType.Residential, buildingId: 'home' });
    setTile(world, { x: 4, y: 1 }, { x: 4, y: 1, type: TileType.Industrial, buildingId: 'work' });

    world.entities.buildings.push(
      { id: 'home', kind: BuildingKind.Residential, tile: { x: 0, y: 1 }, stock: 0, capacity: 2, label: 'home' },
      { id: 'work', kind: BuildingKind.Industrial, tile: { x: 4, y: 1 }, stock: 4, capacity: 2, label: 'work' },
    );

    world.entities.agents.push(
      makeTestAgent({
        id: 'back-car',
        pos: { x: 1.5, y: 1.75 },
        route: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 3, y: 1 },
        ],
        routeIndex: 1,
        destination: { buildingId: 'work', kind: 'work' },
        homeId: 'home',
        workId: 'work',
        shiftDay: world.day,
        routeMapVersion: world.metrics.mapVersion,
      }),
      makeTestAgent({
        id: 'front-car',
        pos: { x: 2.5, y: 1.75 },
        route: [
          { x: 2, y: 1 },
          { x: 3, y: 1 },
          { x: 4, y: 1 },
        ],
        routeIndex: 1,
        destination: { buildingId: 'work', kind: 'work' },
        homeId: 'home',
        workId: 'work',
        shiftDay: world.day,
        routeMapVersion: world.metrics.mapVersion,
      }),
    );

    world = stepTimes(world, 4);

    expect(world.entities.agents[0]!.pos.x).toBeLessThan(2);
    expect(world.entities.agents[1]!.pos.x).toBeGreaterThan(3);
  });

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
  }, 10000);
});
