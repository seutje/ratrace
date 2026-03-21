/// <reference lib="webworker" />

import { STARTER_WORLD_SEED, msPerTick, workerSnapshotIntervalTicks } from './constants';
import { stepWorldInPlace } from './stepWorld';
import {
  DynamicBuildingSnapshot,
  agentStateOrder,
  CompactAgentFrame,
  SimulationWorkerInboundMessage,
  SimulationWorkerOutboundMessage,
  WorldDynamicSnapshot,
  toDynamicAgentSnapshot,
} from './simulationWorkerTypes';
import { paintWorldTile, selectWorldAgent, selectWorldTile } from './worldMutations';
import { createStarterWorld } from './world';

let world = createStarterWorld();
let paused = false;
let tickTimer: number | null = null;
let lastPublishedAgentCount = world.entities.agents.length;
let lastPublishedAgentIds = world.entities.agents.map((agent) => agent.id);
let lastPublishedBuildingSnapshot: DynamicBuildingSnapshot[] | null = null;
let lastPublishedTrafficSnapshot: Record<string, number> | null = null;

const agentStateCodeByValue = new Map(agentStateOrder.map((state, index) => [state, index]));

const cloneBuildingSnapshot = (buildings: typeof world.entities.buildings): DynamicBuildingSnapshot[] =>
  buildings.map((building) => ({
    ...building,
    tile: { ...building.tile },
  }));

const haveBuildingsChangedSinceLastPublish = () => {
  if (!lastPublishedBuildingSnapshot || lastPublishedBuildingSnapshot.length !== world.entities.buildings.length) {
    return true;
  }

  return world.entities.buildings.some((building, index) => {
    const published = lastPublishedBuildingSnapshot?.[index];
    return !published ||
      building.id !== published.id ||
      building.kind !== published.kind ||
      building.cash !== published.cash ||
      building.stock !== published.stock ||
      building.capacity !== published.capacity ||
      building.pantryStock !== published.pantryStock ||
      building.pantryCapacity !== published.pantryCapacity ||
      building.label !== published.label ||
      building.tile.x !== published.tile.x ||
      building.tile.y !== published.tile.y;
  });
};

const createChangedBuildingSnapshot = () => {
  if (!haveBuildingsChangedSinceLastPublish()) {
    return undefined;
  }

  const snapshot = cloneBuildingSnapshot(world.entities.buildings);
  lastPublishedBuildingSnapshot = snapshot;
  return snapshot;
};

const cloneTrafficSnapshot = () => ({ ...world.traffic });

const haveTrafficChangedSinceLastPublish = () => {
  if (!lastPublishedTrafficSnapshot) {
    return true;
  }

  const currentKeys = Object.keys(world.traffic);
  const publishedKeys = Object.keys(lastPublishedTrafficSnapshot);
  if (currentKeys.length !== publishedKeys.length) {
    return true;
  }

  for (const key of currentKeys) {
    if (world.traffic[key] !== lastPublishedTrafficSnapshot[key]) {
      return true;
    }
  }

  return false;
};

const createChangedTrafficSnapshot = () => {
  if (!haveTrafficChangedSinceLastPublish()) {
    return undefined;
  }

  const snapshot = cloneTrafficSnapshot();
  lastPublishedTrafficSnapshot = snapshot;
  return snapshot;
};

const createCompactAgentFrame = (): CompactAgentFrame => {
  const agentCount = world.entities.agents.length;
  const posX = new Float32Array(agentCount);
  const posY = new Float32Array(agentCount);
  const hungerValues = new Float32Array(agentCount);
  const energyValues = new Float32Array(agentCount);
  const happinessValues = new Float32Array(agentCount);
  const stateCodes = new Uint8Array(agentCount);
  const walletValues = new Float32Array(agentCount);

  world.entities.agents.forEach((agent, index) => {
    posX[index] = agent.pos.x;
    posY[index] = agent.pos.y;
    hungerValues[index] = agent.stats.hunger;
    energyValues[index] = agent.stats.energy;
    happinessValues[index] = agent.stats.happiness;
    stateCodes[index] = agentStateCodeByValue.get(agent.state) ?? 0;
    walletValues[index] = agent.wallet;
  });

  return {
    energyValues,
    happinessValues,
    hungerValues,
    posX,
    posY,
    stateCodes,
    walletValues,
  };
};

