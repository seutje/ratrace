import {
  BASE_MOVE_SPEED,
  COMMERCIAL_STARTING_CASH,
  COMMERCIAL_RESTOCK_PER_HOUR,
  COMMERCIAL_SUBSIDY_PER_HOUR,
  HOUSEHOLD_GROWTH_COST,
  HOUSEHOLD_GROWTH_HAPPINESS_THRESHOLD,
  HOUSEHOLD_GROWTH_WALLET_THRESHOLD,
  INHERITANCE_TAX_RATE,
  HOURLY_WAGE,
  INDUSTRIAL_OUTPUT_PER_HOUR,
  INDUSTRIAL_STARTING_CASH,
  INDUSTRIAL_SUBSIDY_PER_HOUR,
  MAX_AGENT_AGE,
  MAX_STAT,
  PACKED_LUNCH_CAPACITY,
  PANTRY_MEAL_HUNGER_RECOVERY,
  RETAIL_SALES_TAX_PER_UNIT,
  ROAD_SPEED_MULTIPLIER,
  SHOPPING_COOLDOWN_TICKS,
  SHOPPING_BASKET_UNITS,
  SHOPPING_HUNGER_THRESHOLD,
  SHOP_PRICE_PER_UNIT,
  SLEEP_END_MINUTE,
  SLEEP_ENERGY_RECOVERY_PER_TICK,
  SLEEP_MINIMUM_MINUTES,
  SLEEP_TARGET_ENERGY,
  SLEEP_ENERGY_THRESHOLD,
  SLEEP_START_MINUTE,
  STARVATION_CULL_DAYS,
  TREASURY_RESERVE_TARGET,
  WHOLESALE_PRICE_PER_UNIT,
  WORK_SHIFT_MINUTES,
  dayMinutes,
  gameMinutesPerTick,
  msPerTick,
} from './constants';
import { createAgentMemory, createInheritedAgentTraits, createSeededAgentSex } from './agents';
import { pickEmploymentAssignment } from './employment';
import { findPath } from './pathfinding';
import { getCongestionSpeedFactor } from './traffic';
import {
  Agent,
  AgentDestination,
  AgentState,
  AgentSex,
  Building,
  BuildingKind,
  ObituaryEntry,
  Point,
  TileType,
  WorldState,
  SimulationAdvanceResult,
} from './types';
import { createRuntimeAgentName, getLastName } from './naming';
import {
  clamp,
  formatClock,
  getTile,
  samePoint,
  tileKey,
  toClockNumber,
} from './utils';
import {
  getAgentCurrentTile,
  getAgentTrafficKey,
  getLaneDirection,
  getRoadLaneCenter,
  getRouteTargetPoint,
} from './lanes';

const isPastShiftStart = (world: WorldState, agent: Agent) => world.minutesOfDay >= agent.shiftStartMinute;
const isSleepHours = (minutes: number) => minutes >= SLEEP_START_MINUTE || minutes < SLEEP_END_MINUTE;
const hasActiveShift = (agent: Agent) => agent.shiftDay > 0 && agent.shiftWorkMinutes < WORK_SHIFT_MINUTES;
const isShiftDue = (world: WorldState, agent: Agent) =>
  isPastShiftStart(world, agent) && agent.shiftDay < world.day && agent.lastCompletedShiftDay < world.day;
const isCommittedToSleep = (agent: Agent, world: WorldState) =>
  agent.sleepUntilTick !== undefined && world.tick < agent.sleepUntilTick;
const overlapAllowedTileTypes = new Set<TileType>([
  TileType.Residential,
  TileType.Commercial,
  TileType.Industrial,
]);
const ROAD_RIGHT_OF_WAY_EPSILON = 1e-3;
const BUSINESS_SUPPORT_RESERVE_DAYS = 10;
type OccupancyReservations = Map<string, number>;
type StaffedCommercialCounts = Map<string, number>;
type ShopSearchState = {
  nearestByTile: (string | null)[];
  primed: boolean;
};
type StepBuildingIndex = {
  byId: Map<string, Building>;
  residential: Building[];
  commercial: Building[];
  industrial: Building[];
};
type StepScratch = {
  buildingIndex: StepBuildingIndex;
  buildingIndexBuildings: Building[] | null;
  buildingIndexMapVersion: number;
  reservations: OccupancyReservations;
  shopSearchMapVersion: number;
  shopSearchServiceKey: string;
  shopSearchState: ShopSearchState;
  staffedCommercialCounts: StaffedCommercialCounts;
};
export type StepWorldProfile = {
  samples: number;
  maxTickMs: number;
  buildingIndexMs: number;
  hourlyMs: number;
  initMs: number;
  agentStatsMs: number;
  routeMs: number;
  pathfindMs: number;
  populationMs: number;
  economyMs: number;
  shopSearchMs: number;
  shopSearches: number;
  shopCacheHits: number;
  shopCacheMisses: number;
};

const getRetailPrice = (units: number) => units * SHOP_PRICE_PER_UNIT;
const getRetailSalesTax = (units: number) => units * RETAIL_SALES_TAX_PER_UNIT;
const getWholesaleCost = (units: number) => units * WHOLESALE_PRICE_PER_UNIT;
const getMinimumShoppingCash = () => SHOP_PRICE_PER_UNIT;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const createStepWorldProfile = (): StepWorldProfile => ({
  samples: 0,
  maxTickMs: 0,
  buildingIndexMs: 0,
  hourlyMs: 0,
  initMs: 0,
  agentStatsMs: 0,
  routeMs: 0,
  pathfindMs: 0,
  populationMs: 0,
  economyMs: 0,
  shopSearchMs: 0,
  shopSearches: 0,
  shopCacheHits: 0,
  shopCacheMisses: 0,
});
let stepWorldProfile: StepWorldProfile | null = null;

export const enableStepWorldProfiling = () => {
  stepWorldProfile = createStepWorldProfile();
};

export const disableStepWorldProfiling = () => {
  stepWorldProfile = null;
};

export const getStepWorldProfile = () => (stepWorldProfile ? { ...stepWorldProfile } : undefined);

const cloneWorldForStep = (world: WorldState): WorldState => ({
  ...world,
  economy: { ...world.economy },
  entities: {
    agents: world.entities.agents.map((agent) => ({
      ...agent,
      childIds: agent.childIds.slice(),
      coParentIds: agent.coParentIds.slice(),
      traits: { ...agent.traits },
      memory: { ...agent.memory },
      parentIds: agent.parentIds.slice(),
      pos: { ...agent.pos },
      stats: { ...agent.stats },
      route: agent.route.slice(),
      commuteToWorkRoute: agent.commuteToWorkRoute?.slice() ?? null,
      commuteToHomeRoute: agent.commuteToHomeRoute?.slice() ?? null,
      destination: agent.destination ? { ...agent.destination } : undefined,
    })),
    buildings: world.entities.buildings.map((building) => ({
      ...building,
    })),
  },
  obituary: world.obituary.map((entry) => ({
    ...entry,
  })),
  traffic: {},
  metrics: { ...world.metrics },
});

const clearBuildingIndex = (buildingIndex: StepBuildingIndex) => {
  buildingIndex.byId.clear();
  buildingIndex.residential.length = 0;
  buildingIndex.commercial.length = 0;
  buildingIndex.industrial.length = 0;
};

const getPointIndex = (world: Pick<WorldState, 'width'>, point: Point) => point.y * world.width + point.x;

const rebuildBuildingIndex = (buildingIndex: StepBuildingIndex, world: WorldState) => {
  clearBuildingIndex(buildingIndex);

  for (const building of world.entities.buildings) {
    buildingIndex.byId.set(building.id, building);
    switch (building.kind) {
      case BuildingKind.Residential:
        buildingIndex.residential.push(building);
        break;
      case BuildingKind.Commercial:
        buildingIndex.commercial.push(building);
        break;
      case BuildingKind.Industrial:
        buildingIndex.industrial.push(building);
        break;
    }
  }
};

const getBuildingIndex = (world: WorldState, scratch: StepScratch): StepBuildingIndex => {
  if (
    scratch.buildingIndexBuildings === world.entities.buildings &&
    scratch.buildingIndexMapVersion === world.metrics.mapVersion
  ) {
    return scratch.buildingIndex;
  }

  rebuildBuildingIndex(scratch.buildingIndex, world);
  scratch.buildingIndexBuildings = world.entities.buildings;
  scratch.buildingIndexMapVersion = world.metrics.mapVersion;
  return scratch.buildingIndex;
};

const allowsAgentOverlap = (tileType: TileType) => overlapAllowedTileTypes.has(tileType);

const addReservation = (reservations: OccupancyReservations, key?: string) => {
  if (!key) {
    return;
  }

  reservations.set(key, (reservations.get(key) ?? 0) + 1);
};

const removeReservation = (reservations: OccupancyReservations, key?: string) => {
  if (!key) {
    return;
  }

  const next = (reservations.get(key) ?? 0) - 1;
  if (next > 0) {
    reservations.set(key, next);
    return;
  }

  reservations.delete(key);
};

