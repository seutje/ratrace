import {
  COMMERCIAL_STARTING_CASH,
  COMMERCIAL_RESTOCK_PER_HOUR,
  HOME_PANTRY_UNITS_PER_RESIDENT,
  HOURLY_WAGE,
  INDUSTRIAL_STARTING_CASH,
  INDUSTRIAL_OUTPUT_PER_HOUR,
  STARTER_COMMERCIAL_CAPACITY,
  STARTER_WORLD_HEIGHT,
  STARTER_WORLD_SEED,
  STARTER_WORLD_WIDTH,
  STARTER_INDUSTRIAL_CAPACITY,
  STARTER_POPULATION,
  STARTER_RESIDENTIAL_CAPACITY,
  STARTER_ROAD_SPACING,
} from './constants';
import { createAgentMemory, createAgentSex, createAgentTraits, createSeededStartingAgentAge } from './agents';
import { createEmploymentAssignments } from './employment';
import { createRng } from './random';
import { createAgentName, createBuildingLabel } from './naming';
import { AgentState, Building, BuildingKind, Point, Tile, TileType, WorldState } from './types';
import { getTileIndex } from './utils';

const getStartingBuildingCash = (kind: BuildingKind) => {
  if (kind === BuildingKind.Commercial) {
    return COMMERCIAL_STARTING_CASH;
  }

  if (kind === BuildingKind.Industrial) {
    return INDUSTRIAL_STARTING_CASH;
  }

  return 0;
};

const makeTile = (x: number, y: number, type: TileType = TileType.Empty): Tile => ({ x, y, type });

type LotCandidate = {
  point: Point;
  variation: number;
};

type NormalizedPoint = {
  x: number;
  y: number;
};

type ClusterPlan = {
  center: NormalizedPoint;
  count: number;
};

const industrialClusterCenters: NormalizedPoint[] = [
  { x: 0.12, y: 0.14 },
  { x: 0.3, y: 0.16 },
  { x: 0.7, y: 0.16 },
  { x: 0.88, y: 0.14 },
  { x: 0.14, y: 0.5 },
  { x: 0.86, y: 0.5 },
  { x: 0.12, y: 0.84 },
  { x: 0.3, y: 0.82 },
  { x: 0.7, y: 0.82 },
  { x: 0.88, y: 0.84 },
];

const setTileType = (tiles: Tile[], x: number, y: number, type: TileType) => {
  tiles[y * STARTER_WORLD_WIDTH + x] = { ...tiles[y * STARTER_WORLD_WIDTH + x], type };
};

const createClusterPlans = (centers: NormalizedPoint[], totalCount: number): ClusterPlan[] => {
  if (totalCount <= 0) {
    return [];
  }

  const activeCenters = centers.slice(0, Math.min(totalCount, centers.length));
  const baseCount = Math.floor(totalCount / activeCenters.length);
  const remainder = totalCount % activeCenters.length;

  return activeCenters.map((center, index) => ({
    center,
    count: baseCount + (index < remainder ? 1 : 0),
  }));
};

const createStarterBuildingPlan = (population: number) => {
  const residentialBuildingCount = Math.ceil(population / STARTER_RESIDENTIAL_CAPACITY);
  const commercialBuildingCount = Math.max(12, Math.ceil(population / 14));
  const industrialBuildingCount = Math.max(16, Math.ceil(population / 12));
  const residentialPocketCount = Math.min(
    residentialBuildingCount,
    Math.max(industrialClusterCenters.length * 2, Math.round(residentialBuildingCount * 0.12)),
  );

  return {
    residentialBuildingCount,
    commercialBuildingCount,
    industrialBuildingCount,
    industrialClusterPlans: createClusterPlans(industrialClusterCenters, industrialBuildingCount),
    residentialPocketPlans: createClusterPlans(industrialClusterCenters, residentialPocketCount),
    centralResidentialCount: residentialBuildingCount - residentialPocketCount,
  };
};

const isRoadTile = (x: number, y: number) =>
  x === 0 ||
  y === 0 ||
  x === STARTER_WORLD_WIDTH - 1 ||
  y === STARTER_WORLD_HEIGHT - 1 ||
  x % STARTER_ROAD_SPACING === 0 ||
  y % STARTER_ROAD_SPACING === 0;

