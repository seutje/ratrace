import { create } from 'zustand';
import { advanceWorld, stepWorld } from '../sim/stepWorld';
import { MAX_FRAME_ADVANCE_MS, STARTER_WORLD_SEED } from '../sim/constants';
import { BuildMode, OverlayMode, WorldState } from '../sim/types';
import {
  agentStateOrder,
  CompactAgentFrame,
  DynamicAgentSnapshot,
  SimulationWorkerInboundMessage,
  SimulationWorkerOutboundMessage,
  WorldDynamicSnapshot,
} from '../sim/simulationWorkerTypes';
import { paintWorldTile, selectWorldAgent } from '../sim/worldMutations';
import { createStarterWorld } from '../sim/world';
import { pointToTile } from '../sim/utils';

type WorldStore = {
  world: WorldState;
  paused: boolean;
  buildMode: BuildMode;
  overlayMode: OverlayMode;
  carryMs: number;
  selectedAgentSnapshot?: DynamicAgentSnapshot;
  bootstrap: (seed?: number) => void;
  reset: () => void;
  setPaused: (paused: boolean) => void;
  singleStep: () => void;
  advanceElapsed: (elapsedMs: number) => void;
  selectAgent: (agentId?: string) => void;
  setBuildMode: (mode: BuildMode) => void;
  setOverlayMode: (mode: OverlayMode) => void;
  paintTile: (x: number, y: number, type: BuildMode) => void;
};

let simulationWorker: Worker | null = null;
let previousRenderSnapshot: WorldDynamicSnapshot | null = null;
let currentRenderSnapshot: WorldDynamicSnapshot | null = null;
let currentRenderSnapshotReceivedAtMs = 0;

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const postSimulationWorkerMessage = (message: SimulationWorkerInboundMessage) => {
  simulationWorker?.postMessage(message);
};

const agentStateByCode = agentStateOrder;

const createCompactAgentFrame = (world: WorldState): CompactAgentFrame => {
  const agentCount = world.entities.agents.length;
  const posX = new Float32Array(agentCount);
  const posY = new Float32Array(agentCount);
  const hungerValues = new Float32Array(agentCount);
  const energyValues = new Float32Array(agentCount);
  const happinessValues = new Float32Array(agentCount);
  const stateCodes = new Uint8Array(agentCount);

  world.entities.agents.forEach((agent, index) => {
    posX[index] = agent.pos.x;
    posY[index] = agent.pos.y;
    hungerValues[index] = agent.stats.hunger;
    energyValues[index] = agent.stats.energy;
    happinessValues[index] = agent.stats.happiness;
    stateCodes[index] = Math.max(0, agentStateByCode.indexOf(agent.state));
  });

  return {
    energyValues,
    happinessValues,
    hungerValues,
    posX,
    posY,
    stateCodes,
  };
};

const toDynamicSnapshot = (world: WorldState): WorldDynamicSnapshot => ({
  day: world.day,
  economy: { ...world.economy },
  entities: {
    buildings: world.entities.buildings.map((building) => ({
      ...building,
      tile: { ...building.tile },
    })),
  },
  frame: createCompactAgentFrame(world),
  metrics: { ...world.metrics },
  minutesOfDay: world.minutesOfDay,
  selectedAgent: world.selectedAgentId
    ? (() => {
        const agent = world.entities.agents.find((entry) => entry.id === world.selectedAgentId);
        return agent
          ? {
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
              routeComputeCount: agent.routeComputeCount,
              shiftDay: agent.shiftDay,
              shiftStartMinute: agent.shiftStartMinute,
              shiftWorkMinutes: agent.shiftWorkMinutes,
              sleepUntilTick: agent.sleepUntilTick,
              state: agent.state,
              stats: { ...agent.stats },
              thought: agent.thought,
              wallet: agent.wallet,
              workId: agent.workId,
            }
          : undefined;
      })()
    : undefined,
  selectedAgentId: world.selectedAgentId,
  tick: world.tick,
  traffic: { ...world.traffic },
});

const setRenderSnapshots = (nextSnapshot: WorldDynamicSnapshot) => {
  previousRenderSnapshot = currentRenderSnapshot ?? nextSnapshot;
  currentRenderSnapshot = nextSnapshot;
  currentRenderSnapshotReceivedAtMs = nowMs();
};

const applyDynamicSnapshotToWorld = (world: WorldState, snapshot: WorldDynamicSnapshot): WorldState => {
  return {
    ...world,
    day: snapshot.day,
    economy: { ...snapshot.economy },
    entities: {
      agents: world.entities.agents,
      buildings: snapshot.entities.buildings.map((building) => ({
        ...building,
        tile: { ...building.tile },
      })),
    },
    metrics: { ...snapshot.metrics },
    minutesOfDay: snapshot.minutesOfDay,
    selectedAgentId: snapshot.selectedAgentId,
    tick: snapshot.tick,
    traffic: { ...snapshot.traffic },
  };
};

const applyWorkerSnapshot = (message: SimulationWorkerOutboundMessage) => {
  if (message.type === 'fullSnapshot') {
    const snapshot = toDynamicSnapshot(message.world);
    setRenderSnapshots(snapshot);
    useWorldStore.setState((state) => ({
      ...state,
      carryMs: 0,
      selectedAgentSnapshot: snapshot.selectedAgent,
      world: message.world,
    }));
    return;
  }

  setRenderSnapshots(message.snapshot);
  useWorldStore.setState((state) => ({
    ...state,
    carryMs: 0,
    selectedAgentSnapshot: message.snapshot.selectedAgent,
    world: applyDynamicSnapshotToWorld(state.world, message.snapshot),
  }));
};