const getTargetOccupancyKey = (world: WorldState, currentTile: Point, targetTile?: Point) => {
  if (!targetTile) {
    return undefined;
  }

  const targetTileType = getTile(world, targetTile)?.type ?? TileType.Empty;
  if (allowsAgentOverlap(targetTileType)) {
    return undefined;
  }

  const direction = targetTileType === TileType.Road ? getLaneDirection(currentTile, targetTile) : undefined;
  return direction ? `${tileKey(targetTile)}:${direction}` : tileKey(targetTile);
};

const getRoadYieldPoint = (currentTile: Point, direction: ReturnType<typeof getLaneDirection>) => {
  if (!direction) {
    return undefined;
  }

  const laneCenter = getRoadLaneCenter(currentTile, direction);
  switch (direction) {
    case 'east':
      return { x: currentTile.x + 1 - ROAD_RIGHT_OF_WAY_EPSILON, y: laneCenter.y };
    case 'west':
      return { x: currentTile.x + ROAD_RIGHT_OF_WAY_EPSILON, y: laneCenter.y };
    case 'north':
      return { x: laneCenter.x, y: currentTile.y + ROAD_RIGHT_OF_WAY_EPSILON };
    case 'south':
      return { x: laneCenter.x, y: currentTile.y + 1 - ROAD_RIGHT_OF_WAY_EPSILON };
  }
};

const getResiliencePenaltyMultiplier = (agent: Agent) => clamp(1.45 - agent.traits.resilience * 0.45, 0.75, 1.1);

const getHardshipPressure = (agent: Agent) => Math.min(10, agent.memory.recentHardshipDays * 2);

const getAgentShoppingHungerThreshold = (agent: Agent) =>
  clamp(
    SHOPPING_HUNGER_THRESHOLD -
      (agent.traits.appetite - 1) * 18 +
      (agent.traits.thrift - 1) * 12 -
      getHardshipPressure(agent) -
      Math.min(6, agent.memory.averageCommuteMinutes / 20),
    35,
    90,
  );

const getAgentMealThreshold = (agent: Agent) => clamp(getAgentShoppingHungerThreshold(agent) - 12, 24, MAX_STAT);

const getAgentSleepThreshold = (agent: Agent) =>
  clamp(
    SLEEP_ENERGY_THRESHOLD + Math.min(10, agent.memory.averageCommuteMinutes / 12) - (agent.traits.stamina - 1) * 12,
    12,
    36,
  );

const getAgentShoppingBasketUnits = (agent: Agent) =>
  clamp(
    Math.round(
      SHOPPING_BASKET_UNITS * (1.05 - (agent.traits.thrift - 1) * 0.7 + Math.min(0.35, agent.memory.recentHardshipDays * 0.05)),
    ),
    2,
    SHOPPING_BASKET_UNITS + 4,
  );

const clearTravelTracking = (agent: Agent) => {
  agent.travelPurpose = undefined;
  agent.travelStartTick = undefined;
};

const beginTrackedTravel = (agent: Agent, destination: AgentDestination, world: WorldState) => {
  if (destination.kind === 'shop') {
    clearTravelTracking(agent);
    return;
  }

  if (agent.travelPurpose === destination.kind && agent.travelStartTick !== undefined) {
    return;
  }

  agent.travelPurpose = destination.kind;
  agent.travelStartTick = world.tick;
};

const recordTrackedArrival = (agent: Agent, destination: AgentDestination | undefined, world: WorldState) => {
  if (!destination || destination.kind === 'shop') {
    clearTravelTracking(agent);
    return;
  }

  if (agent.travelPurpose !== destination.kind || agent.travelStartTick === undefined) {
    return;
  }

  const commuteMinutes = Math.max(gameMinutesPerTick, (world.tick - agent.travelStartTick) * gameMinutesPerTick);
  agent.memory.lastCommuteMinutes = commuteMinutes;
  agent.memory.longestCommuteMinutes = Math.max(agent.memory.longestCommuteMinutes, commuteMinutes);
  agent.memory.averageCommuteMinutes =
    agent.memory.averageCommuteMinutes <= 0 ? commuteMinutes : agent.memory.averageCommuteMinutes * 0.75 + commuteMinutes * 0.25;
  clearTravelTracking(agent);
};

const getRequiredSleepTicks = (agent: Agent) => {
  const minimumSleepTicks = Math.ceil(SLEEP_MINIMUM_MINUTES / gameMinutesPerTick);
  const commuteRecoveryNeed = Math.min(8, agent.memory.averageCommuteMinutes * 0.06);
  const missingEnergy = Math.max(0, SLEEP_TARGET_ENERGY + commuteRecoveryNeed - agent.stats.energy);
  const sleepRecoveryPerTick = SLEEP_ENERGY_RECOVERY_PER_TICK * (0.75 + agent.traits.stamina * 0.35);
  const energyRecoveryTicks = Math.ceil(missingEnergy / sleepRecoveryPerTick);
  return Math.max(minimumSleepTicks, energyRecoveryTicks);
};

const getBuilding = (buildingIndex: StepBuildingIndex, buildingId: string) => buildingIndex.byId.get(buildingId);
const getHomePantryReorderPoint = (home: Building) => Math.max(2, Math.ceil(home.pantryCapacity * 0.75));
const homeNeedsPantryRefill = (home?: Building) =>
  !!home && home.pantryStock < home.pantryCapacity && home.pantryStock <= getHomePantryReorderPoint(home);

const getBuildingsByKind = (buildingIndex: StepBuildingIndex, kind: BuildingKind) => {
  switch (kind) {
    case BuildingKind.Residential:
      return buildingIndex.residential;
    case BuildingKind.Commercial:
      return buildingIndex.commercial;
    case BuildingKind.Industrial:
      return buildingIndex.industrial;
  }
};

const clearTraffic = (traffic: Record<string, number>) => {
  for (const key in traffic) {
    delete traffic[key];
  }
};

const updateEconomyTotals = (world: WorldState) => {
  let walletTotal = 0;
  let businessCashTotal = 0;
  let stockTotal = 0;
  let pantryTotal = 0;
  let carriedMealTotal = 0;

  for (const agent of world.entities.agents) {
    walletTotal += agent.wallet;
    carriedMealTotal += agent.carriedMeals;
  }

  for (const building of world.entities.buildings) {
    businessCashTotal += building.cash;
    stockTotal += building.stock;
    pantryTotal += building.pantryStock;
  }

  world.economy.supplyStock = stockTotal + pantryTotal + carriedMealTotal;
  world.economy.totalWealth =
    world.economy.treasury + walletTotal + businessCashTotal + (stockTotal + pantryTotal + carriedMealTotal) * 2;
};

const isCurrentRouteUsable = (world: WorldState, agent: Agent, targetPoint: Point) => {
  if (agent.route.length === 0 || agent.routeIndex <= 0 || agent.routeIndex >= agent.route.length) {
    return false;
  }

  if (agent.routeMapVersion !== world.metrics.mapVersion) {
    return false;
  }

  if (!samePoint(agent.route.at(-1), targetPoint)) {
    return false;
  }

  const currentTile = getAgentCurrentTile(agent);
  const routeOrigin = agent.route[agent.routeIndex - 1];
  return !!routeOrigin && samePoint(routeOrigin, currentTile);
};

type CommuteRouteKind = 'toWork' | 'toHome';

const getCommuteRouteKind = (
  agent: Agent,
  buildingIndex: StepBuildingIndex,
  currentTile: Point,
  destination: AgentDestination,
  targetPoint: Point,
): CommuteRouteKind | undefined => {
  const home = getBuilding(buildingIndex, agent.homeId);
  const work = getBuilding(buildingIndex, agent.workId);

  if (
    destination.kind === 'work' &&
    home &&
    work &&
    samePoint(currentTile, home.tile) &&
    samePoint(targetPoint, work.tile)
  ) {
    return 'toWork';
  }

  if (
    destination.kind === 'home' &&
    home &&
    work &&
    samePoint(currentTile, work.tile) &&
    samePoint(targetPoint, home.tile)
  ) {
    return 'toHome';
  }

  return undefined;
};

const getCachedCommuteRoute = (agent: Agent, kind: CommuteRouteKind, mapVersion: number) => {
  if (kind === 'toWork') {
    if (agent.commuteToWorkRouteMapVersion !== mapVersion) {
      return undefined;
    }

    return agent.commuteToWorkRoute;
  }

  if (agent.commuteToHomeRouteMapVersion !== mapVersion) {
    return undefined;
  }

  return agent.commuteToHomeRoute;
};

const storeCachedCommuteRoute = (
  agent: Agent,
  kind: CommuteRouteKind,
  mapVersion: number,
  path: Point[] | null,
) => {
  if (kind === 'toWork') {
    agent.commuteToWorkRoute = path?.slice() ?? null;
    agent.commuteToWorkRouteMapVersion = mapVersion;
    return;
  }

  agent.commuteToHomeRoute = path?.slice() ?? null;
  agent.commuteToHomeRouteMapVersion = mapVersion;
};

