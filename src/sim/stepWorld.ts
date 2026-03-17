import {
  BASE_MOVE_SPEED,
  COMMERCIAL_RESTOCK_PER_HOUR,
  HOURLY_WAGE,
  INDUSTRIAL_OUTPUT_PER_HOUR,
  MAX_STAT,
  ROAD_SPEED_MULTIPLIER,
  SHOPPING_COOLDOWN_TICKS,
  SHOPPING_HUNGER_RECOVERY,
  SHOPPING_HUNGER_THRESHOLD,
  SHOP_PRICE,
  SLEEP_END_MINUTE,
  SLEEP_ENERGY_RECOVERY_PER_TICK,
  SLEEP_MINIMUM_MINUTES,
  SLEEP_TARGET_ENERGY,
  SLEEP_ENERGY_THRESHOLD,
  SLEEP_START_MINUTE,
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
  toClockNumber,
} from './utils';
import { getAgentCurrentTile, getAgentTrafficKey, getRouteTargetPoint, getLaneDirection } from './lanes';

const isPastWorkStart = (minutes: number) => minutes >= WORK_START_MINUTE;
const isSleepHours = (minutes: number) => minutes >= SLEEP_START_MINUTE || minutes < SLEEP_END_MINUTE;
const hasActiveShift = (agent: Agent) => agent.shiftDay > 0 && agent.shiftWorkMinutes < WORK_SHIFT_MINUTES;
const isCommittedToSleep = (agent: Agent, world: WorldState) =>
  agent.sleepUntilTick !== undefined && world.tick < agent.sleepUntilTick;
const getRequiredSleepTicks = (agent: Agent) => {
  const minimumSleepTicks = Math.ceil(SLEEP_MINIMUM_MINUTES / gameMinutesPerTick);
  const missingEnergy = Math.max(0, SLEEP_TARGET_ENERGY - agent.stats.energy);
  const energyRecoveryTicks = Math.ceil(missingEnergy / SLEEP_ENERGY_RECOVERY_PER_TICK);
  return Math.max(minimumSleepTicks, energyRecoveryTicks);
};

const getBuilding = (world: WorldState, buildingId: string) =>
  world.entities.buildings.find((building) => building.id === buildingId);

const getBuildingsByKind = (world: WorldState, kind: BuildingKind) =>
  world.entities.buildings.filter((building) => building.kind === kind);

const computeTraffic = (world: WorldState) => {
  const traffic: Record<string, number> = {};

  world.entities.agents.forEach((agent) => {
    const currentTile = getAgentCurrentTile(agent);
    const currentTileType = getTile(world, currentTile)?.type ?? TileType.Empty;
    const key = getAgentTrafficKey(world, agent, currentTile, currentTileType);
    traffic[key] = (traffic[key] ?? 0) + 1;
  });

  world.traffic = traffic;
  world.metrics.trafficPeak = Math.max(0, ...Object.values(traffic));
};

