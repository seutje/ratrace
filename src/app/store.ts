import { create } from 'zustand';
import { advanceWorld, stepWorld } from '../sim/stepWorld';
import { MAX_FRAME_ADVANCE_MS, STARTER_WORLD_SEED, msPerTick } from '../sim/constants';
import { BuildMode, OverlayMode, Point, WorldState } from '../sim/types';
import {
  sampleDynamicStatistics,
  sampleWorldStatistics,
  type SimulationStatisticsPoint,
  updateStatisticsHistory,
} from './statistics';
import {
  agentStateOrder,
  CompactAgentFrame,
  DynamicAgentSnapshot,
  SimulationWorkerInboundMessage,
  SimulationWorkerOutboundMessage,
  WorldDynamicSnapshot,
  toDynamicAgentSnapshot,
} from '../sim/simulationWorkerTypes';
import { paintWorldTile, selectWorldAgent, selectWorldTile } from '../sim/worldMutations';
import { createStarterWorld } from '../sim/world';
import { pointToTile } from '../sim/utils';

type WorldStore = {
  world: WorldState;
  statisticsHistory: SimulationStatisticsPoint[];
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
  selectTile: (tile?: Point) => void;
  setBuildMode: (mode: BuildMode) => void;
  setOverlayMode: (mode: OverlayMode) => void;
  paintTile: (x: number, y: number, type: BuildMode) => void;
};

type RenderSnapshotState = {
  current: WorldDynamicSnapshot | null;
  currentReceivedAtMs: number;
  estimatedIntervalMs: number;
  previous: WorldDynamicSnapshot | null;
  previousReceivedAtMs: number;
};

let simulationWorker: Worker | null = null;
let previousRenderSnapshot: WorldDynamicSnapshot | null = null;
let currentRenderSnapshot: WorldDynamicSnapshot | null = null;
let previousRenderSnapshotReceivedAtMs = 0;
let currentRenderSnapshotReceivedAtMs = 0;
let estimatedRenderSnapshotIntervalMs = 0;
const initialWorld = createStarterWorld();
const initialStatisticsHistory = updateStatisticsHistory([], sampleWorldStatistics(initialWorld));

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
  const walletValues = new Float32Array(agentCount);

  world.entities.agents.forEach((agent, index) => {
    posX[index] = agent.pos.x;
    posY[index] = agent.pos.y;
    hungerValues[index] = agent.stats.hunger;
    energyValues[index] = agent.stats.energy;
    happinessValues[index] = agent.stats.happiness;
    stateCodes[index] = Math.max(0, agentStateByCode.indexOf(agent.state));
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
  obituary: world.obituary.map((entry) => ({ ...entry })),
  selectedAgent: world.selectedAgentId
    ? (() => {
        const agent = world.entities.agents.find((entry) => entry.id === world.selectedAgentId);
        return agent ? toDynamicAgentSnapshot(agent) : undefined;
      })()
    : undefined,
  selectedAgentId: world.selectedAgentId,
  selectedTile: world.selectedTile ? { ...world.selectedTile } : undefined,
  tick: world.tick,
  traffic: { ...world.traffic },
});

export const advanceRenderSnapshotState = (
  state: RenderSnapshotState,
  nextSnapshot: WorldDynamicSnapshot,
  options: {
    receivedAtMs?: number;
    resetInterpolation?: boolean;
  } = {},
): RenderSnapshotState => {
  const receivedAtMs = options.receivedAtMs ?? nowMs();
  const resetInterpolation = options.resetInterpolation ?? false;
  const previous = resetInterpolation ? nextSnapshot : state.current ?? nextSnapshot;
  const previousReceivedAtMs = resetInterpolation ? receivedAtMs : state.currentReceivedAtMs;
  const current = nextSnapshot;
  const currentReceivedAtMs = receivedAtMs;

  const snapshotTickDelta = Math.max(1, current.tick - previous.tick);
  const tickIntervalMs = snapshotTickDelta * msPerTick;
  const arrivalIntervalMs =
    previousReceivedAtMs > 0
      ? currentReceivedAtMs - previousReceivedAtMs
      : tickIntervalMs;
  const nextEstimateMs = Math.max(tickIntervalMs, arrivalIntervalMs);

  return {
    current,
    currentReceivedAtMs,
    estimatedIntervalMs:
      state.estimatedIntervalMs > 0 ? state.estimatedIntervalMs * 0.7 + nextEstimateMs * 0.3 : nextEstimateMs,
    previous,
    previousReceivedAtMs,
  };
};

const setRenderSnapshots = (nextSnapshot: WorldDynamicSnapshot, options?: { resetInterpolation?: boolean }) => {
  const nextState = advanceRenderSnapshotState(
    {
      current: currentRenderSnapshot,
      currentReceivedAtMs: currentRenderSnapshotReceivedAtMs,
      estimatedIntervalMs: estimatedRenderSnapshotIntervalMs,
      previous: previousRenderSnapshot,
      previousReceivedAtMs: previousRenderSnapshotReceivedAtMs,
    },
    nextSnapshot,
    options,
  );

  currentRenderSnapshot = nextState.current;
  currentRenderSnapshotReceivedAtMs = nextState.currentReceivedAtMs;
  estimatedRenderSnapshotIntervalMs = nextState.estimatedIntervalMs;
  previousRenderSnapshot = nextState.previous;
  previousRenderSnapshotReceivedAtMs = nextState.previousReceivedAtMs;
};

