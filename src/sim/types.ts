export type Point = {
  x: number;
  y: number;
};

export enum TileType {
  Empty = 'EMPTY',
  Road = 'ROAD',
  Residential = 'RESIDENTIAL',
  Commercial = 'COMMERCIAL',
  Industrial = 'INDUSTRIAL',
  Blocked = 'BLOCKED',
}

export enum BuildingKind {
  Residential = 'RESIDENTIAL',
  Commercial = 'COMMERCIAL',
  Industrial = 'INDUSTRIAL',
}

export enum AgentState {
  Idle = 'IDLE',
  MovingToWork = 'MOVING_TO_WORK',
  Working = 'WORKING',
  MovingHome = 'MOVING_HOME',
  Sleeping = 'SLEEPING',
  MovingToShop = 'MOVING_TO_SHOP',
  Shopping = 'SHOPPING',
  Wandering = 'WANDERING',
}

export type Tile = {
  x: number;
  y: number;
  type: TileType;
  buildingId?: string;
};

export type Economy = {
  inflation: number;
  treasury: number;
  totalWealth: number;
  supplyStock: number;
};

export type Building = {
  id: string;
  kind: BuildingKind;
  tile: Point;
  cash: number;
  stock: number;
  capacity: number;
  pantryStock: number;
  pantryCapacity: number;
  label: string;
};

export type AgentStats = {
  hunger: number;
  energy: number;
  happiness: number;
};

export type AgentDestination = {
  buildingId: string;
  kind: 'home' | 'work' | 'shop';
};

export type Agent = {
  id: string;
  name: string;
  pos: Point;
  wallet: number;
  carriedMeals: number;
  stats: AgentStats;
  homeId: string;
  workId: string;
  state: AgentState;
  thought: string;
  route: Point[];
  routeIndex: number;
  routeComputeCount: number;
  routeMapVersion: number;
  commuteToWorkRoute: Point[] | null;
  commuteToWorkRouteMapVersion: number;
  commuteToHomeRoute: Point[] | null;
  commuteToHomeRouteMapVersion: number;
  destination?: AgentDestination;
  lastShoppedTick?: number;
  sleepUntilTick?: number;
  shiftStartMinute: number;
  shiftDay: number;
  shiftWorkMinutes: number;
  paidShiftWorkMinutes: number;
  lastCompletedShiftDay: number;
  daysInCity: number;
  maxHungerStreakDays: number;
  keptMaxHungerToday: boolean;
};

export type TrafficMap = Record<string, number>;

export type WorldMetrics = {
  mapVersion: number;
  trafficPeak: number;
  pathComputations: number;
  populationCapacity: number;
};

export type OverlayMode =
  | 'none'
  | 'traffic'
  | 'hunger'
  | 'energy'
  | 'housing'
  | 'businessCash'
  | 'retailStock';

export type WorldState = {
  seed: number;
  tick: number;
  minutesOfDay: number;
  day: number;
  width: number;
  height: number;
  tiles: Tile[];
  economy: Economy;
  entities: {
    agents: Agent[];
    buildings: Building[];
  };
  selectedAgentId?: string;
  traffic: TrafficMap;
  metrics: WorldMetrics;
};

export type SimulationAdvanceResult = {
  world: WorldState;
  carryMs: number;
  stepsApplied: number;
};

export type BuildMode = 'select' | TileType.Road | TileType.Residential | TileType.Commercial | TileType.Industrial;
