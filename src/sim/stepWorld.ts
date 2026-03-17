import {
  BASE_MOVE_SPEED,
  COMMERCIAL_RESTOCK_PER_HOUR,
  HOURLY_WAGE,
  PANTRY_MEAL_HUNGER_RECOVERY,
  INDUSTRIAL_OUTPUT_PER_HOUR,
  MAX_STAT,
  ROAD_SPEED_MULTIPLIER,
  SHOPPING_COOLDOWN_TICKS,
  SHOPPING_BASKET_UNITS,
  SHOPPING_HUNGER_THRESHOLD,
  SHOP_PRICE,
  SLEEP_END_MINUTE,
  SLEEP_ENERGY_RECOVERY_PER_TICK,
  SLEEP_MINIMUM_MINUTES,
  SLEEP_TARGET_ENERGY,
  SLEEP_ENERGY_THRESHOLD,
  SLEEP_START_MINUTE,
  STARVATION_CULL_DAYS,
  WORK_START_MINUTE,
  WORK_SHIFT_MINUTES,
  dayMinutes,
  gameMinutesPerTick,
  msPerTick,
} from './constants';
import { findPath } from './pathfinding';
import { getCongestionSpeedFactor } from './traffic';
import {
  Agent,
  AgentDestination,
  AgentState,
  Building,
  BuildingKind,
  Point,
  TileType,
  WorldState,
  SimulationAdvanceResult,
} from './types';
import {
  clamp,
  distance,
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

const isPastWorkStart = (minutes: number) => minutes >= WORK_START_MINUTE;
const isSleepHours = (minutes: number) => minutes >= SLEEP_START_MINUTE || minutes < SLEEP_END_MINUTE;
const hasActiveShift = (agent: Agent) => agent.shiftDay > 0 && agent.shiftWorkMinutes < WORK_SHIFT_MINUTES;
const isCommittedToSleep = (agent: Agent, world: WorldState) =>
  agent.sleepUntilTick !== undefined && world.tick < agent.sleepUntilTick;
const overlapAllowedTileTypes = new Set<TileType>([
  TileType.Residential,
  TileType.Commercial,
  TileType.Industrial,
]);
const ROAD_RIGHT_OF_WAY_EPSILON = 1e-3;
type OccupancyReservations = Map<string, number>;
type StepBuildingIndex = {
  byId: Map<string, Building>;
  residential: Building[];
  commercial: Building[];
  industrial: Building[];
};

const cloneWorldForStep = (world: WorldState): WorldState => ({
  ...world,
  economy: { ...world.economy },
  entities: {
    agents: world.entities.agents.map((agent) => ({
      ...agent,
      pos: { ...agent.pos },
      stats: { ...agent.stats },
      route: agent.route.slice(),
      destination: agent.destination ? { ...agent.destination } : undefined,
    })),
    buildings: world.entities.buildings.map((building) => ({
      ...building,
    })),
  },
  traffic: {},
  metrics: { ...world.metrics },
});

const createBuildingIndex = (world: WorldState): StepBuildingIndex => {
  const byId = new Map<string, Building>();
  const residential: Building[] = [];
  const commercial: Building[] = [];
  const industrial: Building[] = [];

  for (const building of world.entities.buildings) {
    byId.set(building.id, building);
    switch (building.kind) {
      case BuildingKind.Residential:
        residential.push(building);
        break;
      case BuildingKind.Commercial:
        commercial.push(building);
        break;
      case BuildingKind.Industrial:
        industrial.push(building);
        break;
    }
  }

  return {
    byId,
    residential,
    commercial,
    industrial,
  };
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

const createOccupancyReservations = (world: WorldState) => {
  const reservations: OccupancyReservations = new Map();

  for (const agent of world.entities.agents) {
    const currentTile = getAgentCurrentTile(agent);
    const currentTileType = getTile(world, currentTile)?.type ?? TileType.Empty;
    if (allowsAgentOverlap(currentTileType)) {
      continue;
    }

    addReservation(reservations, getAgentTrafficKey(world, agent, currentTile, currentTileType));
  }

  return reservations;
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
const getRequiredSleepTicks = (agent: Agent) => {
  const minimumSleepTicks = Math.ceil(SLEEP_MINIMUM_MINUTES / gameMinutesPerTick);
  const missingEnergy = Math.max(0, SLEEP_TARGET_ENERGY - agent.stats.energy);
  const energyRecoveryTicks = Math.ceil(missingEnergy / SLEEP_ENERGY_RECOVERY_PER_TICK);
  return Math.max(minimumSleepTicks, energyRecoveryTicks);
};

const getBuilding = (buildingIndex: StepBuildingIndex, buildingId: string) => buildingIndex.byId.get(buildingId);
const getHomePantryReorderPoint = (home: Building) => Math.max(1, Math.floor(home.pantryCapacity / 3));
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

const computeTraffic = (world: WorldState) => {
  const traffic: Record<string, number> = {};
  let trafficPeak = 0;

  for (const agent of world.entities.agents) {
    const currentTile = getAgentCurrentTile(agent);
    const currentTileType = getTile(world, currentTile)?.type ?? TileType.Empty;
    const key = getAgentTrafficKey(world, agent, currentTile, currentTileType);
    const occupancy = (traffic[key] ?? 0) + 1;
    traffic[key] = occupancy;
    if (occupancy > trafficPeak) {
      trafficPeak = occupancy;
    }
  }

  world.traffic = traffic;
  world.metrics.trafficPeak = trafficPeak;
};

const updateEconomyTotals = (world: WorldState) => {
  let walletTotal = 0;
  let stockTotal = 0;
  let pantryTotal = 0;

  for (const agent of world.entities.agents) {
    walletTotal += agent.wallet;
  }

  for (const building of world.entities.buildings) {
    stockTotal += building.stock;
    pantryTotal += building.pantryStock;
  }

  world.economy.supplyStock = stockTotal + pantryTotal;
  world.economy.totalWealth = world.economy.treasury + walletTotal + (stockTotal + pantryTotal) * 2;
};

const assignRoute = (world: WorldState, agent: Agent, destination: AgentDestination, targetPoint: Point) => {
  const currentTile = getAgentCurrentTile(agent);
  const needsRecompute =
    agent.destination?.buildingId !== destination.buildingId ||
    agent.destination?.kind !== destination.kind ||
    agent.routeMapVersion !== world.metrics.mapVersion ||
    agent.route.length === 0 ||
    !samePoint(agent.route.at(-1), targetPoint);

  if (!needsRecompute) {
    return;
  }

  const path = findPath(world, currentTile, targetPoint);
  if (!path) {
    agent.route = [];
    agent.routeIndex = 0;
    agent.destination = undefined;
    agent.thought = 'No route available.';
    return;
  }

  agent.destination = destination;
  agent.route = path;
  agent.routeIndex = Math.min(1, Math.max(path.length - 1, 0));
  agent.routeComputeCount += 1;
  agent.routeMapVersion = world.metrics.mapVersion;
  world.metrics.pathComputations += 1;
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
  const remainingDistance = distance(agent.pos, target);
  if (remainingDistance <= stepDistance) {
    agent.pos = target;
    return true;
  }

  if (direction === 'east' || direction === 'west') {
    const yMove = moveAxisToward(agent.pos.y, target.y, stepDistance);
    const xMove = moveAxisToward(agent.pos.x, target.x, stepDistance - yMove.used);
    agent.pos = { x: xMove.value, y: yMove.value };
    return false;
  }

  if (direction === 'north' || direction === 'south') {
    const xMove = moveAxisToward(agent.pos.x, target.x, stepDistance);
    const yMove = moveAxisToward(agent.pos.y, target.y, stepDistance - xMove.used);
    agent.pos = { x: xMove.value, y: yMove.value };
    return false;
  }

  const ratio = stepDistance / remainingDistance;
  agent.pos = {
    x: agent.pos.x + (target.x - agent.pos.x) * ratio,
    y: agent.pos.y + (target.y - agent.pos.y) * ratio,
  };
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
  const shouldStartShift =
    isPastWorkStart(world.minutesOfDay) && agent.shiftDay < world.day && agent.lastCompletedShiftDay < world.day;

  if (!shouldStartShift) {
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
  agent.thought = 'Clocked in.';
  agent.shiftWorkMinutes = Math.min(agent.shiftWorkMinutes + gameMinutesPerTick, WORK_SHIFT_MINUTES);

  while (agent.shiftWorkMinutes - agent.paidShiftWorkMinutes >= 60) {
    agent.wallet += HOURLY_WAGE;
    building.stock += INDUSTRIAL_OUTPUT_PER_HOUR;
    world.economy.treasury = Math.max(0, world.economy.treasury - HOURLY_WAGE);
    agent.paidShiftWorkMinutes += 60;
  }

  if (agent.shiftWorkMinutes >= WORK_SHIFT_MINUTES) {
    agent.lastCompletedShiftDay = world.day;
    agent.thought = 'Shift done.';
  }
};

const consumePantryMeal = (agent: Agent, home: Building) => {
  if (home.pantryStock <= 0 || agent.stats.hunger < SHOPPING_HUNGER_THRESHOLD) {
    return false;
  }

  home.pantryStock -= 1;
  agent.stats.hunger = clamp(agent.stats.hunger - PANTRY_MEAL_HUNGER_RECOVERY, 0, MAX_STAT);
  agent.stats.happiness = clamp(agent.stats.happiness + 6, 0, MAX_STAT);
  agent.thought = 'Ate from the pantry.';
  return true;
};

const arriveAtBuilding = (agent: Agent, building: Building, buildingIndex: StepBuildingIndex, world: WorldState) => {
  switch (building.kind) {
    case BuildingKind.Residential: {
      if (agent.state !== AgentState.Sleeping) {
        consumePantryMeal(agent, building);
      }

      const committedToSleep = isCommittedToSleep(agent, world);
      const shouldContinueSleeping =
        agent.state === AgentState.Sleeping && (committedToSleep || isSleepHours(world.minutesOfDay));
      const shouldStartSleepBlock = agent.stats.energy <= SLEEP_ENERGY_THRESHOLD || isSleepHours(world.minutesOfDay);

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
        agent.wallet >= SHOP_PRICE &&
        building.stock > 0 &&
        agent.lastShoppedTick !== world.tick
      ) {
        const transferredUnits = Math.min(SHOPPING_BASKET_UNITS, pantryGap, building.stock);
        if (transferredUnits <= 0) {
          break;
        }

        agent.state = AgentState.Shopping;
        agent.wallet -= SHOP_PRICE;
        building.stock -= transferredUnits;
        home.pantryStock += transferredUnits;
        world.economy.treasury += 2;
        agent.stats.happiness = clamp(agent.stats.happiness + 8, 0, MAX_STAT);
        agent.lastShoppedTick = world.tick;
        agent.thought = 'Pantry restocked.';
      }
      break;
    }
  }
};

const updateAgentStats = (agent: Agent) => {
  const sleeping = agent.state === AgentState.Sleeping;
  const working = agent.state === AgentState.Working;
  const shopping = agent.state === AgentState.Shopping;

  agent.stats.hunger = clamp(agent.stats.hunger + (sleeping ? 0.03 : 0.09), 0, MAX_STAT);
  agent.stats.energy = clamp(
    agent.stats.energy + (sleeping ? SLEEP_ENERGY_RECOVERY_PER_TICK : working ? -0.08 : -0.04),
    0,
    MAX_STAT,
  );
  agent.stats.happiness = clamp(
    100 - agent.stats.hunger * 0.45 - (MAX_STAT - agent.stats.energy) * 0.35 + (shopping ? 5 : 0),
    0,
    MAX_STAT,
  );
  agent.keptMaxHungerToday = agent.keptMaxHungerToday && agent.stats.hunger >= MAX_STAT;

  if (agent.wallet <= 0 && agent.stats.hunger >= SHOPPING_HUNGER_THRESHOLD) {
    agent.thought = 'Hungry, but broke.';
  }
};

const nearestBuilding = (
  buildingIndex: StepBuildingIndex,
  from: Point,
  kind: BuildingKind,
  predicate?: (building: Building) => boolean,
) => {
  let nearest: Building | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const building of getBuildingsByKind(buildingIndex, kind)) {
    if (predicate && !predicate(building)) {
      continue;
    }

    const distance = Math.abs(building.tile.x - from.x) + Math.abs(building.tile.y - from.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = building;
    }
  }

  return nearest;
};

const isOnBuildingTile = (agent: Agent, building?: Building) => {
  if (!building) {
    return false;
  }

  const tile = getAgentCurrentTile(agent);
  return tile.x === building.tile.x && tile.y === building.tile.y;
};

const determineDestination = (world: WorldState, buildingIndex: StepBuildingIndex, agent: Agent): AgentDestination | undefined => {
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

  if (agent.stats.energy <= SLEEP_ENERGY_THRESHOLD && home) {
    return { buildingId: home.id, kind: 'home' };
  }

  if (hasActiveShift(agent) && work) {
    return { buildingId: work.id, kind: 'work' };
  }

  const emergencyFoodRun = agent.stats.hunger >= SHOPPING_HUNGER_THRESHOLD && (home?.pantryStock ?? 0) <= 0;
  const pantryRunFromHome =
    !!home &&
    homeNeedsPantryRefill(home) &&
    (isOnBuildingTile(agent, home) || agent.destination?.kind === 'shop');
  if ((emergencyFoodRun || pantryRunFromHome) && agent.wallet >= SHOP_PRICE && shoppingCooldownElapsed) {
    const shop = nearestBuilding(buildingIndex, tile, BuildingKind.Commercial, (building) => building.stock > 0);
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
        agent.stats.hunger >= SHOPPING_HUNGER_THRESHOLD && agent.wallet < SHOP_PRICE ? 'Hungry, but broke.' : 'Going home.';
      break;
  }
};

const routeAgent = (
  world: WorldState,
  buildingIndex: StepBuildingIndex,
  agent: Agent,
  reservations: OccupancyReservations,
) => {
  activateShiftIfDue(world, agent);
  const home = getBuilding(buildingIndex, agent.homeId);
  const destination = determineDestination(world, buildingIndex, agent);
  if (!destination) {
    if (home && isOnBuildingTile(agent, home) && agent.state !== AgentState.Sleeping) {
      consumePantryMeal(agent, home);
    }
    agent.destination = undefined;
    agent.route = [];
    agent.routeIndex = 0;
    agent.state = AgentState.Idle;
    return;
  }

  if (agent.stats.hunger >= SHOPPING_HUNGER_THRESHOLD && (home?.pantryStock ?? 0) <= 0 && agent.wallet < SHOP_PRICE) {
    agent.thought = 'Hungry, but broke.';
  }

  const building = getBuilding(buildingIndex, destination.buildingId);
  if (!building) {
    return;
  }

  const currentTile = getAgentCurrentTile(agent);
  if (currentTile.x === building.tile.x && currentTile.y === building.tile.y) {
    agent.destination = destination;
    agent.route = [];
    agent.routeIndex = 0;
    arriveAtBuilding(agent, building, buildingIndex, world);
    return;
  }

  applyDestinationState(agent, destination);
  assignRoute(world, agent, destination, building.tile);
  moveAgent(world, agent, reservations);

  const arrivedTile = getAgentCurrentTile(agent);
  if (arrivedTile.x === building.tile.x && arrivedTile.y === building.tile.y) {
    arriveAtBuilding(agent, building, buildingIndex, world);
  }
};

const restockCommercialBuildings = (world: WorldState, buildingIndex: StepBuildingIndex) => {
  if (world.minutesOfDay % 60 !== 0) {
    return;
  }

  const industries = getBuildingsByKind(buildingIndex, BuildingKind.Industrial);
  const shops = getBuildingsByKind(buildingIndex, BuildingKind.Commercial);
  let industryIndex = 0;

  for (const shop of shops) {
    let needed = Math.max(0, shop.capacity - shop.stock);

    while (needed > 0 && industryIndex < industries.length) {
      const source = industries[industryIndex]!;
      if (source.stock <= 0) {
        industryIndex += 1;
        continue;
      }

      const transfer = Math.min(COMMERCIAL_RESTOCK_PER_HOUR, needed, source.stock);
      source.stock -= transfer;
      shop.stock += transfer;
      needed -= transfer;

      if (source.stock <= 0) {
        industryIndex += 1;
      }
    }
  }
};

const nextAgentId = (world: WorldState) => `agent-${world.entities.agents.length + world.day + 1}`;

const runPopulationTurnover = (world: WorldState, buildingIndex: StepBuildingIndex) => {
  if (world.minutesOfDay !== 0) {
    return;
  }

  for (const agent of world.entities.agents) {
    agent.daysInCity += 1;
    agent.maxHungerStreakDays =
      agent.keptMaxHungerToday && agent.stats.hunger >= MAX_STAT ? agent.maxHungerStreakDays + 1 : 0;
    agent.keptMaxHungerToday = agent.stats.hunger >= MAX_STAT;
  }

  world.entities.agents = world.entities.agents.filter((agent) => agent.maxHungerStreakDays < STARVATION_CULL_DAYS);
  if (world.selectedAgentId && !world.entities.agents.some((agent) => agent.id === world.selectedAgentId)) {
    world.selectedAgentId = undefined;
  }

  const homes = getBuildingsByKind(buildingIndex, BuildingKind.Residential);
  let capacity = 0;
  for (const home of homes) {
    capacity += home.capacity;
  }
  const freeSlots = capacity - world.entities.agents.length;

  if (freeSlots > 0 && world.day % 2 === 0) {
    const occupied = new Map<string, number>();
    for (const agent of world.entities.agents) {
      occupied.set(agent.homeId, (occupied.get(agent.homeId) ?? 0) + 1);
    }

    const home = homes.find((building) => (occupied.get(building.id) ?? 0) < building.capacity);
    let work: Building | undefined;
    for (const workplace of getBuildingsByKind(buildingIndex, BuildingKind.Industrial)) {
      if (!work || workplace.stock < work.stock) {
        work = workplace;
      }
    }

    if (home && work) {
      world.entities.agents.push({
        id: nextAgentId(world),
        name: `Newcomer ${world.day}`,
        pos: { x: home.tile.x + 0.5, y: home.tile.y + 0.5 },
        wallet: 18,
        stats: { hunger: 24, energy: 72, happiness: 64 },
        homeId: home.id,
        workId: work.id,
        state: AgentState.Idle,
        thought: 'Just moved in.',
        route: [],
        routeIndex: 0,
        routeComputeCount: 0,
        routeMapVersion: world.metrics.mapVersion,
        destination: undefined,
        lastShoppedTick: undefined,
        sleepUntilTick: undefined,
        shiftDay: 0,
        shiftWorkMinutes: 0,
        paidShiftWorkMinutes: 0,
        lastCompletedShiftDay: 0,
        daysInCity: 0,
        maxHungerStreakDays: 0,
        keptMaxHungerToday: false,
      });
    }
  }

  world.metrics.populationCapacity = capacity;
};

export const stepWorld = (inputWorld: WorldState): WorldState => {
  const world = cloneWorldForStep(inputWorld);
  const buildingIndex = createBuildingIndex(world);
  world.tick += 1;
  world.minutesOfDay += gameMinutesPerTick;

  if (world.minutesOfDay >= dayMinutes) {
    world.minutesOfDay = 0;
    world.day += 1;
  }

  computeTraffic(world);
  restockCommercialBuildings(world, buildingIndex);
  const reservations = createOccupancyReservations(world);
  for (const agent of world.entities.agents) {
    updateAgentStats(agent);
    routeAgent(world, buildingIndex, agent, reservations);
  }
  runPopulationTurnover(world, buildingIndex);
  updateEconomyTotals(world);

  return world;
};

export const advanceWorld = (world: WorldState, elapsedMs: number, carryMs = 0): SimulationAdvanceResult => {
  let currentWorld = world;
  let budget = carryMs + elapsedMs;
  let stepsApplied = 0;
  const epsilon = 1e-9;

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
