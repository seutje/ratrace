import {
  Agent,
  AgentState,
  Building,
  BuildMode,
  Economy,
  ObituaryEntry,
  Point,
  TrafficMap,
  WorldMetrics,
  WorldState,
} from './types';

export type DynamicAgentSnapshot = Omit<
  Agent,
  | 'route'
  | 'routeIndex'
  | 'routeMapVersion'
  | 'commuteToWorkRoute'
  | 'commuteToWorkRouteMapVersion'
  | 'commuteToHomeRoute'
  | 'commuteToHomeRouteMapVersion'
  | 'travelPurpose'
  | 'travelStartTick'
>;

export const toDynamicAgentSnapshot = (agent: Agent): DynamicAgentSnapshot => {
  const snapshot = {
    ...agent,
  } as Partial<Agent>;

  delete snapshot.route;
  delete snapshot.routeIndex;
  delete snapshot.routeMapVersion;
  delete snapshot.commuteToWorkRoute;
  delete snapshot.commuteToWorkRouteMapVersion;
  delete snapshot.commuteToHomeRoute;
  delete snapshot.commuteToHomeRouteMapVersion;
  delete snapshot.travelPurpose;
  delete snapshot.travelStartTick;

  return {
    ...(snapshot as DynamicAgentSnapshot),
    childIds: agent.childIds.slice(),
    coParentIds: agent.coParentIds.slice(),
    destination: agent.destination ? { ...agent.destination } : undefined,
    memory: { ...agent.memory },
    parentIds: agent.parentIds.slice(),
    pos: { ...agent.pos },
    stats: { ...agent.stats },
    traits: { ...agent.traits },
  };
};

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
  walletValues: Float32Array;
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
  obituary: ObituaryEntry[];
  selectedAgent?: DynamicAgentSnapshot;
  selectedAgentId?: string;
  selectedTile?: Point;
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
      type: 'selectTile';
      tile?: Point;
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
