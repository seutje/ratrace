import { createBlankWorld, createStarterWorld } from '../sim/world';
import { COMMERCIAL_SHIFT_PROFILES, COMMERCIAL_WORKER_SHARE, INDUSTRIAL_SHIFT_PROFILES } from '../sim/employment';
import { advanceWorld, stepWorld } from '../sim/stepWorld';
import { paintWorldTile } from '../sim/worldMutations';
import {
  COMMERCIAL_STARTING_CASH,
  COMMERCIAL_SUBSIDY_PER_HOUR,
  HOME_PANTRY_UNITS_PER_RESIDENT,
  HOUSEHOLD_GROWTH_COST,
  INDUSTRIAL_OUTPUT_PER_HOUR,
  INDUSTRIAL_STARTING_CASH,
  INDUSTRIAL_SUBSIDY_PER_HOUR,
  RETAIL_SALES_TAX_PER_UNIT,
  SLEEP_MINIMUM_MINUTES,
  SHOP_PRICE_PER_UNIT,
  STARTER_POPULATION,
  SHOPPING_BASKET_UNITS,
  SHOPPING_COOLDOWN_TICKS,
  SHOPPING_HUNGER_THRESHOLD,
  STARTER_RESIDENTIAL_CAPACITY,
  TREASURY_RESERVE_TARGET,
  WHOLESALE_PRICE_PER_UNIT,
  WORK_SHIFT_MINUTES,
  ticksPerSecond,
} from '../sim/constants';
import { BuildingKind, AgentState, TileType, WorldState } from '../sim/types';
import { findPath } from '../sim/pathfinding';
import { getCongestionSpeedFactor } from '../sim/traffic';
import { getAgentTrafficKey, getRouteTargetPoint } from '../sim/lanes';
import { getTile, setTile, tileCenter, toClockNumber } from '../sim/utils';

const residentialLabelPattern = /^(North|South|East|West|Central) (Court|House|Heights|Terrace|Square|Row) \d{2}$/;
const commercialLabelPattern = /^(North|South|East|West|Central) (Market|Corner|Arcade|Exchange|Mart|Bazaar) \d{2}$/;
const industrialLabelPattern = /^(North|South|East|West|Central) (Works|Yard|Foundry|Depot|Mill|Plant) \d{2}$/;
const agentNamePattern = /^[A-Z][a-z]+ [A-Z][a-z]+$/;
const TEST_STARTER_POPULATION = 1000;

const stepTimes = (world: WorldState, ticks: number) => {
  let current = world;
  for (let index = 0; index < ticks; index += 1) {
    current = stepWorld(current);
  }
  return current;
};

const createTestStarterWorld = () => createStarterWorld(undefined, TEST_STARTER_POPULATION);

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
  carriedMeals: 0,
  stats: { hunger: 20, energy: 80, happiness: 70 },
  homeId: 'home',
  workId: 'work',
  state: AgentState.Idle,
  thought: 'Testing.',
  route: [],
  routeIndex: 0,
  routeComputeCount: 0,
  routeMapVersion: 0,
  commuteToWorkRoute: null,
  commuteToWorkRouteMapVersion: 0,
  commuteToHomeRoute: null,
  commuteToHomeRouteMapVersion: 0,
  destination: undefined,
  lastShoppedTick: undefined,
  sleepUntilTick: undefined,
  shiftStartMinute: 8 * 60,
  shiftDay: 0,
  shiftWorkMinutes: 0,
  paidShiftWorkMinutes: 0,
  lastCompletedShiftDay: 0,
  daysInCity: 0,
  maxHungerStreakDays: 0,
  keptMaxHungerToday: false,
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