const assignRoute = (
  world: WorldState,
  buildingIndex: StepBuildingIndex,
  agent: Agent,
  destination: AgentDestination,
  targetPoint: Point,
) => {
  const currentTile = getAgentCurrentTile(agent);
  const needsRecompute =
    agent.destination?.buildingId !== destination.buildingId ||
    agent.destination?.kind !== destination.kind ||
    !isCurrentRouteUsable(world, agent, targetPoint);

  if (!needsRecompute) {
    return;
  }

  const commuteRouteKind = getCommuteRouteKind(agent, buildingIndex, currentTile, destination, targetPoint);
  const cachedCommuteRoute = commuteRouteKind
    ? getCachedCommuteRoute(agent, commuteRouteKind, world.metrics.mapVersion)
    : undefined;
  let path = cachedCommuteRoute;
  if (path === undefined) {
    const pathfindStartedAt = stepWorldProfile ? nowMs() : 0;
    path = findPath(world, currentTile, targetPoint);
    if (stepWorldProfile) {
      stepWorldProfile.pathfindMs += nowMs() - pathfindStartedAt;
    }
  }

  if (commuteRouteKind && cachedCommuteRoute === undefined) {
    storeCachedCommuteRoute(agent, commuteRouteKind, world.metrics.mapVersion, path);
  }

  if (!path) {
    agent.route = [];
    agent.routeIndex = 0;
    agent.routeMapVersion = 0;
    agent.destination = undefined;
    agent.thought = 'No route available.';
    return;
  }

  agent.destination = destination;
  agent.route = path.slice();
  agent.routeIndex = Math.min(1, Math.max(path.length - 1, 0));
  agent.routeMapVersion = world.metrics.mapVersion;

  if (cachedCommuteRoute === undefined) {
    agent.routeComputeCount += 1;
    world.metrics.pathComputations += 1;
  }
};

const clearAgentRoute = (agent: Agent) => {
  agent.route = [];
  agent.routeIndex = 0;
  agent.routeMapVersion = 0;
};

const invalidateAgentCommuteState = (agent: Agent) => {
  clearTravelTracking(agent);
  clearAgentRoute(agent);
  agent.destination = undefined;
  agent.commuteToWorkRoute = null;
  agent.commuteToWorkRouteMapVersion = 0;
  agent.commuteToHomeRoute = null;
  agent.commuteToHomeRouteMapVersion = 0;
};

const relocateAgentHome = (agent: Agent, targetHome: Building) => {
  agent.homeId = targetHome.id;
  agent.pos.x = targetHome.tile.x + 0.5;
  agent.pos.y = targetHome.tile.y + 0.5;
  agent.sleepUntilTick = undefined;
  agent.state = AgentState.Idle;
  agent.thought = 'Moved in with roommates.';
  invalidateAgentCommuteState(agent);
};

const moveAxisToward = (current: number, target: number, maxStep: number) => {
  const delta = target - current;
  const used = Math.min(Math.abs(delta), maxStep);
  return {
    value: current + Math.sign(delta) * used,
    used,
  };
};

const moveTowardPoint = (agent: Agent, target: Point, stepDistance: number, direction?: ReturnType<typeof getLaneDirection>) => {
  const remainingDistance = Math.hypot(target.x - agent.pos.x, target.y - agent.pos.y);
  if (remainingDistance <= stepDistance) {
    agent.pos.x = target.x;
    agent.pos.y = target.y;
    return true;
  }

  if (direction === 'east' || direction === 'west') {
    const yMove = moveAxisToward(agent.pos.y, target.y, stepDistance);
    const xMove = moveAxisToward(agent.pos.x, target.x, stepDistance - yMove.used);
    agent.pos.x = xMove.value;
    agent.pos.y = yMove.value;
    return false;
  }

  if (direction === 'north' || direction === 'south') {
    const xMove = moveAxisToward(agent.pos.x, target.x, stepDistance);
    const yMove = moveAxisToward(agent.pos.y, target.y, stepDistance - xMove.used);
    agent.pos.x = xMove.value;
    agent.pos.y = yMove.value;
    return false;
  }

  const ratio = stepDistance / remainingDistance;
  agent.pos.x += (target.x - agent.pos.x) * ratio;
  agent.pos.y += (target.y - agent.pos.y) * ratio;
  return false;
};

const moveAgent = (world: WorldState, agent: Agent, reservations: OccupancyReservations) => {
  const currentTile = getAgentCurrentTile(agent);
  const currentTileType = getTile(world, currentTile)?.type ?? TileType.Empty;
  const currentReservationKey = allowsAgentOverlap(currentTileType)
    ? undefined
    : getAgentTrafficKey(world, agent, currentTile, currentTileType);

  removeReservation(reservations, currentReservationKey);

  if (!agent.destination || agent.routeIndex >= agent.route.length) {
    if (!allowsAgentOverlap(currentTileType)) {
      addReservation(reservations, currentReservationKey);
    }
    return;
  }

  const occupancy = world.traffic[getAgentTrafficKey(world, agent, currentTile, currentTileType)] ?? 0;
  const congestionFactor = currentTileType === TileType.Road ? getCongestionSpeedFactor(occupancy) : 1;
  const roadMultiplier = currentTileType === TileType.Road ? ROAD_SPEED_MULTIPLIER : 1;
  const stepDistance = BASE_MOVE_SPEED * roadMultiplier * congestionFactor;
  const targetTile = agent.route[agent.routeIndex];
  const targetTileType = targetTile ? getTile(world, targetTile)?.type ?? TileType.Empty : TileType.Empty;
  const direction = targetTile ? getLaneDirection(currentTile, targetTile) : undefined;
  const targetOccupancyKey = getTargetOccupancyKey(world, currentTile, targetTile);

  if (targetOccupancyKey && (reservations.get(targetOccupancyKey) ?? 0) > 0) {
    if (currentTileType === TileType.Road && targetTileType === TileType.Road && direction) {
      const yieldTarget = getRoadYieldPoint(currentTile, direction);
      if (yieldTarget) {
        moveTowardPoint(agent, yieldTarget, stepDistance, direction);
      }
    }

    const blockedTile = getAgentCurrentTile(agent);
    const blockedTileType = getTile(world, blockedTile)?.type ?? TileType.Empty;
    if (!allowsAgentOverlap(blockedTileType)) {
      addReservation(reservations, getAgentTrafficKey(world, agent, blockedTile, blockedTileType));
    }
    return;
  }

  const target = getRouteTargetPoint(world, agent, currentTile);

  const arrived = moveTowardPoint(
    agent,
    target,
    stepDistance,
    currentTileType === TileType.Road && targetTileType === TileType.Road ? direction : undefined,
  );
  if (arrived) {
    agent.routeIndex += 1;
  }

  const finalTile = getAgentCurrentTile(agent);
  const finalTileType = getTile(world, finalTile)?.type ?? TileType.Empty;
  if (!allowsAgentOverlap(finalTileType)) {
    addReservation(reservations, getAgentTrafficKey(world, agent, finalTile, finalTileType));
  }
};

const activateShiftIfDue = (world: WorldState, agent: Agent) => {
  if (!isShiftDue(world, agent)) {
    return;
  }

  agent.shiftDay = world.day;
  agent.shiftWorkMinutes = 0;
  agent.paidShiftWorkMinutes = 0;
};

const recordShiftWork = (agent: Agent, building: Building, world: WorldState) => {
  if (!hasActiveShift(agent)) {
    return;
  }

  agent.state = AgentState.Working;
  agent.thought = building.kind === BuildingKind.Commercial ? 'Working the counter.' : 'Clocked in.';
  agent.shiftWorkMinutes = Math.min(agent.shiftWorkMinutes + gameMinutesPerTick, WORK_SHIFT_MINUTES);

  while (agent.shiftWorkMinutes - agent.paidShiftWorkMinutes >= 60) {
    if (building.cash >= HOURLY_WAGE) {
      building.cash -= HOURLY_WAGE;
      agent.wallet += HOURLY_WAGE;
      if (building.kind === BuildingKind.Industrial) {
        building.stock += INDUSTRIAL_OUTPUT_PER_HOUR;
      }
    } else {
      agent.memory.unpaidHours += 1;
      agent.thought = 'Worked, but payroll was short.';
    }
    agent.paidShiftWorkMinutes += 60;
  }

  if (agent.shiftWorkMinutes >= WORK_SHIFT_MINUTES) {
    agent.lastCompletedShiftDay = world.day;
    agent.memory.completedShifts += 1;
    agent.thought = 'Shift done.';
  }
};

const consumePantryMeal = (agent: Agent, home: Building) => {
  if (home.pantryStock <= 0 || agent.stats.hunger < getAgentMealThreshold(agent)) {
    return false;
  }

  home.pantryStock -= 1;
  agent.stats.hunger = clamp(agent.stats.hunger - PANTRY_MEAL_HUNGER_RECOVERY, 0, MAX_STAT);
  agent.stats.happiness = clamp(agent.stats.happiness + 6, 0, MAX_STAT);
  agent.thought = 'Ate from the pantry.';
  return true;
};

