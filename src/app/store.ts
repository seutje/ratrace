import { create } from 'zustand';
import { advanceWorld, stepWorld } from '../sim/stepWorld';
import { MAX_FRAME_ADVANCE_MS, STARTER_WORLD_SEED } from '../sim/constants';
import { BuildMode, WorldState } from '../sim/types';
import {
  SimulationWorkerInboundMessage,
  SimulationWorkerOutboundMessage,
} from '../sim/simulationWorkerTypes';
import { paintWorldTile, selectWorldAgent } from '../sim/worldMutations';
import { createStarterWorld } from '../sim/world';
import { pointToTile } from '../sim/utils';

type WorldStore = {
  world: WorldState;
  paused: boolean;
  buildMode: BuildMode;
  carryMs: number;
  bootstrap: (seed?: number) => void;
  reset: () => void;
  setPaused: (paused: boolean) => void;
  singleStep: () => void;
  advanceElapsed: (elapsedMs: number) => void;
  selectAgent: (agentId?: string) => void;
  setBuildMode: (mode: BuildMode) => void;
  paintTile: (x: number, y: number, type: BuildMode) => void;
};

let simulationWorker: Worker | null = null;
let pendingElapsedMs = 0;
let advanceInFlight = false;

const postSimulationWorkerMessage = (message: SimulationWorkerInboundMessage) => {
  simulationWorker?.postMessage(message);
};

const flushQueuedAdvance = () => {
  if (!simulationWorker || advanceInFlight || pendingElapsedMs <= 0) {
    return;
  }

  const elapsedMs = pendingElapsedMs;
  pendingElapsedMs = 0;
  advanceInFlight = true;
  postSimulationWorkerMessage({
    type: 'advance',
    elapsedMs,
    maxElapsedMs: MAX_FRAME_ADVANCE_MS,
  });
};

const applyWorkerSnapshot = (message: SimulationWorkerOutboundMessage) => {
  advanceInFlight = false;
  useWorldStore.setState((state) => ({
    ...state,
    world: message.world,
    carryMs: message.carryMs,
  }));

  if (!useWorldStore.getState().paused) {
    flushQueuedAdvance();
  }
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
    if (event.data.type === 'snapshot') {
      applyWorkerSnapshot(event.data);
    }
  };

  const state = useWorldStore.getState();
  postSimulationWorkerMessage({
    type: 'init',
    world: state.world,
    carryMs: state.carryMs,
  });
};

export const stopSimulationWorker = () => {
  pendingElapsedMs = 0;
  advanceInFlight = false;
  simulationWorker?.terminate();
  simulationWorker = null;
};

export const useWorldStore = create<WorldStore>((set, get) => ({
  world: createStarterWorld(),
  paused: false,
  buildMode: 'select',
  carryMs: 0,
  bootstrap: (seed = STARTER_WORLD_SEED) => {
    pendingElapsedMs = 0;
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
    pendingElapsedMs = 0;
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
    if (!paused) {
      flushQueuedAdvance();
    } else {
      pendingElapsedMs = 0;
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
      pendingElapsedMs += elapsedMs;
      flushQueuedAdvance();
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