const isAdjacentToRoad = ({ x, y }: Point) =>
  isRoadTile(x - 1, y) || isRoadTile(x + 1, y) || isRoadTile(x, y - 1) || isRoadTile(x, y + 1);

const buildLots = (rng: () => number) => {
  const lots: LotCandidate[] = [];

  for (let y = 1; y < STARTER_WORLD_HEIGHT - 1; y += 1) {
    for (let x = 1; x < STARTER_WORLD_WIDTH - 1; x += 1) {
      if (isRoadTile(x, y) || !isAdjacentToRoad({ x, y })) {
        continue;
      }

      lots.push({
        point: { x, y },
        variation: rng(),
      });
    }
  }

  return lots;
};

const normalizePoint = ({ x, y }: Point): NormalizedPoint => ({
  x: x / (STARTER_WORLD_WIDTH - 1),
  y: y / (STARTER_WORLD_HEIGHT - 1),
});

const getCenterDistance = ({ x, y }: NormalizedPoint) => Math.hypot(x - 0.5, y - 0.5);

const getEdgeBias = ({ x, y }: NormalizedPoint) => Math.max(Math.abs(x - 0.5) / 0.5, Math.abs(y - 0.5) / 0.5);

const getAxisBias = ({ x, y }: NormalizedPoint) => 1 - Math.min(Math.abs(x - 0.5), Math.abs(y - 0.5)) / 0.5;

const getClusterInfluence = (
  { x, y }: NormalizedPoint,
  center: NormalizedPoint,
  spreadX: number,
  spreadY: number,
) => {
  const dx = (x - center.x) / spreadX;
  const dy = (y - center.y) / spreadY;
  return Math.max(0, 1 - Math.hypot(dx, dy));
};

const scoreCentralResidentialLot = ({ point, variation }: LotCandidate) => {
  const normalized = normalizePoint(point);
  const centerBias = Math.max(0, 1 - getCenterDistance(normalized) / 0.65);
  return centerBias * 1.4 + getAxisBias(normalized) * 0.3 + variation * 0.2;
};

const scoreCommercialLot = ({ point, variation }: LotCandidate) => {
  const normalized = normalizePoint(point);
  const centerBias = Math.max(0, 1 - getCenterDistance(normalized) / 0.48);
  return centerBias * 1.7 + getAxisBias(normalized) * 0.45 + variation * 0.15;
};

const scoreResidentialPocketLot = (lot: LotCandidate, cluster: ClusterPlan) => {
  const normalized = normalizePoint(lot.point);
  const clusterBias = getClusterInfluence(normalized, cluster.center, 0.18, 0.18);
  return clusterBias * 1.6 + getEdgeBias(normalized) * 0.25 + lot.variation * 0.15;
};

const scoreIndustrialLot = (lot: LotCandidate, cluster: ClusterPlan) => {
  const normalized = normalizePoint(lot.point);
  const clusterBias = getClusterInfluence(normalized, cluster.center, 0.22, 0.2);
  const centerPenalty = getCenterDistance(normalized);
  return clusterBias * 2 + getEdgeBias(normalized) * 0.5 - centerPenalty * 0.4 + lot.variation * 0.12;
};

const pickLots = (
  lots: LotCandidate[],
  count: number,
  scoreLot: (lot: LotCandidate) => number,
) => {
  const ranked = lots
    .map((lot) => ({
      ...lot,
      score: scoreLot(lot),
    }))
    .sort((left, right) => right.score - left.score || left.point.y - right.point.y || left.point.x - right.point.x);

  return ranked.slice(0, count);
};

const withoutSelectedLots = (lots: LotCandidate[], selected: LotCandidate[]) => {
  const taken = new Set(selected.map(({ point }) => `${point.x},${point.y}`));
  return lots.filter(({ point }) => !taken.has(`${point.x},${point.y}`));
};

const pickClusterLots = (
  lots: LotCandidate[],
  clusters: ClusterPlan[],
  scoreLot: (lot: LotCandidate, cluster: ClusterPlan) => number,
  fallbackScoreLot: (lot: LotCandidate) => number,
) => {
  let remaining = lots;
  const selected: LotCandidate[] = [];

  clusters.forEach((cluster) => {
    const clusterSelection = pickLots(remaining, cluster.count, (lot) => scoreLot(lot, cluster));
    selected.push(...clusterSelection);
    remaining = withoutSelectedLots(remaining, clusterSelection);
  });

  const totalCount = clusters.reduce((sum, cluster) => sum + cluster.count, 0);
  if (selected.length < totalCount) {
    selected.push(...pickLots(remaining, totalCount - selected.length, fallbackScoreLot));
  }

  return selected;
};