const consumePackedLunch = (agent: Agent) => {
  if (agent.carriedMeals <= 0 || agent.stats.hunger < MAX_STAT) {
    return false;
  }

  agent.carriedMeals -= 1;
  agent.stats.hunger = clamp(agent.stats.hunger - PANTRY_MEAL_HUNGER_RECOVERY, 0, MAX_STAT);
  agent.stats.happiness = clamp(agent.stats.happiness + 4, 0, MAX_STAT);
  agent.thought = 'Ate packed lunch.';
  return true;
};

const packLunchFromHome = (agent: Agent, home: Building) => {
  if (home.pantryStock <= 0 || agent.carriedMeals >= PACKED_LUNCH_CAPACITY) {
    return false;
  }

  const packedMeals = Math.min(PACKED_LUNCH_CAPACITY - agent.carriedMeals, 1, home.pantryStock);
  if (packedMeals <= 0) {
    return false;
  }

  home.pantryStock -= packedMeals;
  agent.carriedMeals += packedMeals;
  return true;
};

const arriveAtBuilding = (
  agent: Agent,
  building: Building,
  buildingIndex: StepBuildingIndex,
  staffedCommercialCounts: StaffedCommercialCounts,
  shopSearchState: ShopSearchState,
  world: WorldState,
) => {
  if (agent.destination?.kind === 'work' && building.id === agent.workId) {
    recordShiftWork(agent, building, world);
    return;
  }

  switch (building.kind) {
    case BuildingKind.Residential: {
      if (agent.state !== AgentState.Sleeping) {
        consumePantryMeal(agent, building);
      }

      const committedToSleep = isCommittedToSleep(agent, world);
      const shouldContinueSleeping =
        agent.state === AgentState.Sleeping && (committedToSleep || isSleepHours(world.minutesOfDay));
      const shouldStartSleepBlock = agent.stats.energy <= getAgentSleepThreshold(agent) || isSleepHours(world.minutesOfDay);

      if (shouldContinueSleeping || shouldStartSleepBlock) {
        if (!committedToSleep && agent.state !== AgentState.Sleeping) {
          agent.sleepUntilTick = world.tick + getRequiredSleepTicks(agent);
        }
        agent.state = AgentState.Sleeping;
        agent.thought = 'Finally, a bed.';
        break;
      }

      agent.sleepUntilTick = undefined;
      agent.state = AgentState.Idle;
      agent.thought = 'Home for a minute.';
      break;
    }
    case BuildingKind.Industrial:
      recordShiftWork(agent, building, world);
      break;
    case BuildingKind.Commercial: {
      const home = getBuilding(buildingIndex, agent.homeId);
      const pantryGap = home ? Math.max(0, home.pantryCapacity - home.pantryStock) : 0;
      if (
        home &&
        pantryGap > 0 &&
        building.stock > 0 &&
        (staffedCommercialCounts.get(building.id) ?? 0) > 0 &&
        agent.lastShoppedTick !== world.tick
      ) {
        const transferredUnits = Math.min(
          getAgentShoppingBasketUnits(agent),
          pantryGap,
          building.stock,
          Math.floor(agent.wallet / SHOP_PRICE_PER_UNIT),
        );
        if (transferredUnits <= 0) {
          break;
        }

        const totalPrice = getRetailPrice(transferredUnits);
        const salesTax = getRetailSalesTax(transferredUnits);

        agent.state = AgentState.Shopping;
        agent.wallet -= totalPrice;
        building.stock -= transferredUnits;
        building.cash += totalPrice - salesTax;
        home.pantryStock += transferredUnits;
        world.economy.treasury += salesTax;
        agent.stats.happiness = clamp(agent.stats.happiness + 8, 0, MAX_STAT);
        agent.lastShoppedTick = world.tick;
        agent.memory.shoppingTrips += 1;
        agent.thought = 'Pantry restocked.';
        if (building.stock <= 0) {
          invalidateShopSearchState(shopSearchState);
        }
      }
      break;
    }
  }
};

const updateAgentStats = (agent: Agent) => {
  const sleeping = agent.state === AgentState.Sleeping;
  const working = agent.state === AgentState.Working;
  const shopping = agent.state === AgentState.Shopping;
  const staminaDrainMultiplier = clamp(1.5 - agent.traits.stamina * 0.5, 0.75, 1.15);
  const resiliencePenaltyMultiplier = getResiliencePenaltyMultiplier(agent);
  const commuteStress = Math.min(14, agent.memory.averageCommuteMinutes * 0.18);
  const hardshipStress = Math.min(18, agent.memory.recentHardshipDays * 3);
  const payrollStress = Math.min(10, agent.memory.unpaidHours * 0.45);

  agent.stats.hunger = clamp(agent.stats.hunger + (sleeping ? 0.03 : 0.09) * (0.82 + agent.traits.appetite * 0.36), 0, MAX_STAT);
  agent.stats.energy = clamp(
    agent.stats.energy +
      (sleeping
        ? SLEEP_ENERGY_RECOVERY_PER_TICK * (0.75 + agent.traits.stamina * 0.35)
        : (working ? -0.08 : -0.04) * staminaDrainMultiplier),
    0,
    MAX_STAT,
  );
  agent.stats.happiness = clamp(
    100 -
      agent.stats.hunger * 0.45 * resiliencePenaltyMultiplier -
      (MAX_STAT - agent.stats.energy) * 0.35 * resiliencePenaltyMultiplier -
      (commuteStress + hardshipStress + payrollStress) * resiliencePenaltyMultiplier +
      (shopping ? 5 : 0),
    0,
    MAX_STAT,
  );
  agent.keptMaxHungerToday = agent.keptMaxHungerToday && agent.stats.hunger >= MAX_STAT;

  if (agent.wallet <= 0 && agent.stats.hunger >= getAgentShoppingHungerThreshold(agent)) {
    agent.thought = 'Hungry, but broke.';
  }
};

const isOnBuildingTile = (agent: Agent, building?: Building) => {
  if (!building) {
    return false;
  }

  const tile = getAgentCurrentTile(agent);
  return tile.x === building.tile.x && tile.y === building.tile.y;
};

const getStaffedCommercialBuildingId = (
  world: WorldState,
  buildingIndex: StepBuildingIndex,
  agent: Agent,
  currentTile = getAgentCurrentTile(agent),
) => {
  const work = getBuilding(buildingIndex, agent.workId);
  if (!work || work.kind !== BuildingKind.Commercial) {
    return undefined;
  }

  if (currentTile.x !== work.tile.x || currentTile.y !== work.tile.y) {
    return undefined;
  }

  return hasActiveShift(agent) || isShiftDue(world, agent) ? work.id : undefined;
};

const addStaffedCommercialWorker = (counts: StaffedCommercialCounts, buildingId?: string) => {
  if (!buildingId) {
    return false;
  }

  const previous = counts.get(buildingId) ?? 0;
  counts.set(buildingId, previous + 1);
  return previous === 0;
};

const removeStaffedCommercialWorker = (counts: StaffedCommercialCounts, buildingId?: string) => {
  if (!buildingId) {
    return false;
  }

  const previous = counts.get(buildingId) ?? 0;
  const next = previous - 1;
  if (next > 0) {
    counts.set(buildingId, next);
    return false;
  }

  counts.delete(buildingId);
  return previous > 0;
};

const createShopSearchState = (): ShopSearchState => ({
  nearestByTile: [],
  primed: false,
});

const invalidateShopSearchState = (shopSearchState: ShopSearchState) => {
  shopSearchState.primed = false;
};

const primeShopSearchState = (
  world: WorldState,
  buildingIndex: StepBuildingIndex,
  staffedCommercialCounts: StaffedCommercialCounts,
  shopSearchState: ShopSearchState,
) => {
  if (shopSearchState.primed) {
    return;
  }

  const totalTiles = world.width * world.height;
  if (shopSearchState.nearestByTile.length !== totalTiles) {
    shopSearchState.nearestByTile = new Array<string | null>(totalTiles).fill(null);
  } else {
    shopSearchState.nearestByTile.fill(null);
  }

  const distances = new Int32Array(totalTiles);
  distances.fill(-1);
  const queue = new Int32Array(totalTiles);
  let head = 0;
  let tail = 0;

  for (const building of buildingIndex.commercial) {
    if (!canServeShopper(staffedCommercialCounts, building)) {
      continue;
    }

    const index = getPointIndex(world, building.tile);
    if (distances[index] !== -1) {
      continue;
    }

    distances[index] = 0;
    shopSearchState.nearestByTile[index] = building.id;
    queue[tail] = index;
    tail += 1;
  }

  while (head < tail) {
    const index = queue[head]!;
    head += 1;
    const nextDistance = distances[index]! + 1;
    const nearestBuildingId = shopSearchState.nearestByTile[index];
    if (!nearestBuildingId) {
      continue;
    }

    const x = index % world.width;
    const y = Math.floor(index / world.width);
    const neighbors = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];

    for (const [neighborX, neighborY] of neighbors) {
      if (neighborX < 0 || neighborY < 0 || neighborX >= world.width || neighborY >= world.height) {
        continue;
      }

      const neighborIndex = neighborY * world.width + neighborX;
      if (distances[neighborIndex] !== -1) {
        continue;
      }

      distances[neighborIndex] = nextDistance;
      shopSearchState.nearestByTile[neighborIndex] = nearestBuildingId;
      queue[tail] = neighborIndex;
      tail += 1;
    }
  }

  shopSearchState.primed = true;
};

