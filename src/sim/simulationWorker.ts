/// <reference lib="webworker" />

import { STARTER_WORLD_SEED, msPerTick } from './constants';
import { stepWorld } from './stepWorld';
import {
  DynamicAgentSnapshot,
  SimulationWorkerInboundMessage,
  SimulationWorkerOutboundMessage,
  WorldDynamicSnapshot,
} from './simulationWorkerTypes';
import { selectWorldAgent, paintWorldTile } from './worldMutations';
import { createStarterWorld } from './world';

let world = createStarterWorld();
let paused = false;
let tickTimer: number | null = null;

const toDynamicAgentSnapshot = (agent: typeof world.entities.agents[number]): DynamicAgentSnapshot => ({
  carriedMeals: agent.carriedMeals,
  daysInCity: agent.daysInCity,
  destination: agent.destination ? { ...agent.destination } : undefined,
  homeId: agent.homeId,
  id: agent.id,
  keptMaxHungerToday: agent.keptMaxHungerToday,
  lastCompletedShiftDay: agent.lastCompletedShiftDay,
  lastShoppedTick: agent.lastShoppedTick,
  maxHungerStreakDays: agent.maxHungerStreakDays,
  name: agent.name,
  paidShiftWorkMinutes: agent.paidShiftWorkMinutes,
  pos: { ...agent.pos },
  shiftDay: agent.shiftDay,
  shiftStartMinute: agent.shiftStartMinute,
  shiftWorkMinutes: agent.shiftWorkMinutes,
  sleepUntilTick: agent.sleepUntilTick,
  state: agent.state,
  stats: { ...agent.stats },
  thought: agent.thought,
  wallet: agent.wallet,
  workId: agent.workId,
  routeComputeCount: agent.routeComputeCount,
});

const publishFullSnapshot = () => {
  const message: SimulationWorkerOutboundMessage = {
    type: 'fullSnapshot',
    world,
  };

  self.postMessage(message);
};

const publishDynamicSnapshot = () => {
  const snapshot: WorldDynamicSnapshot = {
    day: world.day,
    economy: { ...world.economy },
    entities: {
      agents: world.entities.agents.map(toDynamicAgentSnapshot),
      buildings: world.entities.buildings.map((building) => ({
        ...building,
        tile: { ...building.tile },
      })),
    },
    metrics: { ...world.metrics },
    minutesOfDay: world.minutesOfDay,
    selectedAgentId: world.selectedAgentId,
    tick: world.tick,
    traffic: { ...world.traffic },
  };

  const message: SimulationWorkerOutboundMessage = {
    snapshot,
    type: 'dynamicSnapshot',
  };

  self.postMessage(message);
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
  world = stepWorld(world);
  publishDynamicSnapshot();
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
      world = stepWorld(world);
      publishDynamicSnapshot();
      if (!paused) {
        scheduleNextTick();
      }
      break;
    case 'selectAgent':
      world = selectWorldAgent(world, message.agentId);
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