const createDistrictBuildings = (
  seed: number,
  rng: () => number,
  lots: LotCandidate[],
  kind: BuildingKind,
  count: number,
  capacity: number,
  stock: number,
) =>
  lots.slice(0, count).map(({ point }, index) => {
    const pantryCapacity = kind === BuildingKind.Residential ? capacity * HOME_PANTRY_UNITS_PER_RESIDENT : 0;
    return {
      id: `${kind.toLowerCase()}-${point.x}-${point.y}`,
      kind,
      tile: point,
      cash: getStartingBuildingCash(kind),
      stock,
      capacity,
      pantryStock: pantryCapacity,
      pantryCapacity,
      label: createBuildingLabel(seed, rng, kind, index),
    };
  });

export const createStarterWorld = (seed = STARTER_WORLD_SEED, population = STARTER_POPULATION): WorldState => {
  const rng = createRng(seed);
  const {
    residentialBuildingCount,
    commercialBuildingCount,
    industrialBuildingCount,
    industrialClusterPlans,
    residentialPocketPlans,
    centralResidentialCount,
  } = createStarterBuildingPlan(population);
  const tiles = Array.from({ length: STARTER_WORLD_WIDTH * STARTER_WORLD_HEIGHT }, (_, index) =>
    makeTile(index % STARTER_WORLD_WIDTH, Math.floor(index / STARTER_WORLD_WIDTH)),
  );

  for (let y = 0; y < STARTER_WORLD_HEIGHT; y += 1) {
    for (let x = 0; x < STARTER_WORLD_WIDTH; x += 1) {
      if (isRoadTile(x, y)) {
        setTileType(tiles, x, y, TileType.Road);
      }
    }
  }

  const lots = buildLots(rng);
  const industrialLots = pickClusterLots(
    lots,
    industrialClusterPlans,
    scoreIndustrialLot,
    (lot) => industrialClusterPlans.reduce((best, cluster) => Math.max(best, scoreIndustrialLot(lot, cluster)), -Infinity),
  );
  const lotsWithoutIndustry = withoutSelectedLots(lots, industrialLots);
  const commercialLots = pickLots(lotsWithoutIndustry, commercialBuildingCount, scoreCommercialLot);
  const lotsWithoutCommercial = withoutSelectedLots(lotsWithoutIndustry, commercialLots);
  const residentialPocketLots = pickClusterLots(
    lotsWithoutCommercial,
    residentialPocketPlans,
    scoreResidentialPocketLot,
    scoreCentralResidentialLot,
  );
  const residentialLots = [
    ...pickLots(withoutSelectedLots(lotsWithoutCommercial, residentialPocketLots), centralResidentialCount, scoreCentralResidentialLot),
    ...residentialPocketLots,
  ];

  const buildings: Building[] = [
    ...createDistrictBuildings(
      seed,
      rng,
      residentialLots,
      BuildingKind.Residential,
      residentialBuildingCount,
      STARTER_RESIDENTIAL_CAPACITY,
      0,
    ),
    ...createDistrictBuildings(
      seed,
      rng,
      commercialLots,
      BuildingKind.Commercial,
      commercialBuildingCount,
      STARTER_COMMERCIAL_CAPACITY,
      STARTER_COMMERCIAL_CAPACITY,
    ),
    ...createDistrictBuildings(
      seed,
      rng,
      industrialLots,
      BuildingKind.Industrial,
      industrialBuildingCount,
      STARTER_INDUSTRIAL_CAPACITY,
      STARTER_INDUSTRIAL_CAPACITY + 4,
    ),
  ];

  buildings.forEach((building) => {
    const tileType =
      building.kind === BuildingKind.Residential
        ? TileType.Residential
        : building.kind === BuildingKind.Commercial
          ? TileType.Commercial
          : TileType.Industrial;
    const index = getTileIndex({ width: STARTER_WORLD_WIDTH }, building.tile);
    tiles[index] = {
      ...tiles[index],
      type: tileType,
      buildingId: building.id,
    };
  });

  const homes = buildings.filter((building) => building.kind === BuildingKind.Residential);
  const homeSlots = homes.flatMap((home) => Array.from({ length: home.capacity }, () => home));
  const employmentAssignments = createEmploymentAssignments(population, buildings);

  if (homeSlots.length < population) {
    throw new Error('Starter world does not provide enough housing capacity.');
  }

  if (employmentAssignments.length < population) {
    throw new Error('Starter world does not provide enough workplaces.');
  }

  const agents = Array.from({ length: population }, (_, index) => {
    const home = homeSlots[index]!;
    const assignment = employmentAssignments[index]!;
    const sex = createAgentSex(rng);
    return {
      id: `agent-${index + 1}`,
      name: createAgentName(rng, sex),
      age: createSeededStartingAgentAge(seed, [index + 1, home.tile.x, home.tile.y, assignment.shiftStartMinute]),
      sex,
      pos: { x: home.tile.x + 0.5, y: home.tile.y + 0.5 },
      wallet: 20 + Math.floor(rng() * 20),
      carriedMeals: 0,
      stats: {
        hunger: Math.floor(15 + rng() * 20),
        energy: Math.floor(55 + rng() * 25),
        happiness: Math.floor(60 + rng() * 20),
      },
      traits: createAgentTraits(rng),
      memory: createAgentMemory(),
      homeId: home.id,
      workId: assignment.workId,
      parentIds: [],
      childIds: [],
      coParentIds: [],
      state: AgentState.Idle,
      thought: 'Settling in.',
      route: [],
      routeIndex: 0,
      routeComputeCount: 0,
      routeMapVersion: 0,
      commuteToWorkRoute: null,
      commuteToWorkRouteMapVersion: 0,
      commuteToHomeRoute: null,
      commuteToHomeRouteMapVersion: 0,
      destination: undefined,
      travelPurpose: undefined,
      travelStartTick: undefined,
      lastShoppedTick: undefined,
      sleepUntilTick: undefined,
      shiftStartMinute: assignment.shiftStartMinute,
      shiftDay: 0,
      shiftWorkMinutes: 0,
      paidShiftWorkMinutes: 0,
      lastCompletedShiftDay: 0,
      daysInCity: 0,
      maxHungerStreakDays: 0,
      keptMaxHungerToday: false,
    };
  });

  return {
    seed,
    tick: 0,
    minutesOfDay: 7 * 60,
    day: 1,
    width: STARTER_WORLD_WIDTH,
    height: STARTER_WORLD_HEIGHT,
    tiles,
    economy: {
      inflation: 1,
      treasury: 5000,
      totalWealth:
        5000 +
        agents.reduce((sum, agent) => sum + agent.wallet, 0) +
        buildings.reduce((sum, building) => sum + building.cash, 0) +
        buildings.reduce((sum, building) => sum + (building.stock + building.pantryStock) * 2, 0),
      supplyStock: buildings.reduce((sum, building) => sum + building.stock + building.pantryStock, 0),
    },
    entities: {
      agents,
      buildings,
    },
    selectedAgentId: undefined,
    traffic: {},
    metrics: {
      mapVersion: 1,
      trafficPeak: 0,
      pathComputations: 0,
      populationCapacity: homes.reduce((sum, home) => sum + home.capacity, 0),
    },
  };
};

export const createBlankWorld = (width: number, height: number): WorldState => ({
  seed: 0,
  tick: 0,
  minutesOfDay: 0,
  day: 1,
  width,
  height,
  tiles: Array.from({ length: width * height }, (_, index) => makeTile(index % width, Math.floor(index / width))),
  economy: {
    inflation: 1,
    treasury: HOURLY_WAGE * INDUSTRIAL_OUTPUT_PER_HOUR,
    totalWealth: HOURLY_WAGE * INDUSTRIAL_OUTPUT_PER_HOUR,
    supplyStock: COMMERCIAL_RESTOCK_PER_HOUR,
  },
  entities: {
    agents: [],
    buildings: [],
  },
  traffic: {},
  metrics: {
    mapVersion: 1,
    trafficPeak: 0,
    pathComputations: 0,
    populationCapacity: 0,
  },
});