const createStepScratch = (): StepScratch => ({
  buildingIndex: {
    byId: new Map(),
    residential: [],
    commercial: [],
    industrial: [],
  },
  buildingIndexBuildings: null,
  buildingIndexMapVersion: -1,
  reservations: new Map(),
  shopSearchMapVersion: -1,
  shopSearchServiceKey: '',
  shopSearchState: createShopSearchState(),
  staffedCommercialCounts: new Map(),
});

const defaultStepScratch = createStepScratch();

const initializeAgentStepState = (world: WorldState, buildingIndex: StepBuildingIndex, scratch: StepScratch) => {
  const reservations = scratch.reservations;
  const staffedCommercialCounts = scratch.staffedCommercialCounts;
  const traffic = world.traffic;
  reservations.clear();
  staffedCommercialCounts.clear();
  clearTraffic(traffic);
  let trafficPeak = 0;

  for (const agent of world.entities.agents) {
    const currentTile = getAgentCurrentTile(agent);
    const currentTileType = getTile(world, currentTile)?.type ?? TileType.Empty;
    const trafficKey = getAgentTrafficKey(world, agent, currentTile, currentTileType);
    const occupancy = (traffic[trafficKey] ?? 0) + 1;
    traffic[trafficKey] = occupancy;
    if (occupancy > trafficPeak) {
      trafficPeak = occupancy;
    }

    if (!allowsAgentOverlap(currentTileType)) {
      addReservation(reservations, trafficKey);
    }

    addStaffedCommercialWorker(
      staffedCommercialCounts,
      getStaffedCommercialBuildingId(world, buildingIndex, agent, currentTile),
    );
  }

  world.metrics.trafficPeak = trafficPeak;
  const serviceKey = getServiceableCommercialKey(buildingIndex, staffedCommercialCounts);
  if (scratch.shopSearchServiceKey !== serviceKey) {
    invalidateShopSearchState(scratch.shopSearchState);
    scratch.shopSearchServiceKey = serviceKey;
  }

  return {
    reservations,
    staffedCommercialCounts,
  };
};

const canServeShopper = (staffedCommercialCounts: StaffedCommercialCounts, building: Building) =>
  building.kind === BuildingKind.Commercial && building.stock > 0 && (staffedCommercialCounts.get(building.id) ?? 0) > 0;

const getServiceableCommercialKey = (
  buildingIndex: StepBuildingIndex,
  staffedCommercialCounts: StaffedCommercialCounts,
) => {
  const serviceableIds: string[] = [];

  for (const building of buildingIndex.commercial) {
    if (canServeShopper(staffedCommercialCounts, building)) {
      serviceableIds.push(building.id);
    }
  }

  return serviceableIds.join('|');
};

const getServiceableShopDestination = (
  buildingIndex: StepBuildingIndex,
  staffedCommercialCounts: StaffedCommercialCounts,
  destination?: AgentDestination,
) => {
  if (destination?.kind !== 'shop') {
    return undefined;
  }

  const building = getBuilding(buildingIndex, destination.buildingId);
  return building && canServeShopper(staffedCommercialCounts, building) ? destination : undefined;
};

const getNearestServiceableCommercialBuilding = (
  world: WorldState,
  buildingIndex: StepBuildingIndex,
  staffedCommercialCounts: StaffedCommercialCounts,
  shopSearchState: ShopSearchState,
  from: Point,
) => {
  if (stepWorldProfile) {
    stepWorldProfile.shopSearches += 1;
  }
  if (shopSearchState.primed) {
    if (stepWorldProfile) {
      stepWorldProfile.shopCacheHits += 1;
    }
    const cachedBuildingId = shopSearchState.nearestByTile[getPointIndex(world, from)] ?? null;
    return cachedBuildingId ? getBuilding(buildingIndex, cachedBuildingId) : undefined;
  }

  if (stepWorldProfile) {
    stepWorldProfile.shopCacheMisses += 1;
  }
  const searchStartedAt = stepWorldProfile ? nowMs() : 0;
  primeShopSearchState(world, buildingIndex, staffedCommercialCounts, shopSearchState);
  if (stepWorldProfile) {
    stepWorldProfile.shopSearchMs += nowMs() - searchStartedAt;
  }

  const cachedBuildingId = shopSearchState.nearestByTile[getPointIndex(world, from)] ?? null;
  if (cachedBuildingId !== null) {
    if (stepWorldProfile) {
      stepWorldProfile.shopCacheHits += 1;
    }
    return getBuilding(buildingIndex, cachedBuildingId);
  }

  return undefined;
};

const determineDestination = (
  world: WorldState,
  buildingIndex: StepBuildingIndex,
  staffedCommercialCounts: StaffedCommercialCounts,
  shopSearchState: ShopSearchState,
  agent: Agent,
): AgentDestination | undefined => {
  const home = getBuilding(buildingIndex, agent.homeId);
  const work = getBuilding(buildingIndex, agent.workId);
  const tile = getAgentCurrentTile(agent);
  const shoppingCooldownElapsed =
    agent.lastShoppedTick === undefined || world.tick - agent.lastShoppedTick >= SHOPPING_COOLDOWN_TICKS;
  const sleepingAtHome =
    home &&
    isOnBuildingTile(agent, home) &&
    agent.state === AgentState.Sleeping &&
    (isCommittedToSleep(agent, world) || isSleepHours(world.minutesOfDay));

  if (sleepingAtHome) {
    return { buildingId: home.id, kind: 'home' };
  }

  if (agent.stats.energy <= getAgentSleepThreshold(agent) && home) {
    return { buildingId: home.id, kind: 'home' };
  }

  if (hasActiveShift(agent) && work) {
    return { buildingId: work.id, kind: 'work' };
  }

  const emergencyFoodRun =
    agent.stats.hunger >= getAgentShoppingHungerThreshold(agent) && agent.carriedMeals <= 0 && (home?.pantryStock ?? 0) <= 0;
  const pantryRunFromHome =
    !!home &&
    homeNeedsPantryRefill(home) &&
    (isOnBuildingTile(agent, home) || agent.destination?.kind === 'shop');
  if ((emergencyFoodRun || pantryRunFromHome) && agent.wallet >= getMinimumShoppingCash() && shoppingCooldownElapsed) {
    const currentShopDestination = getServiceableShopDestination(buildingIndex, staffedCommercialCounts, agent.destination);
    if (currentShopDestination) {
      return currentShopDestination;
    }

    const shop = getNearestServiceableCommercialBuilding(world, buildingIndex, staffedCommercialCounts, shopSearchState, tile);
    if (shop) {
      return { buildingId: shop.id, kind: 'shop' };
    }
  }

  if (isSleepHours(world.minutesOfDay) && home) {
    return { buildingId: home.id, kind: 'home' };
  }

  if (home && !isOnBuildingTile(agent, home)) {
    return { buildingId: home.id, kind: 'home' };
  }

  return undefined;
};

const applyDestinationState = (agent: Agent, destination?: AgentDestination) => {
  if (!destination) {
    agent.state = AgentState.Idle;
    return;
  }

  switch (destination.kind) {
    case 'work':
      agent.state = AgentState.MovingToWork;
      agent.thought = 'Heading to the shift.';
      break;
    case 'shop':
      agent.state = AgentState.MovingToShop;
      agent.thought = 'Need food.';
      break;
    case 'home':
      agent.state = AgentState.MovingHome;
      agent.thought =
        agent.stats.hunger >= getAgentShoppingHungerThreshold(agent) && agent.wallet < getMinimumShoppingCash()
          ? 'Hungry, but broke.'
          : 'Going home.';
      break;
  }
};

