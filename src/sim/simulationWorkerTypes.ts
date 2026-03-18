import {
  Agent,
  AgentState,
  Building,
  BuildMode,
  Economy,
  TrafficMap,
  WorldMetrics,
  WorldState,
} from './types';

export type DynamicAgentSnapshot = Omit<Agent, 'route' | 'routeIndex' | 'routeMapVersion'>;

export type DynamicBuildingSnapshot = Building;

export const agentStateOrder = [
  AgentState.Idle,
  AgentState.MovingToWork,
  AgentState.Working,
  AgentState.MovingHome,
  AgentState.Sleeping,
  AgentState.MovingToShop,
  AgentState.Shopping,
  AgentState.Wandering,
] as const;

export type CompactAgentFrame = {
  energyValues: Float32Array;
  happinessValues: Float32Array;
  hungerValues: Float32Array;
  posX: Float32Array;
  posY: Float32Array;
  stateCodes: Uint8Array;
};

export type WorldDynamicSnapshot = {
  day: number;
  economy: Economy;
  entities: {
    buildings: DynamicBuildingSnapshot[];
  };
  frame: CompactAgentFrame;
  metrics: WorldMetrics;
  minutesOfDay: number;
  selectedAgent?: DynamicAgentSnapshot;
  selectedAgentId?: string;
  tick: number;
  traffic: TrafficMap;
};

export type SimulationWorkerInboundMessage =
  | {
      paused: boolean;
      type: 'sync';
    }
  | {
      paused: boolean;
      type: 'setPaused';
    }
  | {
      type: 'bootstrap';
      seed: number;
    }
  | {
      type: 'reset';
    }
  | {
      type: 'step';
    }
  | {
      type: 'selectAgent';
      agentId?: string;
    }
  | {
      type: 'paintTile';
      mode: BuildMode;
      x: number;
      y: number;
    };

export type SimulationWorkerOutboundMessage = {
  type: 'fullSnapshot';
  world: WorldState;
} | {
  snapshot: WorldDynamicSnapshot;
  type: 'dynamicSnapshot';
};