const hasAgentRosterChangedSinceLastPublish = () =>
  world.entities.agents.length !== lastPublishedAgentIds.length ||
  world.entities.agents.some((agent, index) => agent.id !== lastPublishedAgentIds[index]);

const publishFullSnapshot = () => {
  lastPublishedAgentCount = world.entities.agents.length;
  lastPublishedAgentIds = world.entities.agents.map((agent) => agent.id);
  lastPublishedBuildingSnapshot = cloneBuildingSnapshot(world.entities.buildings);
  lastPublishedTrafficSnapshot = cloneTrafficSnapshot();
  const message: SimulationWorkerOutboundMessage = {
    type: 'fullSnapshot',
    world,
  };

  self.postMessage(message);
};

const publishDynamicSnapshot = () => {
  if (world.entities.agents.length !== lastPublishedAgentCount || hasAgentRosterChangedSinceLastPublish()) {
    publishFullSnapshot();
    return;
  }

  const frame = createCompactAgentFrame();
  const buildings = createChangedBuildingSnapshot();
  const traffic = createChangedTrafficSnapshot();
  const selectedAgent =
    world.selectedAgentId !== undefined
      ? world.entities.agents.find((agent) => agent.id === world.selectedAgentId)
      : undefined;
  const snapshot: WorldDynamicSnapshot = {
    day: world.day,
    economy: { ...world.economy },
    entities: {
      buildings,
    },
    frame,
    metrics: { ...world.metrics },
    minutesOfDay: world.minutesOfDay,
    obituaryCount: world.obituary.length,
    selectedAgent: selectedAgent ? toDynamicAgentSnapshot(selectedAgent) : undefined,
    selectedAgentId: world.selectedAgentId,
    selectedTile: world.selectedTile ? { ...world.selectedTile } : undefined,
    tick: world.tick,
    traffic,
  };

  const message: SimulationWorkerOutboundMessage = {
    snapshot,
    type: 'dynamicSnapshot',
  };

  self.postMessage(message, [
    frame.posX.buffer,
    frame.posY.buffer,
    frame.hungerValues.buffer,
    frame.energyValues.buffer,
    frame.happinessValues.buffer,
    frame.stateCodes.buffer,
    frame.walletValues.buffer,
  ]);
};

const publishTickSnapshot = () => {
  if (world.tick % workerSnapshotIntervalTicks !== 0) {
    return;
  }

  publishDynamicSnapshot();
};

const stopTickLoop = () => {
  if (tickTimer !== null) {
    self.clearTimeout(tickTimer);
    tickTimer = null;
  }
};

const scheduleNextTick = (delayMs = msPerTick) => {
  if (paused || tickTimer !== null) {
    return;
  }

  tickTimer = self.setTimeout(runTick, delayMs);
};

function runTick() {
  tickTimer = null;
  if (paused) {
    return;
  }

  const tickStartedAt = self.performance.now();
  world = stepWorldInPlace(world);
  publishTickSnapshot();
  const tickDuration = self.performance.now() - tickStartedAt;
  scheduleNextTick(Math.max(0, msPerTick - tickDuration));
}

const setPausedState = (nextPaused: boolean) => {
  paused = nextPaused;
  if (paused) {
    stopTickLoop();
    return;
  }

  scheduleNextTick();
};

self.onmessage = (event: MessageEvent<SimulationWorkerInboundMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'sync':
      setPausedState(message.paused);
      publishFullSnapshot();
      break;
    case 'setPaused':
      setPausedState(message.paused);
      break;
    case 'bootstrap':
      stopTickLoop();
      world = createStarterWorld(message.seed);
      paused = false;
      publishFullSnapshot();
      scheduleNextTick();
      break;
    case 'reset':
      stopTickLoop();
      world = createStarterWorld(STARTER_WORLD_SEED);
      paused = false;
      publishFullSnapshot();
      scheduleNextTick();
      break;
    case 'step':
      stopTickLoop();
      world = stepWorldInPlace(world);
      publishDynamicSnapshot();
      if (!paused) {
        scheduleNextTick();
      }
      break;
    case 'selectAgent':
      world = selectWorldAgent(world, message.agentId);
      publishDynamicSnapshot();
      break;
    case 'selectTile':
      world = selectWorldTile(world, message.tile);
      publishDynamicSnapshot();
      break;
    case 'paintTile':
      stopTickLoop();
      world = paintWorldTile(world, message.x, message.y, message.mode);
      publishFullSnapshot();
      if (!paused) {
        scheduleNextTick();
      }
      break;
  }
};

export {};