const applyDynamicSnapshotToWorld = (world: WorldState, snapshot: WorldDynamicSnapshot): WorldState => {
  return {
    ...world,
    day: snapshot.day,
    economy: { ...snapshot.economy },
    entities: {
      agents: world.entities.agents.map((agent, index) => ({
        ...agent,
        pos: {
          x: index < snapshot.frame.posX.length ? snapshot.frame.posX[index]! : agent.pos.x,
          y: index < snapshot.frame.posY.length ? snapshot.frame.posY[index]! : agent.pos.y,
        },
        state: agentStateByCode[snapshot.frame.stateCodes[index]!] ?? agent.state,
        stats: {
          energy: index < snapshot.frame.energyValues.length ? snapshot.frame.energyValues[index]! : agent.stats.energy,
          happiness:
            index < snapshot.frame.happinessValues.length
              ? snapshot.frame.happinessValues[index]!
              : agent.stats.happiness,
          hunger: index < snapshot.frame.hungerValues.length ? snapshot.frame.hungerValues[index]! : agent.stats.hunger,
        },
        wallet: index < snapshot.frame.walletValues.length ? snapshot.frame.walletValues[index]! : agent.wallet,
      })),
      buildings: snapshot.entities.buildings.map((building) => ({
        ...building,
        tile: { ...building.tile },
      })),
    },
    metrics: { ...snapshot.metrics },
    minutesOfDay: snapshot.minutesOfDay,
    obituary: snapshot.obituary.map((entry) => ({ ...entry })),
    selectedAgentId: snapshot.selectedAgentId,
    selectedTile: snapshot.selectedTile ? { ...snapshot.selectedTile } : undefined,
    tick: snapshot.tick,
    traffic: { ...snapshot.traffic },
  };
};

const applyWorkerSnapshot = (message: SimulationWorkerOutboundMessage) => {
  if (message.type === 'fullSnapshot') {
    const snapshot = toDynamicSnapshot(message.world);
    setRenderSnapshots(snapshot, { resetInterpolation: true });
    useWorldStore.setState((state) => ({
      ...state,
      carryMs: 0,
      selectedAgentSnapshot: snapshot.selectedAgent,
      statisticsHistory: updateStatisticsHistory(state.statisticsHistory, sampleWorldStatistics(message.world)),
      world: message.world,
    }));
    return;
  }

  setRenderSnapshots(message.snapshot);
  useWorldStore.setState((state) => ({
    ...state,
    carryMs: 0,
    selectedAgentSnapshot: message.snapshot.selectedAgent,
    statisticsHistory: updateStatisticsHistory(state.statisticsHistory, sampleDynamicStatistics(message.snapshot)),
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
  previousRenderSnapshotReceivedAtMs = 0;
  currentRenderSnapshotReceivedAtMs = 0;
  estimatedRenderSnapshotIntervalMs = 0;
  simulationWorker?.terminate();
  simulationWorker = null;
};

export const getRenderInterpolationState = () => ({
  current: currentRenderSnapshot,
  currentReceivedAtMs: currentRenderSnapshotReceivedAtMs,
  estimatedIntervalMs: estimatedRenderSnapshotIntervalMs,
  previous: previousRenderSnapshot,
  previousReceivedAtMs: previousRenderSnapshotReceivedAtMs,
});

export const useWorldStore = create<WorldStore>((set, get) => ({
  world: initialWorld,
  statisticsHistory: initialStatisticsHistory,
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

    const nextWorld = createStarterWorld(seed);
    set({
      world: nextWorld,
      statisticsHistory: updateStatisticsHistory([], sampleWorldStatistics(nextWorld)),
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

    const nextWorld = createStarterWorld();
    set({
      world: nextWorld,
      statisticsHistory: updateStatisticsHistory([], sampleWorldStatistics(nextWorld)),
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

    set((state) => {
      const world = stepWorld(state.world);
      return {
        statisticsHistory: updateStatisticsHistory(state.statisticsHistory, sampleWorldStatistics(world)),
        world,
      };
    });
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
        statisticsHistory: updateStatisticsHistory(state.statisticsHistory, sampleWorldStatistics(advanced.world)),
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

    set((state) => {
      const world = selectWorldAgent(state.world, agentId);
      return {
        selectedAgentSnapshot: agentId === state.selectedAgentSnapshot?.id ? state.selectedAgentSnapshot : undefined,
        statisticsHistory: updateStatisticsHistory(state.statisticsHistory, sampleWorldStatistics(world)),
        world,
      };
    });
  },
  selectTile: (tile) => {
    if (simulationWorker) {
      postSimulationWorkerMessage({
        type: 'selectTile',
        tile,
      });
      return;
    }

    set((state) => {
      const world = selectWorldTile(state.world, tile);
      return {
        selectedAgentSnapshot: undefined,
        statisticsHistory: updateStatisticsHistory(state.statisticsHistory, sampleWorldStatistics(world)),
        world,
      };
    });
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
      const world = paintWorldTile(state.world, x, y, mode);
      return {
        statisticsHistory: updateStatisticsHistory(state.statisticsHistory, sampleWorldStatistics(world)),
        world,
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