const routeAgent = (
  world: WorldState,
  buildingIndex: StepBuildingIndex,
  staffedCommercialCounts: StaffedCommercialCounts,
  shopSearchState: ShopSearchState,
  agent: Agent,
  reservations: OccupancyReservations,
) => {
  const currentTile = getAgentCurrentTile(agent);
  const staffedBefore = getStaffedCommercialBuildingId(world, buildingIndex, agent, currentTile);
  activateShiftIfDue(world, agent);
  const home = getBuilding(buildingIndex, agent.homeId);
  const homeTile = home && currentTile.x === home.tile.x && currentTile.y === home.tile.y;
  if (agent.state !== AgentState.Sleeping) {
    if (homeTile) {
      packLunchFromHome(agent, home);
    }
    consumePackedLunch(agent);
    if (homeTile) {
      packLunchFromHome(agent, home);
    }
  }
  const destination = determineDestination(world, buildingIndex, staffedCommercialCounts, shopSearchState, agent);
  if (!destination) {
    if (home && isOnBuildingTile(agent, home) && agent.state !== AgentState.Sleeping) {
      consumePantryMeal(agent, home);
    }
    agent.destination = undefined;
    clearTravelTracking(agent);
    clearAgentRoute(agent);
    agent.state = AgentState.Idle;
    const staffedAfter = getStaffedCommercialBuildingId(world, buildingIndex, agent, currentTile);
    if (staffedBefore !== staffedAfter) {
      const lostService = removeStaffedCommercialWorker(staffedCommercialCounts, staffedBefore);
      const gainedService = addStaffedCommercialWorker(staffedCommercialCounts, staffedAfter);
      if (lostService || gainedService) {
        invalidateShopSearchState(shopSearchState);
      }
    }
    return;
  }

  if (
    agent.stats.hunger >= getAgentShoppingHungerThreshold(agent) &&
    (home?.pantryStock ?? 0) <= 0 &&
    agent.wallet < getMinimumShoppingCash()
  ) {
    agent.thought = 'Hungry, but broke.';
  }

  const building = getBuilding(buildingIndex, destination.buildingId);
  if (!building) {
    clearTravelTracking(agent);
    return;
  }

  if (currentTile.x === building.tile.x && currentTile.y === building.tile.y) {
    agent.destination = destination;
    recordTrackedArrival(agent, destination, world);
    clearAgentRoute(agent);
    arriveAtBuilding(agent, building, buildingIndex, staffedCommercialCounts, shopSearchState, world);
    return;
  }

  beginTrackedTravel(agent, destination, world);
  applyDestinationState(agent, destination);
  assignRoute(world, buildingIndex, agent, destination, building.tile);
  moveAgent(world, agent, reservations);

  const arrivedTile = getAgentCurrentTile(agent);
  if (arrivedTile.x === building.tile.x && arrivedTile.y === building.tile.y) {
    recordTrackedArrival(agent, destination, world);
    arriveAtBuilding(agent, building, buildingIndex, staffedCommercialCounts, shopSearchState, world);
  }

  const staffedAfter = getStaffedCommercialBuildingId(world, buildingIndex, agent, arrivedTile);
  if (staffedBefore !== staffedAfter) {
    const lostService = removeStaffedCommercialWorker(staffedCommercialCounts, staffedBefore);
    const gainedService = addStaffedCommercialWorker(staffedCommercialCounts, staffedAfter);
    if (lostService || gainedService) {
      invalidateShopSearchState(shopSearchState);
    }
  }
};

const restockCommercialBuildings = (
  world: WorldState,
  buildingIndex: StepBuildingIndex,
  shopSearchState: ShopSearchState,
) => {
  if (world.minutesOfDay % 60 !== 0) {
    return;
  }

  const industries = getBuildingsByKind(buildingIndex, BuildingKind.Industrial);
  const shops = getBuildingsByKind(buildingIndex, BuildingKind.Commercial);
  let industryIndex = 0;
  let didRestockAnyShop = false;

  for (const shop of shops) {
    let needed = Math.max(0, shop.capacity - shop.stock);

    while (needed > 0 && industryIndex < industries.length) {
      const source = industries[industryIndex]!;
      if (source.stock <= 0) {
        industryIndex += 1;
        continue;
      }

      const affordableUnits = Math.floor(shop.cash / WHOLESALE_PRICE_PER_UNIT);
      if (affordableUnits <= 0) {
        break;
      }

      const transfer = Math.min(COMMERCIAL_RESTOCK_PER_HOUR, needed, source.stock, affordableUnits);
      const wholesaleCost = getWholesaleCost(transfer);

      if (transfer <= 0 || wholesaleCost <= 0) {
        break;
      }

      shop.cash -= wholesaleCost;
      source.cash += wholesaleCost;
      source.stock -= transfer;
      shop.stock += transfer;
      needed -= transfer;
      didRestockAnyShop = true;

      if (source.stock <= 0) {
        industryIndex += 1;
      }
    }
  }

  if (didRestockAnyShop) {
    invalidateShopSearchState(shopSearchState);
  }
};

const subsidizeBusinesses = (world: WorldState, buildingIndex: StepBuildingIndex) => {
  if (world.minutesOfDay % 60 !== 0) {
    return;
  }

  let availableSubsidy = Math.max(0, world.economy.treasury - TREASURY_RESERVE_TARGET);
  if (availableSubsidy <= 0) {
    return;
  }

  const assignedWorkersByBuilding = new Map<string, number>();
  for (const agent of world.entities.agents) {
    assignedWorkersByBuilding.set(agent.workId, (assignedWorkersByBuilding.get(agent.workId) ?? 0) + 1);
  }

  const getSupportTargetCash = (baseTargetCash: number, assignedWorkers: number) =>
    Math.max(
      baseTargetCash,
      assignedWorkers * HOURLY_WAGE * (WORK_SHIFT_MINUTES / 60) * BUSINESS_SUPPORT_RESERVE_DAYS,
    );
  const getHourlyPayroll = (assignedWorkers: number) => Math.max(HOURLY_WAGE, assignedWorkers * HOURLY_WAGE);
  const businessesNeedingSupport = [
    ...getBuildingsByKind(buildingIndex, BuildingKind.Commercial).map((building) => ({
      building,
      assignedWorkers: assignedWorkersByBuilding.get(building.id) ?? 0,
      baseTargetCash: COMMERCIAL_STARTING_CASH,
      subsidyPerHour: COMMERCIAL_SUBSIDY_PER_HOUR,
    })),
    ...getBuildingsByKind(buildingIndex, BuildingKind.Industrial).map((building) => ({
      building,
      assignedWorkers: assignedWorkersByBuilding.get(building.id) ?? 0,
      baseTargetCash: INDUSTRIAL_STARTING_CASH,
      subsidyPerHour: INDUSTRIAL_SUBSIDY_PER_HOUR,
    })),
  ].map(({ assignedWorkers, baseTargetCash, ...business }) => ({
    ...business,
    assignedWorkers,
    targetCash: getSupportTargetCash(baseTargetCash, assignedWorkers),
    hourlyPayroll: getHourlyPayroll(assignedWorkers),
  }))
    .filter(({ building, targetCash }) => building.cash < targetCash)
    .sort(
      (left, right) =>
        right.targetCash - right.building.cash - (left.targetCash - left.building.cash) ||
        left.building.cash / left.hourlyPayroll - right.building.cash / right.hourlyPayroll ||
        left.building.cash / left.targetCash - right.building.cash / right.targetCash ||
        left.building.cash - right.building.cash ||
        left.building.id.localeCompare(right.building.id),
    );

  for (const { building, targetCash, subsidyPerHour } of businessesNeedingSupport) {
    if (availableSubsidy <= 0) {
      break;
    }

    const grant = Math.min(subsidyPerHour, targetCash - building.cash, availableSubsidy);
    if (grant <= 0) {
      continue;
    }

    building.cash += grant;
    world.economy.treasury -= grant;
    availableSubsidy -= grant;
  }
};

const nextAgentId = (world: WorldState) => {
  let highestNumericId = 0;

  for (const agent of world.entities.agents) {
    const match = /^agent-(\d+)$/.exec(agent.id);
    if (!match) {
      continue;
    }

    highestNumericId = Math.max(highestNumericId, Number(match[1]));
  }

  return `agent-${highestNumericId + 1}`;
};

const pickHomeWithCapacity = (
  homes: Building[],
  occupied: Map<string, number>,
  preferredHomeId?: string,
  from?: Point,
) => {
  const candidates = homes.filter((building) => (occupied.get(building.id) ?? 0) < building.capacity);
  if (candidates.length === 0) {
    return undefined;
  }

  if (preferredHomeId) {
    const preferred = candidates.find((building) => building.id === preferredHomeId);
    if (preferred) {
      return preferred;
    }
  }

  if (!from) {
    return candidates[0];
  }

  return candidates.reduce<Building | undefined>((nearest, candidate) => {
    if (!nearest) {
      return candidate;
    }

    const nearestDistance = Math.abs(nearest.tile.x - from.x) + Math.abs(nearest.tile.y - from.y);
    const candidateDistance = Math.abs(candidate.tile.x - from.x) + Math.abs(candidate.tile.y - from.y);
    if (candidateDistance < nearestDistance) {
      return candidate;
    }

    if (candidateDistance === nearestDistance && candidate.id < nearest.id) {
      return candidate;
    }

    return nearest;
  }, undefined);
};

const qualifiesForHouseholdGrowth = (agent: Agent) =>
  agent.wallet >= HOUSEHOLD_GROWTH_WALLET_THRESHOLD &&
  agent.stats.happiness >= HOUSEHOLD_GROWTH_HAPPINESS_THRESHOLD &&
  agent.memory.recentHardshipDays === 0 &&
  agent.memory.unpaidHours < 4;

const appendUniqueRelationship = (relationships: string[], relatedAgentId: string) => {
  if (!relationships.includes(relatedAgentId)) {
    relationships.push(relatedAgentId);
  }
};