export const startSimulationWorker = () => {
  if (typeof Worker === 'undefined' || simulationWorker) {
    return;
  }

  try {
    simulationWorker = new Worker(new URL('../sim/simulationWorker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    simulationWorker = null;
    return;
  }
  simulationWorker.onmessage = (event: MessageEvent<SimulationWorkerOutboundMessage>) => {
    applyWorkerSnapshot(event.data);
  };

  const state = useWorldStore.getState();
  postSimulationWorkerMessage({
    paused: state.paused,
    type: 'sync',
  });
};

export const stopSimulationWorker = () => {
  previousRenderSnapshot = null;
  currentRenderSnapshot = null;
  currentRenderSnapshotReceivedAtMs = 0;
  simulationWorker?.terminate();
  simulationWorker = null;
};

export const getRenderInterpolationState = () => ({
  current: currentRenderSnapshot,
  currentReceivedAtMs: currentRenderSnapshotReceivedAtMs,
  previous: previousRenderSnapshot,
});

export const useWorldStore = create<WorldStore>((set, get) => ({
  world: createStarterWorld(),
  paused: false,
  buildMode: 'select',
  overlayMode: 'none',
  carryMs: 0,
  selectedAgentSnapshot: undefined,
  bootstrap: (seed = STARTER_WORLD_SEED) => {
    if (simulationWorker) {
      set({
        paused: false,
        selectedAgentSnapshot: undefined,
      });
      postSimulationWorkerMessage({
        type: 'bootstrap',
        seed,
      });
      return;
    }

    set({
      world: createStarterWorld(seed),
      carryMs: 0,
      paused: false,
      selectedAgentSnapshot: undefined,
    });
    postSimulationWorkerMessage({
      type: 'bootstrap',
      seed,
    });
  },
  reset: () => {
    if (simulationWorker) {
      set({
        paused: false,
        selectedAgentSnapshot: undefined,
      });
      postSimulationWorkerMessage({
        type: 'reset',
      });
      return;
    }

    set({
      world: createStarterWorld(),
      paused: false,
      carryMs: 0,
      selectedAgentSnapshot: undefined,
    });
    postSimulationWorkerMessage({
      type: 'reset',
    });
  },
  setPaused: (paused) => {
    set({ paused });
    if (simulationWorker) {
      postSimulationWorkerMessage({
        paused,
        type: 'setPaused',
      });
    }
  },
  singleStep: () => {
    if (simulationWorker) {
      postSimulationWorkerMessage({
        type: 'step',
      });
      return;
    }

    set((state) => ({
      world: stepWorld(state.world),
    }));
  },
  advanceElapsed: (elapsedMs) => {
    if (get().paused) {
      return;
    }

    if (simulationWorker) {
      return;
    }

    set((state) => {
      if (state.paused) {
        return state;
      }

      const advanced = advanceWorld(state.world, elapsedMs, state.carryMs, {
        maxElapsedMs: MAX_FRAME_ADVANCE_MS,
      });
      return {
        world: advanced.world,
        carryMs: advanced.carryMs,
      };
    });
  },
  selectAgent: (agentId) => {
    if (simulationWorker) {
      postSimulationWorkerMessage({
        type: 'selectAgent',
        agentId,
      });
      return;
    }

    set((state) => ({
      selectedAgentSnapshot: agentId === state.selectedAgentSnapshot?.id ? state.selectedAgentSnapshot : undefined,
      world: selectWorldAgent(state.world, agentId),
    }));
  },
  setBuildMode: (mode) => set({ buildMode: mode }),
  setOverlayMode: (mode) => set({ overlayMode: mode }),
  paintTile: (x, y, mode) => {
    if (mode === 'select') {
      return;
    }

    if (simulationWorker) {
      postSimulationWorkerMessage({
        type: 'paintTile',
        x,
        y,
        mode,
      });
      return;
    }

    set((state) => {
      return {
        world: paintWorldTile(state.world, x, y, mode),
      };
    });
  },
}));

export const selectSelectedAgent = (world: WorldState) =>
  world.entities.agents.find((agent) => agent.id === world.selectedAgentId);

export const findAgentAtCanvasPoint = (
  world: WorldState,
  point: { x: number; y: number },
  tileSize: number,
  offset: { x: number; y: number },
  frame?: CompactAgentFrame,
) => {
  const worldPoint = {
    x: (point.x - offset.x) / tileSize,
    y: (point.y - offset.y) / tileSize,
  };

  return world.entities.agents.find((agent, index) => {
    const x = frame && index < frame.posX.length ? frame.posX[index]! : agent.pos.x;
    const y = frame && index < frame.posY.length ? frame.posY[index]! : agent.pos.y;
    const dx = x - worldPoint.x;
    const dy = y - worldPoint.y;
    return dx * dx + dy * dy <= 0.45 * 0.45;
  });
};

export const tileFromCanvasPoint = (point: { x: number; y: number }, tileSize: number, offset: { x: number; y: number }) =>
  pointToTile({
    x: (point.x - offset.x) / tileSize,
    y: (point.y - offset.y) / tileSize,
  });