const ensureStaffedShop = (world: WorldState, shop: WorldState['entities']['buildings'][number]) => {
  const clerk = world.entities.agents.find((agent) => agent.workId === shop.id) ?? world.entities.agents[1]!;
  clerk.workId = shop.id;
  clerk.pos = tileCenter(shop.tile);
  clerk.route = [];
  clerk.routeIndex = 0;
  clerk.shiftStartMinute = COMMERCIAL_SHIFT_PROFILES[1]!.startMinute;
  clerk.shiftDay = world.day;
  clerk.shiftWorkMinutes = 60;
  clerk.paidShiftWorkMinutes = 60;
  clerk.lastCompletedShiftDay = world.day - 1;
  clerk.destination = { buildingId: shop.id, kind: 'work' };
  clerk.state = AgentState.Working;
  return clerk;
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
    expect(world.entities.agents).toHaveLength(STARTER_POPULATION);
    expect(world.entities.agents[0]?.state).toBe(AgentState.Idle);
    expect(world.metrics.mapVersion).toBe(1);
    expect(world.metrics.populationCapacity).toBeGreaterThanOrEqual(STARTER_POPULATION);
    expect(world.entities.buildings.some((building) => building.kind === BuildingKind.Residential)).toBe(true);
    expect(world.entities.buildings.some((building) => building.kind === BuildingKind.Commercial)).toBe(true);
    expect(world.entities.buildings.some((building) => building.kind === BuildingKind.Industrial)).toBe(true);
    expect(world.entities.buildings.some((building) => building.kind === BuildingKind.Residential && building.pantryCapacity > 0)).toBe(true);
  });

  it('assigns commercial jobs and staggered shifts across the workforce', () => {
    const world = createStarterWorld();
    const buildingsById = new Map(world.entities.buildings.map((building) => [building.id, building]));
    const commercialWorkers = world.entities.agents.filter(
      (agent) => buildingsById.get(agent.workId)?.kind === BuildingKind.Commercial,
    );
    const industrialWorkers = world.entities.agents.filter(
      (agent) => buildingsById.get(agent.workId)?.kind === BuildingKind.Industrial,
    );

    expect(commercialWorkers.length).toBe(Math.round(STARTER_POPULATION * COMMERCIAL_WORKER_SHARE));
    expect(
      industrialWorkers.every((agent) =>
        INDUSTRIAL_SHIFT_PROFILES.some(
          (profile) =>
            agent.shiftStartMinute >= profile.startMinute && agent.shiftStartMinute < profile.startMinute + 60,
        ),
      ),
    ).toBe(true);
    expect(
      commercialWorkers.every((agent) =>
        COMMERCIAL_SHIFT_PROFILES.some(
          (profile) =>
            agent.shiftStartMinute >= profile.startMinute && agent.shiftStartMinute < profile.startMinute + 60,
        ),
      ),
    ).toBe(true);
    expect(new Set(industrialWorkers.map((agent) => agent.shiftStartMinute)).size).toBeGreaterThan(
      INDUSTRIAL_SHIFT_PROFILES.length,
    );
    expect(new Set(commercialWorkers.map((agent) => agent.shiftStartMinute)).size).toBeGreaterThan(
      COMMERCIAL_SHIFT_PROFILES.length,
    );
    expect(
      commercialWorkers.filter((agent) => agent.shiftStartMinute >= COMMERCIAL_SHIFT_PROFILES[1]!.startMinute).length,
    ).toBeGreaterThan(commercialWorkers.length / 2);
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

    expect(centerResidential.length).toBeGreaterThanOrEqual(Math.max(10, Math.floor(residential.length * 0.18)));
    expect(centerCommercial.length).toBeGreaterThanOrEqual(Math.floor(commercial.length * 0.25));
    expect(averageCenterDistance(residential)).toBeLessThan(averageCenterDistance(industrial));
    expect(averageCenterDistance(commercial)).toBeLessThan(averageCenterDistance(industrial));
    expect(outerIndustry.length).toBeGreaterThanOrEqual(Math.floor(industrial.length / 2));
    expect(industrialQuadrants.size).toBeGreaterThanOrEqual(4);
    expect(residentialNearIndustry.length).toBeGreaterThanOrEqual(Math.max(10, Math.floor(residential.length * 0.08)));
  });

  it('gives newly painted zones starter-style labels instead of coordinate slugs', () => {
    let world = createBlankWorld(3, 1);

    world = paintWorldTile(world, 0, 0, TileType.Residential);
    world = paintWorldTile(world, 1, 0, TileType.Commercial);
    world = paintWorldTile(world, 2, 0, TileType.Industrial);

    expect(world.entities.buildings.find((building) => building.kind === BuildingKind.Residential)?.label).toMatch(
      residentialLabelPattern,
    );
    expect(world.entities.buildings.find((building) => building.kind === BuildingKind.Commercial)?.label).toMatch(
      commercialLabelPattern,
    );
    expect(world.entities.buildings.find((building) => building.kind === BuildingKind.Industrial)?.label).toMatch(
      industrialLabelPattern,
    );
  });

  it('gives newly painted residential zones the starter home pantry size', () => {
    const world = paintWorldTile(createBlankWorld(1, 1), 0, 0, TileType.Residential);
    const home = world.entities.buildings.find((building) => building.kind === BuildingKind.Residential);

    expect(home?.capacity).toBe(STARTER_RESIDENTIAL_CAPACITY);
    expect(home?.pantryCapacity).toBe(STARTER_RESIDENTIAL_CAPACITY * HOME_PANTRY_UNITS_PER_RESIDENT);
    expect(home?.pantryStock).toBe(STARTER_RESIDENTIAL_CAPACITY * HOME_PANTRY_UNITS_PER_RESIDENT);
  });
});