const areOpposingSexes = (first: Agent, second: Agent) => first.sex !== second.sex;

const hasOppositeSexResident = (agent: Agent, residents: Agent[]) =>
  residents.some((resident) => resident.id !== agent.id && resident.sex !== agent.sex);

const getHouseholdGrowthScore = (agent: Agent) =>
  agent.wallet - HOUSEHOLD_GROWTH_WALLET_THRESHOLD +
  (agent.stats.happiness - HOUSEHOLD_GROWTH_HAPPINESS_THRESHOLD) * 10;

const getEligibleHouseholdGrowthPair = (residents: Agent[]) => {
  const eligibleResidents = residents
    .filter(qualifiesForHouseholdGrowth)
    .sort(
      (left, right) =>
        getHouseholdGrowthScore(right) - getHouseholdGrowthScore(left) || left.id.localeCompare(right.id),
    );

  for (let leftIndex = 0; leftIndex < eligibleResidents.length; leftIndex += 1) {
    const firstParent = eligibleResidents[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < eligibleResidents.length; rightIndex += 1) {
      const secondParent = eligibleResidents[rightIndex]!;
      if (areOpposingSexes(firstParent, secondParent)) {
        return [firstParent, secondParent] as const;
      }
    }
  }

  return undefined;
};

type RelocationReason = 'solo' | 'sameSexRoommates';

const getRelocationReason = (agent: Agent, residents: Agent[]): RelocationReason | undefined => {
  if (residents.length === 1 && residents[0]?.id === agent.id) {
    return 'solo';
  }

  if (residents.length > 1 && !hasOppositeSexResident(agent, residents)) {
    return 'sameSexRoommates';
  }

  return undefined;
};

const getRelocationOpportunityScore = (agent: Agent, targetResidents: Agent[]) => {
  const oppositeSexResidents = targetResidents.filter((resident) => resident.sex !== agent.sex).length;
  const sameSexResidents = targetResidents.length - oppositeSexResidents;
  const createsEligiblePair = getEligibleHouseholdGrowthPair(targetResidents.concat(agent)) !== undefined;

  return (
    (createsEligiblePair ? 100000 : 0) +
    oppositeSexResidents * 1000 +
    targetResidents.length * 100 -
    sameSexResidents * 10
  );
};

const pickRelocationHome = (
  homes: Building[],
  households: Map<string, Agent[]>,
  occupied: Map<string, number>,
  agent: Agent,
  reason: RelocationReason,
) => {
  let chosen: Building | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const home of homes) {
    if (home.id === agent.homeId) {
      continue;
    }

    const residents = households.get(home.id) ?? [];
    const occupancy = occupied.get(home.id) ?? 0;
    if (residents.length <= 0 || occupancy >= home.capacity) {
      continue;
    }
    if (reason === 'sameSexRoommates' && !hasOppositeSexResident(agent, residents)) {
      continue;
    }

    const score = getRelocationOpportunityScore(agent, residents);
    const distance = Math.abs(home.tile.x - agent.pos.x) + Math.abs(home.tile.y - agent.pos.y);
    if (
      !chosen ||
      score > bestScore ||
      (score === bestScore && distance < bestDistance) ||
      (score === bestScore && distance === bestDistance && home.id < chosen.id)
    ) {
      chosen = home;
      bestScore = score;
      bestDistance = distance;
    }
  }

  return chosen;
};

const consolidateHouseholds = (
  homes: Building[],
  households: Map<string, Agent[]>,
  occupied: Map<string, number>,
) => {
  const relocationCandidates = Array.from(households.values())
    .flatMap((residents) =>
      residents
        .map((agent) => ({
          agent,
          reason: getRelocationReason(agent, residents),
        }))
        .filter((entry): entry is { agent: Agent; reason: RelocationReason } => entry.reason !== undefined),
    )
    .sort(
      (left, right) =>
        Number(right.reason === 'solo') - Number(left.reason === 'solo') ||
        Number(qualifiesForHouseholdGrowth(right.agent)) - Number(qualifiesForHouseholdGrowth(left.agent)) ||
        getHouseholdGrowthScore(right.agent) - getHouseholdGrowthScore(left.agent) ||
        left.agent.id.localeCompare(right.agent.id),
    );

  for (const { agent } of relocationCandidates) {
    const currentResidents = households.get(agent.homeId);
    if (!currentResidents) {
      continue;
    }

    const reason = getRelocationReason(agent, currentResidents);
    if (!reason) {
      continue;
    }

    const targetHome = pickRelocationHome(homes, households, occupied, agent, reason);
    if (!targetHome) {
      continue;
    }

    households.delete(agent.homeId);
    occupied.delete(agent.homeId);

    const targetResidents = households.get(targetHome.id);
    if (targetResidents) {
      targetResidents.push(agent);
    } else {
      households.set(targetHome.id, [agent]);
    }
    occupied.set(targetHome.id, (occupied.get(targetHome.id) ?? 0) + 1);
    relocateAgentHome(agent, targetHome);
  }
};

const getFather = (firstParent: Agent, secondParent: Agent) =>
  firstParent.sex === AgentSex.Male ? firstParent : secondParent;

