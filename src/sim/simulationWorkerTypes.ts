import {
  Agent,
  BuildMode,
  Building,
  Economy,
  TrafficMap,
  WorldMetrics,
  WorldState,
} from './types';

export type DynamicAgentSnapshot = Omit<Agent, 'route' | 'routeIndex' | 'routeMapVersion'>;

export type DynamicBuildingSnapshot = Building;

export type WorldDynamicSnapshot = {
  day: number;
  economy: Economy;
  entities: {
    agents: DynamicAgentSnapshot[];
    buildings: DynamicBuildingSnapshot[];
  };
  metrics: WorldMetrics;
  minutesOfDay: number;
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