describe('simulation time', () => {
  it('advances one game hour after 60 ticks', () => {
    const world = stepTimes(createTestStarterWorld(), 60);
    expect(toClockNumber(world.minutesOfDay)).toBe(800);
  });

  it('rolls over from 23:00 to 00:00 and increments the day', () => {
    const world = createTestStarterWorld();
    world.minutesOfDay = 23 * 60;

    const next = stepTimes(world, 60);
    expect(toClockNumber(next.minutesOfDay)).toBe(0);
    expect(next.day).toBe(2);
  });

  it('is independent of render frame count for the same elapsed budget', () => {
    const initial = createTestStarterWorld();
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
    let world = createTestStarterWorld();
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
    let world = createTestStarterWorld();
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
    let world = createTestStarterWorld();
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
  }, 12000);

  it('moves an agent incrementally instead of teleporting', () => {
    let world = createTestStarterWorld();
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
    let world = createTestStarterWorld();
    world.minutesOfDay = 9 * 60;

    world = stepWorld(world);
    const count = world.entities.agents[0]!.routeComputeCount;
    world = stepTimes(world, 5);

    expect(world.entities.agents[0]!.routeComputeCount).toBe(count);
  });

  it('reuses a remembered commute path on later work trips until the map changes', () => {
    const world = createBlankWorld(2, 1);
    setTile(world, { x: 0, y: 0 }, { x: 0, y: 0, type: TileType.Residential, buildingId: 'home' });
    setTile(world, { x: 1, y: 0 }, { x: 1, y: 0, type: TileType.Industrial, buildingId: 'work' });
    world.entities.buildings.push(
      {
        id: 'home',
        kind: BuildingKind.Residential,
        tile: { x: 0, y: 0 },
        cash: 0,
        stock: 0,
        capacity: 1,
        pantryStock: 2,
        pantryCapacity: 2,
        label: 'home',
      },
      {
        id: 'work',
        kind: BuildingKind.Industrial,
        tile: { x: 1, y: 0 },
        cash: INDUSTRIAL_STARTING_CASH,
        stock: 2,
        capacity: 1,
        pantryStock: 0,
        pantryCapacity: 0,
        label: 'work',
      },
    );
    world.entities.agents = [
      makeTestAgent({
        homeId: 'home',
        workId: 'work',
        pos: tileCenter({ x: 0, y: 0 }),
        stats: { hunger: 0, energy: 100, happiness: 80 },
        shiftDay: 0,
        lastCompletedShiftDay: world.day - 1,
      }),
    ];

    world.minutesOfDay = 8 * 60;
    const leavingForWork = stepWorld(world);
    expect(leavingForWork.entities.agents[0]!.routeComputeCount).toBe(1);
    expect(leavingForWork.entities.agents[0]!.commuteToWorkRoute).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);

    leavingForWork.entities.agents[0]!.pos = tileCenter({ x: 1, y: 0 });
    leavingForWork.entities.agents[0]!.destination = { buildingId: 'work', kind: 'work' };
    leavingForWork.entities.agents[0]!.route = [];
    leavingForWork.entities.agents[0]!.routeIndex = 0;
    leavingForWork.entities.agents[0]!.routeMapVersion = 0;
    leavingForWork.entities.agents[0]!.shiftDay = world.day;
    leavingForWork.entities.agents[0]!.shiftWorkMinutes = WORK_SHIFT_MINUTES;
    leavingForWork.entities.agents[0]!.paidShiftWorkMinutes = WORK_SHIFT_MINUTES;
    leavingForWork.entities.agents[0]!.lastCompletedShiftDay = world.day;
    leavingForWork.minutesOfDay = 18 * 60;

    const headingHome = stepWorld(leavingForWork);
    expect(headingHome.entities.agents[0]!.routeComputeCount).toBe(2);

    headingHome.entities.agents[0]!.pos = tileCenter({ x: 0, y: 0 });
    headingHome.entities.agents[0]!.destination = undefined;
    headingHome.entities.agents[0]!.route = [];
    headingHome.entities.agents[0]!.routeIndex = 0;
    headingHome.entities.agents[0]!.routeMapVersion = 0;
    headingHome.entities.agents[0]!.shiftDay = 0;
    headingHome.entities.agents[0]!.shiftWorkMinutes = 0;
    headingHome.entities.agents[0]!.paidShiftWorkMinutes = 0;
    headingHome.entities.agents[0]!.lastCompletedShiftDay = world.day;
    headingHome.day = world.day + 1;
    headingHome.minutesOfDay = 8 * 60;

    const nextCommute = stepWorld(headingHome);
    expect(nextCommute.entities.agents[0]!.routeComputeCount).toBe(2);
    expect(nextCommute.entities.agents[0]!.route).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it('invalidates remembered commute paths on paint without recalculating them eagerly', () => {
    let world = createBlankWorld(3, 1);
    setTile(world, { x: 0, y: 0 }, { x: 0, y: 0, type: TileType.Residential, buildingId: 'home' });
    setTile(world, { x: 1, y: 0 }, { x: 1, y: 0, type: TileType.Road });
    setTile(world, { x: 2, y: 0 }, { x: 2, y: 0, type: TileType.Industrial, buildingId: 'work' });
    world.entities.buildings.push(
      {
        id: 'home',
        kind: BuildingKind.Residential,
        tile: { x: 0, y: 0 },
        cash: 0,
        stock: 0,
        capacity: 1,
        pantryStock: 2,
        pantryCapacity: 2,
        label: 'home',
      },
      {
        id: 'work',
        kind: BuildingKind.Industrial,
        tile: { x: 2, y: 0 },
        cash: INDUSTRIAL_STARTING_CASH,
        stock: 2,
        capacity: 1,
        pantryStock: 0,
        pantryCapacity: 0,
        label: 'work',
      },
    );
    world.entities.agents = [
      makeTestAgent({
        homeId: 'home',
        workId: 'work',
        pos: tileCenter({ x: 0, y: 0 }),
        stats: { hunger: 0, energy: 100, happiness: 80 },
        shiftDay: 0,
        lastCompletedShiftDay: world.day - 1,
      }),
    ];
    world.minutesOfDay = 8 * 60;

    world = stepWorld(world);
    expect(world.entities.agents[0]!.routeComputeCount).toBe(1);
    expect(world.entities.agents[0]!.commuteToWorkRouteMapVersion).toBe(world.metrics.mapVersion);

    const painted = paintWorldTile(world, 1, 0, TileType.Road);
    expect(painted.metrics.mapVersion).toBe(world.metrics.mapVersion + 1);
    expect(painted.entities.agents[0]!.routeComputeCount).toBe(1);
    expect(painted.entities.agents[0]!.commuteToWorkRouteMapVersion).toBe(world.metrics.mapVersion);

    painted.entities.agents[0]!.pos = tileCenter({ x: 0, y: 0 });
    painted.entities.agents[0]!.destination = undefined;
    painted.entities.agents[0]!.route = [];
    painted.entities.agents[0]!.routeIndex = 0;
    painted.entities.agents[0]!.routeMapVersion = 0;
    painted.entities.agents[0]!.shiftDay = 0;
    painted.entities.agents[0]!.lastCompletedShiftDay = painted.day - 1;
    painted.minutesOfDay = 8 * 60;

    const recomputed = stepWorld(painted);
    expect(recomputed.entities.agents[0]!.routeComputeCount).toBe(2);
    expect(recomputed.entities.agents[0]!.commuteToWorkRouteMapVersion).toBe(recomputed.metrics.mapVersion);
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
    const world = createTestStarterWorld();
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
  it('pays wages during work and restocks the home pantry during shopping', () => {
    let world = createTestStarterWorld();
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
    ensureStaffedShop(world, shop);
    const home = world.entities.buildings.find((building) => building.id === afterWork.homeId)!;
    home.pantryStock = 0;
    afterWork.pos = tileCenter(shop.tile);
    afterWork.route = [];
    afterWork.routeIndex = 0;
    afterWork.destination = undefined;
    afterWork.stats.hunger = 90;
    world.minutesOfDay = 18 * 60;
    const walletBeforeShopping = afterWork.wallet;
    const shopStockBefore = shop.stock;

    world = stepWorld(world);
    expect(world.entities.agents[0]!.wallet).toBeLessThan(afterWork.wallet);
    expect(world.entities.agents[0]!.wallet).toBe(
      walletBeforeShopping - Math.min(SHOPPING_BASKET_UNITS, shopStockBefore, home.pantryCapacity) * SHOP_PRICE_PER_UNIT,
    );
    expect(world.entities.buildings.find((building) => building.id === home.id)!.pantryStock).toBeGreaterThan(0);
    expect(world.entities.buildings.find((building) => building.id === shop.id)!.stock).toBe(
      shopStockBefore - Math.min(SHOPPING_BASKET_UNITS, shopStockBefore, home.pantryCapacity),
    );
  });

  it('pays wages from employer cash instead of the treasury', () => {
    const world = createBlankWorld(2, 1);
    world.economy.treasury = 75;
    setTile(world, { x: 0, y: 0 }, { x: 0, y: 0, type: TileType.Residential, buildingId: 'home' });
    setTile(world, { x: 1, y: 0 }, { x: 1, y: 0, type: TileType.Industrial, buildingId: 'work' });
    world.entities.buildings.push(
      {
        id: 'home',
        kind: BuildingKind.Residential,
        tile: { x: 0, y: 0 },
        cash: 0,
        stock: 0,
        capacity: 1,
        pantryStock: 1,
        pantryCapacity: 2,
        label: 'home',
      },
      {
        id: 'work',
        kind: BuildingKind.Industrial,
        tile: { x: 1, y: 0 },
        cash: 20,
        stock: 3,
        capacity: 1,
        pantryStock: 0,
        pantryCapacity: 0,
        label: 'work',
      },
    );
    world.entities.agents = [
      makeTestAgent({
        homeId: 'home',
        workId: 'work',
        pos: tileCenter({ x: 1, y: 0 }),
        destination: { buildingId: 'work', kind: 'work' },
        shiftDay: world.day,
        shiftWorkMinutes: 59,
      }),
    ];
    world.minutesOfDay = 9 * 60;

    const next = stepWorld(world);

    expect(next.economy.treasury).toBe(75);
    expect(next.entities.agents[0]!.wallet).toBe(32);
    expect(next.entities.buildings.find((building) => building.id === 'work')!.cash).toBe(8);
    expect(next.entities.buildings.find((building) => building.id === 'work')!.stock).toBe(3 + INDUSTRIAL_OUTPUT_PER_HOUR);
  });

  it('routes retail revenue into shop cash and sales tax into the treasury', () => {
    const world = createBlankWorld(3, 1);
    world.economy.treasury = 10;
    setTile(world, { x: 0, y: 0 }, { x: 0, y: 0, type: TileType.Residential, buildingId: 'home' });
    setTile(world, { x: 1, y: 0 }, { x: 1, y: 0, type: TileType.Commercial, buildingId: 'shop' });
    world.entities.buildings.push(
      {
        id: 'home',
        kind: BuildingKind.Residential,
        tile: { x: 0, y: 0 },
        cash: 0,
        stock: 0,
        capacity: 1,
        pantryStock: 0,
        pantryCapacity: 4,
        label: 'home',
      },
      {
        id: 'shop',
        kind: BuildingKind.Commercial,
        tile: { x: 1, y: 0 },
        cash: 50,
        stock: 6,
        capacity: 8,
        pantryStock: 0,
        pantryCapacity: 0,
        label: 'shop',
      },
    );
    world.entities.agents = [
      makeTestAgent({
        id: 'shopper',
        homeId: 'home',
        workId: 'factory',
        wallet: 30,
        pos: tileCenter({ x: 1, y: 0 }),
        destination: { buildingId: 'shop', kind: 'shop' },
        shiftDay: world.day,
        shiftWorkMinutes: WORK_SHIFT_MINUTES,
        paidShiftWorkMinutes: WORK_SHIFT_MINUTES,
        lastCompletedShiftDay: world.day,
        stats: { hunger: 90, energy: 80, happiness: 60 },
      }),
      makeTestAgent({
        id: 'clerk',
        homeId: 'home',
        workId: 'shop',
        pos: tileCenter({ x: 1, y: 0 }),
        destination: { buildingId: 'shop', kind: 'work' },
        shiftDay: world.day,
        shiftWorkMinutes: 60,
        paidShiftWorkMinutes: 60,
        lastCompletedShiftDay: world.day - 1,
      }),
    ];
    world.minutesOfDay = 18 * 60;

    const next = stepWorld(world);

    expect(next.entities.agents.find((agent) => agent.id === 'shopper')!.wallet).toBe(10);
    expect(next.entities.buildings.find((building) => building.id === 'home')!.pantryStock).toBe(4);
    expect(next.entities.buildings.find((building) => building.id === 'shop')!.stock).toBe(2);
    expect(next.entities.buildings.find((building) => building.id === 'shop')!.cash).toBe(50 + 4 * (SHOP_PRICE_PER_UNIT - RETAIL_SALES_TAX_PER_UNIT));
    expect(next.economy.treasury).toBe(10 + 4 * RETAIL_SALES_TAX_PER_UNIT);
  });

  it('uses shop cash to buy inventory from industry during restocking', () => {
    const world = createBlankWorld(3, 1);
    setTile(world, { x: 0, y: 0 }, { x: 0, y: 0, type: TileType.Commercial, buildingId: 'shop' });
    setTile(world, { x: 1, y: 0 }, { x: 1, y: 0, type: TileType.Industrial, buildingId: 'mill' });
    world.entities.buildings.push(
      {
        id: 'shop',
        kind: BuildingKind.Commercial,
        tile: { x: 0, y: 0 },
        cash: 20,
        stock: 0,
        capacity: 4,
        pantryStock: 0,
        pantryCapacity: 0,
        label: 'shop',
      },
      {
        id: 'mill',
        kind: BuildingKind.Industrial,
        tile: { x: 1, y: 0 },
        cash: 50,
        stock: 5,
        capacity: 4,
        pantryStock: 0,
        pantryCapacity: 0,
        label: 'mill',
      },
    );
    world.minutesOfDay = 59;

    const next = stepWorld(world);

    expect(next.entities.buildings.find((building) => building.id === 'shop')!.stock).toBe(4);
    expect(next.entities.buildings.find((building) => building.id === 'shop')!.cash).toBe(20 - 4 * WHOLESALE_PRICE_PER_UNIT);
    expect(next.entities.buildings.find((building) => building.id === 'mill')!.stock).toBe(1);
    expect(next.entities.buildings.find((building) => building.id === 'mill')!.cash).toBe(50 + 4 * WHOLESALE_PRICE_PER_UNIT);
  });

  it('recirculates treasury surplus into cash-poor businesses', () => {
    const world = createBlankWorld(2, 1);
    world.economy.treasury = TREASURY_RESERVE_TARGET + 20;
    setTile(world, { x: 0, y: 0 }, { x: 0, y: 0, type: TileType.Commercial, buildingId: 'shop' });
    setTile(world, { x: 1, y: 0 }, { x: 1, y: 0, type: TileType.Industrial, buildingId: 'mill' });
    world.entities.buildings.push({
      id: 'shop',
      kind: BuildingKind.Commercial,
      tile: { x: 0, y: 0 },
      cash: COMMERCIAL_STARTING_CASH - 20,
      stock: 0,
      capacity: 4,
      pantryStock: 0,
      pantryCapacity: 0,
      label: 'shop',
    });
    world.entities.buildings.push({
      id: 'mill',
      kind: BuildingKind.Industrial,
      tile: { x: 1, y: 0 },
      cash: INDUSTRIAL_STARTING_CASH - 20,
      stock: 0,
      capacity: 4,
      pantryStock: 0,
      pantryCapacity: 0,
      label: 'mill',
    });
    world.minutesOfDay = 59;

    const next = stepWorld(world);

    expect(next.entities.buildings.find((building) => building.id === 'shop')!.cash).toBe(
      COMMERCIAL_STARTING_CASH - 20 + COMMERCIAL_SUBSIDY_PER_HOUR,
    );
    expect(next.entities.buildings.find((building) => building.id === 'mill')!.cash).toBe(
      INDUSTRIAL_STARTING_CASH - 20 + INDUSTRIAL_SUBSIDY_PER_HOUR,
    );
    expect(next.economy.treasury).toBe(
      TREASURY_RESERVE_TARGET + 20 - COMMERCIAL_SUBSIDY_PER_HOUR - INDUSTRIAL_SUBSIDY_PER_HOUR,
    );
  });

  it('prioritizes subsidy for businesses with the shortest payroll runway', () => {
    const world = createBlankWorld(2, 1);
    world.economy.treasury = TREASURY_RESERVE_TARGET + INDUSTRIAL_SUBSIDY_PER_HOUR;
    setTile(world, { x: 0, y: 0 }, { x: 0, y: 0, type: TileType.Commercial, buildingId: 'shop' });
    setTile(world, { x: 1, y: 0 }, { x: 1, y: 0, type: TileType.Industrial, buildingId: 'mill' });
    world.entities.buildings.push({
      id: 'shop',
      kind: BuildingKind.Commercial,
      tile: { x: 0, y: 0 },
      cash: 30,
      stock: 0,
      capacity: 4,
      pantryStock: 0,
      pantryCapacity: 0,
      label: 'shop',
    });
    world.entities.buildings.push({
      id: 'mill',
      kind: BuildingKind.Industrial,
      tile: { x: 1, y: 0 },
      cash: 36,
      stock: 0,
      capacity: 4,
      pantryStock: 0,
      pantryCapacity: 0,
      label: 'mill',
    });
    world.entities.agents.push(
      makeTestAgent({ id: 'clerk', workId: 'shop' }),
      makeTestAgent({ id: 'mill-1', workId: 'mill' }),
      makeTestAgent({ id: 'mill-2', workId: 'mill' }),
      makeTestAgent({ id: 'mill-3', workId: 'mill' }),
      makeTestAgent({ id: 'mill-4', workId: 'mill' }),
    );
    world.minutesOfDay = 59;

    const next = stepWorld(world);

    expect(next.entities.buildings.find((building) => building.id === 'shop')!.cash).toBe(30);
    expect(next.entities.buildings.find((building) => building.id === 'mill')!.cash).toBe(
      36 + INDUSTRIAL_SUBSIDY_PER_HOUR,
    );
    expect(next.economy.treasury).toBe(TREASURY_RESERVE_TARGET);
  });

  it('keeps the treasury stable over the first day in the starter city', () => {
    const initial = createTestStarterWorld();

    const next = stepTimes(initial, 24 * 60);

    expect(next.economy.treasury).toBeGreaterThanOrEqual(initial.economy.treasury);
  }, 25000);

  it('requires a staffed store before an agent can buy food', () => {
    let world = createTestStarterWorld();
    const customer = world.entities.agents[0]!;
    const shop = world.entities.buildings.find((building) => building.kind === BuildingKind.Commercial)!;
    const home = world.entities.buildings.find((building) => building.id === customer.homeId)!;
    customer.wallet = 100;
    customer.stats.hunger = 100;
    customer.shiftDay = world.day;
    customer.shiftWorkMinutes = WORK_SHIFT_MINUTES;
    customer.paidShiftWorkMinutes = WORK_SHIFT_MINUTES;
    customer.lastCompletedShiftDay = world.day;
    customer.pos = tileCenter(shop.tile);
    home.pantryStock = 0;
    world.entities.agents = [customer];
    world.minutesOfDay = 18 * 60;

    world = stepWorld(world);

    expect(world.entities.agents[0]!.wallet).toBe(100);
    expect(world.entities.buildings.find((building) => building.id === shop.id)!.stock).toBe(shop.stock);
    expect(world.entities.buildings.find((building) => building.id === home.id)!.pantryStock).toBe(0);
  });

  it('prevents shopping when wallet is zero', () => {
    let world = createTestStarterWorld();
    const agent = world.entities.agents[0]!;
    const shop = world.entities.buildings.find((building) => building.kind === BuildingKind.Commercial)!;
    const home = world.entities.buildings.find((building) => building.id === agent.homeId)!;
    agent.wallet = 0;
    agent.stats.hunger = 100;
    home.pantryStock = 0;
    agent.shiftDay = world.day;
    agent.shiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.paidShiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.lastCompletedShiftDay = world.day;
    agent.pos = tileCenter(shop.tile);
    world.minutesOfDay = 18 * 60;

    world = stepWorld(world);

    expect(world.entities.buildings.find((building) => building.id === shop.id)!.stock).toBe(shop.stock);
    expect(world.entities.buildings.find((building) => building.id === home.id)!.pantryStock).toBe(0);
    expect(world.entities.agents[0]!.thought).toContain('broke');
  });

  it('consumes pantry food at home after a shopping trip', () => {
    let world = createTestStarterWorld();
    const agent = world.entities.agents[0]!;
    const shop = world.entities.buildings.find((building) => building.kind === BuildingKind.Commercial)!;
    const clerk = ensureStaffedShop(world, shop);
    const home = world.entities.buildings.find((building) => building.id === agent.homeId)!;

    agent.wallet = 100;
    agent.stats.hunger = 100;
    home.pantryStock = 0;
    agent.shiftDay = world.day;
    agent.shiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.paidShiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.lastCompletedShiftDay = world.day;
    agent.pos = tileCenter(shop.tile);
    world.entities.agents = [agent, clerk];
    world.minutesOfDay = 18 * 60;

    world = stepWorld(world);
    expect(world.entities.agents[0]!.lastShoppedTick).toBe(world.tick);
    expect(world.entities.buildings.find((building) => building.id === home.id)!.pantryStock).toBeGreaterThan(0);

    world.entities.agents[0]!.pos = tileCenter(home.tile);
    world = stepWorld(world);

    expect(world.entities.agents[0]!.stats.hunger).toBeLessThan(SHOPPING_HUNGER_THRESHOLD);
    expect(world.entities.buildings.find((building) => building.id === home.id)!.pantryStock).toBeLessThan(
      Math.min(SHOPPING_BASKET_UNITS, home.pantryCapacity),
    );
  });

  it('packs a lunch whenever an awake agent is home with pantry food', () => {
    let world = createTestStarterWorld();
    const agent = world.entities.agents[0]!;
    const home = world.entities.buildings.find((building) => building.id === agent.homeId)!;

    agent.pos = tileCenter(home.tile);
    agent.wallet = 0;
    agent.stats.hunger = 20;
    agent.stats.energy = 80;
    agent.carriedMeals = 0;
    agent.shiftDay = world.day;
    agent.shiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.paidShiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.lastCompletedShiftDay = world.day;
    home.pantryStock = 1;
    world.entities.agents = [agent];
    world.minutesOfDay = 18 * 60;

    world = stepWorld(world);

    expect(world.entities.agents[0]!.carriedMeals).toBe(1);
    expect(world.entities.buildings.find((building) => building.id === home.id)!.pantryStock).toBe(0);
    expect(world.entities.agents[0]!.state).toBe(AgentState.Idle);
  });

  it('holds a packed lunch until hunger reaches 100, then consumes it away from home', () => {
    let world = createTestStarterWorld();
    const agent = world.entities.agents[0]!;
    const home = world.entities.buildings.find((building) => building.id === agent.homeId)!;
    const work = world.entities.buildings.find((building) => building.id === agent.workId)!;

    agent.pos = tileCenter(home.tile);
    agent.stats.hunger = 20;
    agent.stats.energy = 80;
    agent.carriedMeals = 0;
    home.pantryStock = home.pantryCapacity;
    world.entities.agents = [agent];
    world.minutesOfDay = agent.shiftStartMinute;

    world = stepWorld(world);

    let commutingAgent = world.entities.agents[0]!;
    expect(commutingAgent.carriedMeals).toBe(1);
    expect(world.entities.buildings.find((building) => building.id === home.id)!.pantryStock).toBe(home.pantryCapacity - 1);

    commutingAgent.pos = tileCenter(work.tile);
    commutingAgent.stats.hunger = 99;
    commutingAgent.shiftDay = world.day;
    commutingAgent.shiftWorkMinutes = 0;
    commutingAgent.paidShiftWorkMinutes = 0;
    commutingAgent.route = [];
    commutingAgent.routeIndex = 0;
    commutingAgent.destination = { buildingId: work.id, kind: 'work' };
    world = stepWorld(world);

    expect(world.entities.agents[0]!.carriedMeals).toBe(1);
    expect(world.entities.agents[0]!.stats.hunger).toBeLessThan(100);

    commutingAgent = world.entities.agents[0]!;
    commutingAgent.pos = tileCenter(work.tile);
    commutingAgent.stats.hunger = 100;
    commutingAgent.shiftDay = world.day;
    commutingAgent.shiftWorkMinutes = 0;
    commutingAgent.paidShiftWorkMinutes = 0;
    commutingAgent.route = [];
    commutingAgent.routeIndex = 0;
    commutingAgent.destination = { buildingId: work.id, kind: 'work' };
    world = stepWorld(world);

    expect(world.entities.agents[0]!.carriedMeals).toBeLessThan(commutingAgent.carriedMeals);
    expect(world.entities.agents[0]!.stats.hunger).toBeLessThan(SHOPPING_HUNGER_THRESHOLD);
    expect(world.entities.agents[0]!.state).toBe(AgentState.Working);
  });

  it('does not consume a packed lunch while sleeping', () => {
    let world = createTestStarterWorld();
    const agent = world.entities.agents[0]!;
    const home = world.entities.buildings.find((building) => building.id === agent.homeId)!;

    agent.pos = tileCenter(home.tile);
    agent.stats.hunger = 100;
    agent.stats.energy = 10;
    agent.carriedMeals = 1;
    home.pantryStock = 0;
    agent.state = AgentState.Sleeping;
    agent.sleepUntilTick = world.tick + 10;
    world.minutesOfDay = 23 * 60;

    world = stepWorld(world);

    expect(world.entities.agents[0]!.carriedMeals).toBe(1);
    expect(world.entities.agents[0]!.state).toBe(AgentState.Sleeping);
    expect(world.entities.agents[0]!.stats.hunger).toBe(100);
  });

  it('does not immediately pick another shopping trip after a purchase', () => {
    let world = createTestStarterWorld();
    const agent = world.entities.agents[0]!;
    const shop = world.entities.buildings.find((building) => building.kind === BuildingKind.Commercial)!;
    ensureStaffedShop(world, shop);
    const home = world.entities.buildings.find((building) => building.id === agent.homeId)!;

    agent.wallet = 100;
    agent.stats.hunger = 100;
    home.pantryStock = 0;
    agent.shiftDay = world.day;
    agent.shiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.paidShiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.lastCompletedShiftDay = world.day;
    agent.pos = tileCenter(shop.tile);
    world.minutesOfDay = 18 * 60;

    world = stepWorld(world);
    expect(world.entities.agents[0]!.lastShoppedTick).toBe(world.tick);

    world.entities.agents[0]!.pos = tileCenter(home.tile);
    world = stepWorld(world);

    expect(world.entities.agents[0]!.destination).toBeUndefined();
    expect(world.entities.agents[0]!.state).toBe(AgentState.Idle);

    world = stepTimes(world, SHOPPING_COOLDOWN_TICKS - 2);
    expect(world.entities.agents[0]!.destination?.kind).not.toBe('shop');
  });

  it('does not shop twice during the same evening after one successful purchase', () => {
    let world = createTestStarterWorld();
    const agent = world.entities.agents[0]!;
    const shop = world.entities.buildings.find((building) => building.kind === BuildingKind.Commercial)!;
    ensureStaffedShop(world, shop);
    const home = world.entities.buildings.find((building) => building.id === agent.homeId)!;

    agent.wallet = 100;
    agent.stats.hunger = 100;
    agent.stats.energy = 80;
    home.pantryStock = 0;
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
  }, 12000);

  it('shops from home to refill the pantry before hunger becomes urgent', () => {
    let world = createTestStarterWorld();
    const agent = world.entities.agents[0]!;
    const home = world.entities.buildings.find((building) => building.id === agent.homeId)!;
    const shop = world.entities.buildings.find((building) => building.kind === BuildingKind.Commercial)!;

    ensureStaffedShop(world, shop);

    agent.pos = tileCenter(home.tile);
    agent.wallet = 100;
    agent.stats.hunger = 20;
    agent.stats.energy = 80;
    agent.shiftDay = world.day;
    agent.shiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.paidShiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.lastCompletedShiftDay = world.day;
    home.pantryStock = Math.ceil(home.pantryCapacity * 0.75);
    world.minutesOfDay = 18 * 60;

    world = stepWorld(world);

    expect(world.entities.agents[0]!.destination?.kind).toBe('shop');
    expect(world.entities.agents[0]!.state).toBe(AgentState.MovingToShop);
  });

  it('targets the nearest staffed shop instead of a closer closed one', () => {
    let world = createTestStarterWorld();
    const customer = world.entities.agents[0]!;
    const home = world.entities.buildings.find((building) => building.id === customer.homeId)!;
    const shops = world.entities.buildings
      .filter((building) => building.kind === BuildingKind.Commercial)
      .sort(
        (left, right) =>
          Math.abs(left.tile.x - home.tile.x) +
          Math.abs(left.tile.y - home.tile.y) -
          (Math.abs(right.tile.x - home.tile.x) + Math.abs(right.tile.y - home.tile.y)),
      );
    const closedShop = shops[0]!;
    const staffedShop = shops.find((shop) => shop.id !== closedShop.id)!;
    const clerk = ensureStaffedShop(world, staffedShop);

    customer.pos = tileCenter(home.tile);
    customer.wallet = 100;
    customer.stats.hunger = 100;
    customer.stats.energy = 80;
    customer.shiftDay = world.day;
    customer.shiftWorkMinutes = WORK_SHIFT_MINUTES;
    customer.paidShiftWorkMinutes = WORK_SHIFT_MINUTES;
    customer.lastCompletedShiftDay = world.day;
    home.pantryStock = 0;
    world.entities.agents = [customer, clerk];
    world.minutesOfDay = 18 * 60;

    world = stepWorld(world);

    expect(world.entities.agents[0]!.destination).toEqual({ buildingId: staffedShop.id, kind: 'shop' });
    expect(world.entities.agents[0]!.destination?.buildingId).not.toBe(closedShop.id);
  });

  it('keeps a pantry refill trip targeted at the shop after leaving home', () => {
    let world = createTestStarterWorld();
    const agent = world.entities.agents[0]!;
    const home = world.entities.buildings.find((building) => building.id === agent.homeId)!;
    const shop = world.entities.buildings.find((building) => building.kind === BuildingKind.Commercial)!;
    const homeApproach = orthogonalNeighbors(home.tile).find((point) => getTile(world, point)?.type === TileType.Road)!;

    ensureStaffedShop(world, shop);
    agent.pos = tileCenter(homeApproach);
    agent.wallet = 100;
    agent.stats.hunger = 20;
    agent.stats.energy = 80;
    agent.shiftDay = world.day;
    agent.shiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.paidShiftWorkMinutes = WORK_SHIFT_MINUTES;
    agent.lastCompletedShiftDay = world.day;
    agent.destination = { buildingId: shop.id, kind: 'shop' };
    home.pantryStock = 1;
    world.minutesOfDay = 18 * 60;

    world = stepWorld(world);

    expect(world.entities.agents[0]!.destination?.kind).toBe('shop');
    expect(
      world.entities.buildings.find((building) => building.id === world.entities.agents[0]!.destination?.buildingId)?.kind,
    ).toBe(BuildingKind.Commercial);
    expect(world.entities.agents[0]!.state).toBe(AgentState.MovingToShop);
  });

  it('does not force a home destination when already home and no need is active', () => {
    let world = createTestStarterWorld();
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
      cash: 0,
      stock: 0,
      capacity: 3,
      pantryStock: 3,
      pantryCapacity: 6,
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
      {
        id: 'home',
        kind: BuildingKind.Residential,
        tile: { x: 0, y: 1 },
        cash: 0,
        stock: 0,
        capacity: 1,
        pantryStock: 1,
        pantryCapacity: 2,
        label: 'home',
      },
      {
        id: 'work',
        kind: BuildingKind.Industrial,
        tile: { x: 4, y: 1 },
        cash: INDUSTRIAL_STARTING_CASH,
        stock: 4,
        capacity: 1,
        pantryStock: 0,
        pantryCapacity: 0,
        label: 'work',
      },
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
      {
        id: 'home',
        kind: BuildingKind.Residential,
        tile: { x: 0, y: 1 },
        cash: 0,
        stock: 0,
        capacity: 2,
        pantryStock: 2,
        pantryCapacity: 4,
        label: 'home',
      },
      {
        id: 'work',
        kind: BuildingKind.Industrial,
        tile: { x: 4, y: 1 },
        cash: INDUSTRIAL_STARTING_CASH,
        stock: 4,
        capacity: 2,
        pantryStock: 0,
        pantryCapacity: 0,
        label: 'work',
      },
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
    const base = createTestStarterWorld();
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
    let world = createTestStarterWorld();
    world.selectedAgentId = world.entities.agents[0]!.id;
    world.entities.agents[0]!.stats.hunger = 100;
    world.entities.agents[0]!.maxHungerStreakDays = 1;
    world.entities.agents[0]!.keptMaxHungerToday = true;
    world.entities.buildings.find((building) => building.id === world.entities.agents[0]!.homeId)!.pantryStock = 0;
    world.minutesOfDay = 23 * 60 + 59;

    world = stepWorld(world);

    expect(world.selectedAgentId).toBeUndefined();
    expect(world.entities.agents.every((agent) => Number.isFinite(agent.pos.x) && Number.isFinite(agent.pos.y))).toBe(true);
  });

  it('does not cull an agent after only one full day at max hunger', () => {
    let world = createTestStarterWorld();
    const agent = world.entities.agents[0]!;
    agent.stats.hunger = 100;
    agent.keptMaxHungerToday = true;
    world.entities.buildings.find((building) => building.id === agent.homeId)!.pantryStock = 0;
    world.minutesOfDay = 23 * 60 + 59;

    world = stepWorld(world);

    expect(world.entities.agents.some((entry) => entry.id === agent.id)).toBe(true);
    expect(world.entities.agents.find((entry) => entry.id === agent.id)?.maxHungerStreakDays).toBe(1);
  });

  it('grows a household when two residents can afford it and housing is available', () => {
    const world = createBlankWorld(4, 1);
    setTile(world, { x: 0, y: 0 }, { x: 0, y: 0, type: TileType.Residential, buildingId: 'home' });
    setTile(world, { x: 1, y: 0 }, { x: 1, y: 0, type: TileType.Industrial, buildingId: 'work' });
    world.entities.buildings.push(
      {
        id: 'home',
        kind: BuildingKind.Residential,
        tile: { x: 0, y: 0 },
        cash: 0,
        stock: 0,
        capacity: 3,
        pantryStock: 6,
        pantryCapacity: 6,
        label: 'home',
      },
      {
        id: 'work',
        kind: BuildingKind.Industrial,
        tile: { x: 1, y: 0 },
        cash: INDUSTRIAL_STARTING_CASH,
        stock: 0,
        capacity: 4,
        pantryStock: 0,
        pantryCapacity: 0,
        label: 'work',
      },
    );
    world.metrics.populationCapacity = 3;
    world.entities.agents = [
      makeTestAgent({
        id: 'agent-1',
        homeId: 'home',
        workId: 'work',
        pos: tileCenter({ x: 0, y: 0 }),
        wallet: HOUSEHOLD_GROWTH_COST,
        stats: { hunger: 10, energy: 90, happiness: 80 },
      }),
      makeTestAgent({
        id: 'agent-2',
        homeId: 'home',
        workId: 'work',
        pos: tileCenter({ x: 0, y: 0 }),
        wallet: HOUSEHOLD_GROWTH_COST,
        stats: { hunger: 10, energy: 90, happiness: 80 },
      }),
    ];
    world.minutesOfDay = 23 * 60 + 59;

    const next = stepWorld(world);

    expect(next.entities.agents).toHaveLength(3);
    expect(next.entities.agents[0]!.wallet).toBe(0);
    expect(next.entities.agents[1]!.wallet).toBe(0);
    expect(next.economy.treasury).toBe(world.economy.treasury + HOUSEHOLD_GROWTH_COST * 2);
    expect(next.entities.agents[2]!.homeId).toBe('home');
    expect(next.entities.agents[2]!.workId).toBe('work');
    expect(next.entities.agents[2]!.name).toMatch(agentNamePattern);
    expect(next.entities.agents[2]!.name.startsWith('Resident ')).toBe(false);
    expect(next.entities.agents[2]!.thought).toBe('New to the household.');
  });

  it('limits household growth to one new resident per household each day', () => {
    const world = createBlankWorld(4, 1);
    setTile(world, { x: 0, y: 0 }, { x: 0, y: 0, type: TileType.Residential, buildingId: 'home' });
    setTile(world, { x: 1, y: 0 }, { x: 1, y: 0, type: TileType.Industrial, buildingId: 'work' });
    world.entities.buildings.push(
      {
        id: 'home',
        kind: BuildingKind.Residential,
        tile: { x: 0, y: 0 },
        cash: 0,
        stock: 0,
        capacity: 6,
        pantryStock: 12,
        pantryCapacity: 12,
        label: 'home',
      },
      {
        id: 'work',
        kind: BuildingKind.Industrial,
        tile: { x: 1, y: 0 },
        cash: INDUSTRIAL_STARTING_CASH,
        stock: 0,
        capacity: 6,
        pantryStock: 0,
        pantryCapacity: 0,
        label: 'work',
      },
    );
    world.metrics.populationCapacity = 6;
    world.entities.agents = ['agent-1', 'agent-2', 'agent-3', 'agent-4'].map((id) =>
      makeTestAgent({
        id,
        homeId: 'home',
        workId: 'work',
        pos: tileCenter({ x: 0, y: 0 }),
        wallet: HOUSEHOLD_GROWTH_COST,
        stats: { hunger: 10, energy: 90, happiness: 80 },
      }),
    );
    world.minutesOfDay = 23 * 60 + 59;

    const next = stepWorld(world);

    expect(next.entities.agents).toHaveLength(5);
    expect(next.entities.agents.filter((agent) => agent.wallet === 0)).toHaveLength(2);
    expect(next.economy.treasury).toBe(world.economy.treasury + HOUSEHOLD_GROWTH_COST * 2);
  });

  it('remains stable over a longer deterministic soak', () => {
    const world = stepTimes(createTestStarterWorld(), 1500);

    expect(world.entities.agents.length).toBeGreaterThan(0);
    expect(Number.isFinite(world.economy.totalWealth)).toBe(true);
    expect(world.entities.agents.every((agent) => Number.isFinite(agent.stats.hunger))).toBe(true);
  }, 30000);
});
