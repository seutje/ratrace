import { create } from 'zustand';
import { advanceWorld, stepWorld } from '../sim/stepWorld';
import { MAX_FRAME_ADVANCE_MS, STARTER_WORLD_SEED } from '../sim/constants';
import { BuildMode, OverlayMode, WorldState } from '../sim/types';
import {
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

const toDynamicSnapshot = (world: WorldState): WorldDynamicSnapshot => ({
  day: world.day,
  economy: { ...world.economy },
  entities: {
    agents: world.entities.agents.map((agent) => ({
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
    })),
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
});

const setRenderSnapshots = (nextSnapshot: WorldDynamicSnapshot) => {
  previousRenderSnapshot = currentRenderSnapshot ?? nextSnapshot;
  currentRenderSnapshot = nextSnapshot;
  currentRenderSnapshotReceivedAtMs = nowMs();
};

const hydrateAgent = (
  snapshot: DynamicAgentSnapshot,
  previousAgent?: WorldState['entities']['agents'][number],
): WorldState['entities']['agents'][number] => ({
  carriedMeals: snapshot.carriedMeals,
  daysInCity: snapshot.daysInCity,
  destination: snapshot.destination ? { ...snapshot.destination } : undefined,
  homeId: snapshot.homeId,
  id: snapshot.id,
  keptMaxHungerToday: snapshot.keptMaxHungerToday,
  lastCompletedShiftDay: snapshot.lastCompletedShiftDay,
  lastShoppedTick: snapshot.lastShoppedTick,
  maxHungerStreakDays: snapshot.maxHungerStreakDays,
  name: snapshot.name,
  paidShiftWorkMinutes: snapshot.paidShiftWorkMinutes,
  pos: { ...snapshot.pos },
  route: previousAgent?.route ?? [],
  routeComputeCount: snapshot.routeComputeCount,
  routeIndex: previousAgent?.routeIndex ?? 0,
  routeMapVersion: previousAgent?.routeMapVersion ?? 0,
  shiftDay: snapshot.shiftDay,
  shiftStartMinute: snapshot.shiftStartMinute,
  shiftWorkMinutes: snapshot.shiftWorkMinutes,
  sleepUntilTick: snapshot.sleepUntilTick,
  state: snapshot.state,
  stats: { ...snapshot.stats },
  thought: snapshot.thought,
  wallet: snapshot.wallet,
  workId: snapshot.workId,
});

const applyDynamicSnapshotToWorld = (world: WorldState, snapshot: WorldDynamicSnapshot): WorldState => {
  const previousAgentsById = new Map(world.entities.agents.map((agent) => [agent.id, agent]));

  return {
    ...world,
    day: snapshot.day,
    economy: { ...snapshot.economy },
    entities: {
      agents: snapshot.entities.agents.map((agent) =>
        hydrateAgent(agent, previousAgentsById.get(agent.id)),
      ),
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
      world: message.world,
    }));
    return;
  }

  setRenderSnapshots(message.snapshot);
  useWorldStore.setState((state) => ({
    ...state,
    carryMs: 0,
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
  bootstrap: (seed = STARTER_WORLD_SEED) => {
    if (simulationWorker) {
      set({
        paused: false,
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
) => {
  const worldPoint = {
    x: (point.x - offset.x) / tileSize,
    y: (point.y - offset.y) / tileSize,
  };

  return world.entities.agents.find((agent) => {
    const dx = agent.pos.x - worldPoint.x;
    const dy = agent.pos.y - worldPoint.y;
    return dx * dx + dy * dy <= 0.45 * 0.45;
  });
};

export const tileFromCanvasPoint = (point: { x: number; y: number }, tileSize: number, offset: { x: number; y: number }) =>
  pointToTile({
    x: (point.x - offset.x) / tileSize,
    y: (point.y - offset.y) / tileSize,
  });