const createHouseholdGrowthAgent = (
  world: WorldState,
  home: Building,
  assignment: NonNullable<ReturnType<typeof pickEmploymentAssignment>>,
  firstParent: Agent,
  secondParent: Agent,
) => {
  const childSex = createSeededAgentSex(world.seed, [
    world.day,
    world.tick,
    world.entities.agents.length + 1,
    home.tile.x,
    home.tile.y,
    assignment.shiftStartMinute,
    firstParent.sex === AgentSex.Female ? 1 : 2,
    secondParent.sex === AgentSex.Female ? 1 : 2,
  ]);
  const fatherLastName = getLastName(getFather(firstParent, secondParent).name);

  return {
    id: nextAgentId(world),
    name: createRuntimeAgentName(world, home.tile, assignment.shiftStartMinute, childSex, fatherLastName),
    age: 0,
    sex: childSex,
    pos: { x: home.tile.x + 0.5, y: home.tile.y + 0.5 },
    wallet: 18,
    carriedMeals: 0,
    stats: { hunger: 24, energy: 72, happiness: 64 },
    traits: createInheritedAgentTraits(world.seed, firstParent, secondParent, [
      world.day,
      world.tick,
      world.entities.agents.length + 1,
      home.tile.x,
      home.tile.y,
      assignment.shiftStartMinute,
    ]),
    memory: createAgentMemory(),
    homeId: home.id,
    workId: assignment.workId,
    parentIds: [firstParent.id, secondParent.id],
    childIds: [],
    coParentIds: [],
    state: AgentState.Idle,
    thought: 'New to the household.',
    route: [],
    routeIndex: 0,
    routeComputeCount: 0,
    routeMapVersion: world.metrics.mapVersion,
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
};

const recordHouseholdGrowthRelationships = (firstParent: Agent, secondParent: Agent, child: Agent) => {
  appendUniqueRelationship(firstParent.childIds, child.id);
  appendUniqueRelationship(secondParent.childIds, child.id);
  appendUniqueRelationship(firstParent.coParentIds, secondParent.id);
  appendUniqueRelationship(secondParent.coParentIds, firstParent.id);
};

const createObituaryEntry = (agent: Agent, world: WorldState, cause: ObituaryEntry['cause']): ObituaryEntry => ({
  agentId: agent.id,
  agentName: agent.name,
  age: agent.age,
  cause,
  day: world.day,
});

const collectLivingRelationRecipients = (relationIds: string[], livingAgentsById: Map<string, Agent>) =>
  Array.from(
    relationIds.reduce((recipients, relationId) => {
      const livingRelation = livingAgentsById.get(relationId);
      if (livingRelation) {
        recipients.set(livingRelation.id, livingRelation);
      }
      return recipients;
    }, new Map<string, Agent>()),
    ([, agent]) => agent,
  );

const distributeInheritance = (amount: number, recipients: Agent[]) => {
  if (amount <= 0 || recipients.length === 0) {
    return;
  }

  const orderedRecipients = recipients.slice().sort((left, right) => left.id.localeCompare(right.id));
  const share = Math.floor(amount / orderedRecipients.length);
  let remainder = amount % orderedRecipients.length;

  for (const recipient of orderedRecipients) {
    recipient.wallet += share;
    if (remainder > 0) {
      recipient.wallet += 1;
      remainder -= 1;
    }
  }
};

const transferDeceasedWallet = (world: WorldState, deceasedAgent: Agent, livingAgentsById: Map<string, Agent>) => {
  if (deceasedAgent.wallet <= 0) {
    return;
  }

  const inheritanceTax = Math.floor(deceasedAgent.wallet * INHERITANCE_TAX_RATE);
  const distributableEstate = deceasedAgent.wallet - inheritanceTax;
  const livingCoParents = collectLivingRelationRecipients(deceasedAgent.coParentIds, livingAgentsById);
  if (livingCoParents.length > 0) {
    world.economy.treasury += inheritanceTax;
    distributeInheritance(distributableEstate, livingCoParents);
    deceasedAgent.wallet = 0;
    return;
  }

  const livingChildren = collectLivingRelationRecipients(deceasedAgent.childIds, livingAgentsById);
  if (livingChildren.length > 0) {
    world.economy.treasury += inheritanceTax;
    distributeInheritance(distributableEstate, livingChildren);
    deceasedAgent.wallet = 0;
    return;
  }

  world.economy.treasury += deceasedAgent.wallet;
  deceasedAgent.wallet = 0;
};

const runPopulationTurnover = (world: WorldState, buildingIndex: StepBuildingIndex) => {
  if (world.minutesOfDay !== 0) {
    return;
  }

  for (const agent of world.entities.agents) {
    agent.age += 1;
    agent.daysInCity += 1;
    agent.maxHungerStreakDays =
      agent.keptMaxHungerToday && agent.stats.hunger >= MAX_STAT ? agent.maxHungerStreakDays + 1 : 0;
    agent.memory.recentHardshipDays = agent.keptMaxHungerToday && agent.stats.hunger >= MAX_STAT
      ? agent.memory.recentHardshipDays + 1
      : Math.max(0, agent.memory.recentHardshipDays - 1);
    agent.keptMaxHungerToday = agent.stats.hunger >= MAX_STAT;
  }

  const survivors: Agent[] = [];
  const deceasedAgents: Agent[] = [];
  const obituaryEntries: ObituaryEntry[] = [];

  for (const agent of world.entities.agents) {
    const cause =
      agent.maxHungerStreakDays >= STARVATION_CULL_DAYS
        ? 'starvation'
        : agent.age >= MAX_AGENT_AGE
          ? 'old_age'
          : undefined;

    if (cause) {
      deceasedAgents.push(agent);
      obituaryEntries.push(createObituaryEntry(agent, world, cause));
      continue;
    }

    survivors.push(agent);
  }

  const survivorsById = new Map(survivors.map((agent) => [agent.id, agent]));
  for (const deceasedAgent of deceasedAgents) {
    transferDeceasedWallet(world, deceasedAgent, survivorsById);
  }

  world.entities.agents = survivors;
  if (obituaryEntries.length > 0) {
    world.obituary = obituaryEntries.concat(world.obituary);
  }
  if (world.selectedAgentId && !world.entities.agents.some((agent) => agent.id === world.selectedAgentId)) {
    world.selectedAgentId = undefined;
  }

  const homes = getBuildingsByKind(buildingIndex, BuildingKind.Residential);
  let capacity = 0;
  for (const home of homes) {
    capacity += home.capacity;
  }
  const occupied = new Map<string, number>();
  const households = new Map<string, Agent[]>();

  for (const agent of world.entities.agents) {
    occupied.set(agent.homeId, (occupied.get(agent.homeId) ?? 0) + 1);
    const residents = households.get(agent.homeId);
    if (residents) {
      residents.push(agent);
    } else {
      households.set(agent.homeId, [agent]);
    }
  }

  consolidateHouseholds(homes, households, occupied);

  if (capacity - world.entities.agents.length > 0) {
    const growthHomes = homes.filter((home) => {
      const residents = households.get(home.id) ?? [];
      return getEligibleHouseholdGrowthPair(residents) !== undefined;
    });

    growthHomes.sort((left, right) => {
      const leftResidents = households.get(left.id) ?? [];
      const rightResidents = households.get(right.id) ?? [];
      const leftSurplus = leftResidents.reduce(
        (sum, agent) => sum + Math.max(0, getHouseholdGrowthScore(agent)),
        0,
      );
      const rightSurplus = rightResidents.reduce(
        (sum, agent) => sum + Math.max(0, getHouseholdGrowthScore(agent)),
        0,
      );

      return rightSurplus - leftSurplus || left.id.localeCompare(right.id);
    });

    for (const home of growthHomes) {
      if (world.entities.agents.length >= capacity) {
        break;
      }

      const residents = households.get(home.id) ?? [];
      const parentPair = getEligibleHouseholdGrowthPair(residents);
      if (!parentPair) {
        continue;
      }

      const targetHome = pickHomeWithCapacity(homes, occupied, home.id, home.tile);
      if (!targetHome) {
        break;
      }

      const assignment = pickEmploymentAssignment(
        world.entities.buildings,
        world.entities.agents.map((agent) => ({
          workId: agent.workId,
          shiftStartMinute: agent.shiftStartMinute,
        })),
      );
      if (!assignment) {
        break;
      }

      const [firstParent, secondParent] = parentPair;
      firstParent.wallet -= HOUSEHOLD_GROWTH_COST;
      secondParent.wallet -= HOUSEHOLD_GROWTH_COST;
      world.economy.treasury += HOUSEHOLD_GROWTH_COST * 2;
      const child = createHouseholdGrowthAgent(world, targetHome, assignment, firstParent, secondParent);
      recordHouseholdGrowthRelationships(firstParent, secondParent, child);
      world.entities.agents.push(child);
      occupied.set(targetHome.id, (occupied.get(targetHome.id) ?? 0) + 1);
      const targetResidents = households.get(targetHome.id);
      if (targetResidents) {
        targetResidents.push(world.entities.agents[world.entities.agents.length - 1]!);
      } else {
        households.set(targetHome.id, [world.entities.agents[world.entities.agents.length - 1]!]);
      }
    }
  }

  world.metrics.populationCapacity = capacity;
};

export const stepWorldInPlace = (world: WorldState): WorldState => {
  const profile = stepWorldProfile;
  const tickStartedAt = profile ? nowMs() : 0;
  const buildingIndexStartedAt = profile ? tickStartedAt : 0;
  const buildingIndex = getBuildingIndex(world, defaultStepScratch);
  if (profile) {
    profile.buildingIndexMs += nowMs() - buildingIndexStartedAt;
  }
  const shopSearchState = defaultStepScratch.shopSearchState;
  if (defaultStepScratch.shopSearchMapVersion !== world.metrics.mapVersion) {
    invalidateShopSearchState(shopSearchState);
    defaultStepScratch.shopSearchMapVersion = world.metrics.mapVersion;
  }
  world.tick += 1;
  world.minutesOfDay += gameMinutesPerTick;

  if (world.minutesOfDay >= dayMinutes) {
    world.minutesOfDay = 0;
    world.day += 1;
  }

  const hourlyStartedAt = profile ? nowMs() : 0;
  subsidizeBusinesses(world, buildingIndex);
  restockCommercialBuildings(world, buildingIndex, shopSearchState);
  if (profile) {
    profile.hourlyMs += nowMs() - hourlyStartedAt;
  }
  const initStartedAt = profile ? nowMs() : 0;
  const { reservations, staffedCommercialCounts } = initializeAgentStepState(world, buildingIndex, defaultStepScratch);
  if (profile) {
    profile.initMs += nowMs() - initStartedAt;
  }
  for (const agent of world.entities.agents) {
    const agentStatsStartedAt = profile ? nowMs() : 0;
    updateAgentStats(agent);
    if (profile) {
      profile.agentStatsMs += nowMs() - agentStatsStartedAt;
    }
    const routeStartedAt = profile ? nowMs() : 0;
    routeAgent(world, buildingIndex, staffedCommercialCounts, shopSearchState, agent, reservations);
    if (profile) {
      profile.routeMs += nowMs() - routeStartedAt;
    }
  }
  const populationStartedAt = profile ? nowMs() : 0;
  runPopulationTurnover(world, buildingIndex);
  if (profile) {
    profile.populationMs += nowMs() - populationStartedAt;
  }
  const economyStartedAt = profile ? nowMs() : 0;
  updateEconomyTotals(world);
  if (profile) {
    profile.economyMs += nowMs() - economyStartedAt;
    profile.samples += 1;
    profile.maxTickMs = Math.max(profile.maxTickMs, nowMs() - tickStartedAt);
  }

  return world;
};

export const stepWorld = (inputWorld: WorldState): WorldState => stepWorldInPlace(cloneWorldForStep(inputWorld));

export const advanceWorld = (
  world: WorldState,
  elapsedMs: number,
  carryMs = 0,
  options?: { maxElapsedMs?: number },
): SimulationAdvanceResult => {
  let currentWorld = world;
  let budget = carryMs + elapsedMs;
  let stepsApplied = 0;
  const epsilon = 1e-9;
  const maxElapsedMs = options?.maxElapsedMs ?? Number.POSITIVE_INFINITY;

  budget = Math.min(budget, maxElapsedMs);

  while (budget + epsilon >= msPerTick) {
    currentWorld = stepWorld(currentWorld);
    budget -= msPerTick;
    stepsApplied += 1;
  }

  return {
    world: currentWorld,
    carryMs: budget,
    stepsApplied,
  };
};

export const summarizeWorld = (world: WorldState) => ({
  day: world.day,
  time: formatClock(world.minutesOfDay),
  timeCode: toClockNumber(world.minutesOfDay),
  population: world.entities.agents.length,
  treasury: world.economy.treasury,
});
