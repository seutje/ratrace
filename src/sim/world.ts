import {
  COMMERCIAL_RESTOCK_PER_HOUR,
  HOURLY_WAGE,
  INDUSTRIAL_OUTPUT_PER_HOUR,
  STARTER_WORLD_HEIGHT,
  STARTER_WORLD_WIDTH,
} from './constants';
import { createRng } from './random';
import { Building, BuildingKind, Tile, TileType, WorldState, AgentState } from './types';
import { getTileIndex } from './utils';

const makeTile = (x: number, y: number, type: TileType = TileType.Empty): Tile => ({ x, y, type });

const starterBuildings = [
  { id: 'home-a', kind: BuildingKind.Residential, x: 3, y: 3, label: 'Birch House', capacity: 2, stock: 0 },
  { id: 'home-b', kind: BuildingKind.Residential, x: 5, y: 3, label: 'Linen Loft', capacity: 2, stock: 0 },
  { id: 'home-c', kind: BuildingKind.Residential, x: 3, y: 9, label: 'Amber Flats', capacity: 2, stock: 0 },
  { id: 'home-d', kind: BuildingKind.Residential, x: 5, y: 9, label: 'Canal Court', capacity: 2, stock: 0 },
  { id: 'shop-a', kind: BuildingKind.Commercial, x: 14, y: 3, label: 'Morsel Mart', capacity: 4, stock: 8 },
  { id: 'shop-b', kind: BuildingKind.Commercial, x: 16, y: 3, label: 'Corner Pantry', capacity: 4, stock: 6 },
  { id: 'work-a', kind: BuildingKind.Industrial, x: 14, y: 9, label: 'Bolt Works', capacity: 4, stock: 6 },
  { id: 'work-b', kind: BuildingKind.Industrial, x: 16, y: 9, label: 'Foundry Row', capacity: 4, stock: 4 },
] as const;

const starterRoads = [
  ...Array.from({ length: STARTER_WORLD_WIDTH }, (_, x) => ({ x, y: 6 })),
  ...Array.from({ length: STARTER_WORLD_HEIGHT }, (_, y) => ({ x: 9, y })),
  { x: 3, y: 4 },
  { x: 5, y: 4 },
  { x: 3, y: 5 },
  { x: 5, y: 5 },
  { x: 3, y: 8 },
  { x: 5, y: 8 },
  { x: 3, y: 7 },
  { x: 5, y: 7 },
  { x: 14, y: 4 },
  { x: 16, y: 4 },
  { x: 14, y: 5 },
  { x: 16, y: 5 },
  { x: 14, y: 8 },
  { x: 16, y: 8 },
  { x: 14, y: 7 },
  { x: 16, y: 7 },
];

const agentNames = ['Iris', 'Milo', 'June', 'Otis', 'Nia', 'Rhea', 'Theo', 'Pia'];

const setTileType = (tiles: Tile[], x: number, y: number, type: TileType) => {
  tiles[y * STARTER_WORLD_WIDTH + x] = { ...tiles[y * STARTER_WORLD_WIDTH + x], type };
};

export const createStarterWorld = (seed = 7): WorldState => {
  const rng = createRng(seed);
  const tiles = Array.from({ length: STARTER_WORLD_WIDTH * STARTER_WORLD_HEIGHT }, (_, index) =>
    makeTile(index % STARTER_WORLD_WIDTH, Math.floor(index / STARTER_WORLD_WIDTH)),
  );

  starterRoads.forEach(({ x, y }) => setTileType(tiles, x, y, TileType.Road));

  const buildings: Building[] = starterBuildings.map((building) => ({
    id: building.id,
    kind: building.kind,
    tile: { x: building.x, y: building.y },
    stock: building.stock,
    capacity: building.capacity,
    label: building.label,
  }));

  buildings.forEach((building) => {
    const tileType =
      building.kind === BuildingKind.Residential
        ? TileType.Residential
        : building.kind === BuildingKind.Commercial
          ? TileType.Commercial
          : TileType.Industrial;
    const index = getTileIndex({ width: STARTER_WORLD_WIDTH }, building.tile);
    tiles[index] = {
      ...tiles[index],
      type: tileType,
      buildingId: building.id,
    };
  });

  const homes = buildings.filter((building) => building.kind === BuildingKind.Residential);
  const workplaces = buildings.filter((building) => building.kind === BuildingKind.Industrial);

  const agents = homes.map((home, index) => {
    const workId = workplaces[index % workplaces.length].id;
    return {
      id: `agent-${index + 1}`,
      name: agentNames[index % agentNames.length],
      pos: { x: home.tile.x + 0.5, y: home.tile.y + 0.5 },
      wallet: 20 + Math.floor(rng() * 20),
      stats: {
        hunger: Math.floor(15 + rng() * 20),
        energy: Math.floor(55 + rng() * 25),
        happiness: Math.floor(60 + rng() * 20),
      },
      homeId: home.id,
      workId,
      state: AgentState.Idle,
      thought: 'Settling in.',
      route: [],
      routeIndex: 0,
      routeComputeCount: 0,
      routeMapVersion: 0,
      destination: undefined,
      lastPaidKey: undefined,
      lastShoppedTick: undefined,
      daysInCity: 0,
    };
  });

  return {
    seed,
    tick: 0,
    minutesOfDay: 7 * 60,
    day: 1,
    width: STARTER_WORLD_WIDTH,
    height: STARTER_WORLD_HEIGHT,
    tiles,
    economy: {
      inflation: 1,
      treasury: 5000,
      totalWealth:
        5000 +
        agents.reduce((sum, agent) => sum + agent.wallet, 0) +
        buildings.reduce((sum, building) => sum + building.stock * 2, 0),
      supplyStock: buildings.reduce((sum, building) => sum + building.stock, 0),
    },
    entities: {
      agents,
      buildings,
      paths: [],
    },
    selectedAgentId: undefined,
    traffic: {},
    metrics: {
      mapVersion: 1,
      trafficPeak: 0,
      pathComputations: 0,
      populationCapacity: homes.reduce((sum, home) => sum + home.capacity, 0),
    },
  };
};

export const createBlankWorld = (width: number, height: number): WorldState => ({
  seed: 0,
  tick: 0,
  minutesOfDay: 0,
  day: 1,
  width,
  height,
  tiles: Array.from({ length: width * height }, (_, index) => makeTile(index % width, Math.floor(index / width))),
  economy: {
    inflation: 1,
    treasury: HOURLY_WAGE * INDUSTRIAL_OUTPUT_PER_HOUR,
    totalWealth: HOURLY_WAGE * INDUSTRIAL_OUTPUT_PER_HOUR,
    supplyStock: COMMERCIAL_RESTOCK_PER_HOUR,
  },
  entities: {
    agents: [],
    buildings: [],
    paths: [],
  },
  traffic: {},
  metrics: {
    mapVersion: 1,
    trafficPeak: 0,
    pathComputations: 0,
    populationCapacity: 0,
  },
});