const updateEconomyTotals = (world: WorldState) => {
  const walletTotal = world.entities.agents.reduce((sum, agent) => sum + agent.wallet, 0);
  const stockTotal = world.entities.buildings.reduce((sum, building) => sum + building.stock, 0);
  world.economy.supplyStock = stockTotal;
  world.economy.totalWealth = world.economy.treasury + walletTotal + stockTotal * 2;
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

const moveAgent = (world: WorldState, agent: Agent) => {
  if (!agent.destination || agent.routeIndex >= agent.route.length) {
    return;
  }

  const currentTile = getAgentCurrentTile(agent);
  const currentTileType = getTile(world, currentTile)?.type ?? TileType.Empty;
  const occupancy = world.traffic[getAgentTrafficKey(world, agent, currentTile, currentTileType)] ?? 0;
  const congestionFactor = currentTileType === TileType.Road ? getCongestionSpeedFactor(occupancy) : 1;
  const roadMultiplier = currentTileType === TileType.Road ? ROAD_SPEED_MULTIPLIER : 1;
  const stepDistance = BASE_MOVE_SPEED * roadMultiplier * congestionFactor;

  const target = getRouteTargetPoint(world, agent, currentTile);
  const remainingDistance = distance(agent.pos, target);

  if (remainingDistance <= stepDistance) {
    agent.pos = target;
    agent.routeIndex += 1;
    return;
  }

  const targetTile = agent.route[agent.routeIndex];
  const targetTileType = targetTile ? getTile(world, targetTile)?.type ?? TileType.Empty : TileType.Empty;
  const direction = targetTile ? getLaneDirection(currentTile, targetTile) : undefined;

  if (currentTileType === TileType.Road && targetTileType === TileType.Road && direction) {
    if (direction === 'east' || direction === 'west') {
      const yMove = moveAxisToward(agent.pos.y, target.y, stepDistance);
      const xMove = moveAxisToward(agent.pos.x, target.x, stepDistance - yMove.used);
      agent.pos = { x: xMove.value, y: yMove.value };
      return;
    }

    const xMove = moveAxisToward(agent.pos.x, target.x, stepDistance);
    const yMove = moveAxisToward(agent.pos.y, target.y, stepDistance - xMove.used);
    agent.pos = { x: xMove.value, y: yMove.value };
    return;
  }

  const ratio = stepDistance / remainingDistance;
  agent.pos = {
    x: agent.pos.x + (target.x - agent.pos.x) * ratio,
    y: agent.pos.y + (target.y - agent.pos.y) * ratio,
  };
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

const arriveAtBuilding = (agent: Agent, building: Building, world: WorldState) => {
  switch (building.kind) {
    case BuildingKind.Residential: {
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
    case BuildingKind.Commercial:
      if (
        agent.stats.hunger >= SHOPPING_HUNGER_THRESHOLD &&
        agent.wallet >= SHOP_PRICE &&
        building.stock > 0 &&
        agent.lastShoppedTick !== world.tick
      ) {
        agent.state = AgentState.Shopping;
        agent.wallet -= SHOP_PRICE;
        building.stock -= 1;
        world.economy.treasury += 2;
        agent.stats.hunger = clamp(agent.stats.hunger - SHOPPING_HUNGER_RECOVERY, 0, MAX_STAT);
        agent.stats.happiness = clamp(agent.stats.happiness + 8, 0, MAX_STAT);
        agent.lastShoppedTick = world.tick;
        agent.thought = 'Groceries secured.';
      }
      break;
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

  if (agent.wallet <= 0 && agent.stats.hunger >= SHOPPING_HUNGER_THRESHOLD) {
    agent.thought = 'Hungry, but broke.';
  }
};

const nearestBuilding = (world: WorldState, from: Point, kind: BuildingKind, predicate?: (building: Building) => boolean) => {
  const candidates = getBuildingsByKind(world, kind).filter((building) => (predicate ? predicate(building) : true));
  return candidates
    .slice()
    .sort(
      (left, right) =>
        Math.abs(left.tile.x - from.x) +
          Math.abs(left.tile.y - from.y) -
          (Math.abs(right.tile.x - from.x) + Math.abs(right.tile.y - from.y)),
    )[0];
};

const isOnBuildingTile = (agent: Agent, building?: Building) => {
  if (!building) {
    return false;
  }

  const tile = getAgentCurrentTile(agent);
  return tile.x === building.tile.x && tile.y === building.tile.y;
};

const determineDestination = (world: WorldState, agent: Agent): AgentDestination | undefined => {
  const home = getBuilding(world, agent.homeId);
  const work = getBuilding(world, agent.workId);
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

  if (agent.stats.hunger >= SHOPPING_HUNGER_THRESHOLD && agent.wallet >= SHOP_PRICE && shoppingCooldownElapsed) {
    const shop = nearestBuilding(world, tile, BuildingKind.Commercial, (building) => building.stock > 0);
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

const routeAgent = (world: WorldState, agent: Agent) => {
  activateShiftIfDue(world, agent);
  const destination = determineDestination(world, agent);
  if (!destination) {
    agent.destination = undefined;
    agent.route = [];
    agent.routeIndex = 0;
    agent.state = AgentState.Idle;
    return;
  }

  if (agent.stats.hunger >= SHOPPING_HUNGER_THRESHOLD && agent.wallet < SHOP_PRICE) {
    agent.thought = 'Hungry, but broke.';
  }

  const building = getBuilding(world, destination.buildingId);
  if (!building) {
    return;
  }

  const currentTile = getAgentCurrentTile(agent);
  if (currentTile.x === building.tile.x && currentTile.y === building.tile.y) {
    agent.destination = destination;
    agent.route = [];
    agent.routeIndex = 0;
    arriveAtBuilding(agent, building, world);
    return;
  }

  applyDestinationState(agent, destination);
  assignRoute(world, agent, destination, building.tile);
  moveAgent(world, agent);

  const arrivedTile = getAgentCurrentTile(agent);
  if (arrivedTile.x === building.tile.x && arrivedTile.y === building.tile.y) {
    arriveAtBuilding(agent, building, world);
  }
};

const restockCommercialBuildings = (world: WorldState) => {
  if (world.minutesOfDay % 60 !== 0) {
    return;
  }

  const industries = getBuildingsByKind(world, BuildingKind.Industrial);
  const shops = getBuildingsByKind(world, BuildingKind.Commercial);
  for (const shop of shops) {
    let needed = Math.max(0, shop.capacity - shop.stock);
    while (needed > 0) {
      const source = industries.find((building) => building.stock > 0);
      if (!source) {
        break;
      }
      const transfer = Math.min(COMMERCIAL_RESTOCK_PER_HOUR, needed, source.stock);
      source.stock -= transfer;
      shop.stock += transfer;
      needed -= transfer;
    }
  }
};

const nextAgentId = (world: WorldState) => `agent-${world.entities.agents.length + world.day + 1}`;

const runPopulationTurnover = (world: WorldState) => {
  if (world.minutesOfDay !== 0) {
    return;
  }

  world.entities.agents.forEach((agent) => {
    agent.daysInCity += 1;
  });

  world.entities.agents = world.entities.agents.filter(
    (agent) =>
      !(
        agent.daysInCity > 4 &&
        (agent.stats.happiness < 18 || agent.stats.hunger > 95 || agent.stats.energy < 8)
      ),
  );
  if (world.selectedAgentId && !world.entities.agents.some((agent) => agent.id === world.selectedAgentId)) {
    world.selectedAgentId = undefined;
  }

  const homes = getBuildingsByKind(world, BuildingKind.Residential);
  const capacity = homes.reduce((sum, home) => sum + home.capacity, 0);
  const freeSlots = capacity - world.entities.agents.length;

  if (freeSlots > 0 && world.day % 2 === 0) {
    const occupied = new Map<string, number>();
    world.entities.agents.forEach((agent) => {
      occupied.set(agent.homeId, (occupied.get(agent.homeId) ?? 0) + 1);
    });

    const home = homes.find((building) => (occupied.get(building.id) ?? 0) < building.capacity);
    const work = getBuildingsByKind(world, BuildingKind.Industrial).sort((left, right) => left.stock - right.stock)[0];
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
      });
    }
  }

  world.metrics.populationCapacity = capacity;
};

export const stepWorld = (inputWorld: WorldState): WorldState => {
  const world = structuredClone(inputWorld) as WorldState;
  world.tick += 1;
  world.minutesOfDay += gameMinutesPerTick;

  if (world.minutesOfDay >= dayMinutes) {
    world.minutesOfDay = 0;
    world.day += 1;
  }

  computeTraffic(world);
  restockCommercialBuildings(world);
  world.entities.agents.forEach((agent) => {
    updateAgentStats(agent);
    routeAgent(world, agent);
  });
  runPopulationTurnover(world);
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
