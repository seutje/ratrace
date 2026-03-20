import { DynamicAgentSnapshot } from '../sim/simulationWorkerTypes';
import { Agent, AgentSex, AgentState, Building, BuildingKind, Tile, TileType, WorldState } from '../sim/types';
import { getTile, isZonedTileType } from '../sim/utils';

export const inspectorStateColors: Record<AgentState, string> = {
  [AgentState.Idle]: '#3d4738',
  [AgentState.MovingToWork]: '#b55c2f',
  [AgentState.Working]: '#8f2c1a',
  [AgentState.MovingHome]: '#0f6e69',
  [AgentState.Sleeping]: '#30527f',
  [AgentState.MovingToShop]: '#6252ab',
  [AgentState.Shopping]: '#2d8580',
  [AgentState.Wandering]: '#76532d',
};

export const inspectorSexLabels: Record<AgentSex, string> = {
  [AgentSex.Female]: 'Female',
  [AgentSex.Male]: 'Male',
};

export const inspectorTileTypeLabels: Record<TileType, string> = {
  [TileType.Empty]: 'Empty',
  [TileType.Road]: 'Road',
  [TileType.Residential]: 'Residential',
  [TileType.Commercial]: 'Commercial',
  [TileType.Industrial]: 'Industrial',
  [TileType.Blocked]: 'Blocked',
};

export const inspectorTileTypeColors: Record<TileType, string> = {
  [TileType.Empty]: '#7b6d61',
  [TileType.Road]: '#53524f',
  [TileType.Residential]: '#567f56',
  [TileType.Commercial]: '#406995',
  [TileType.Industrial]: '#b88934',
  [TileType.Blocked]: '#29231d',
};

export const inspectorBuildingKindLabels: Record<BuildingKind, string> = {
  [BuildingKind.Residential]: 'Residential',
  [BuildingKind.Commercial]: 'Commercial',
  [BuildingKind.Industrial]: 'Industrial',
};

export type RelationshipEntry = {
  id: string;
  name: string;
};

type InspectableAgent = Pick<Agent, 'homeId' | 'workId'>;

export type ResolvedInspectorData = {
  kind: 'agent' | 'none' | 'tile';
  agent?: Agent | DynamicAgentSnapshot;
  building?: Building;
  children: RelationshipEntry[];
  coParents: RelationshipEntry[];
  home?: Building;
  parents: RelationshipEntry[];
  roommates: RelationshipEntry[];
  tile?: Tile;
  tileResidents: RelationshipEntry[];
  tileWorkers: RelationshipEntry[];
  work?: Building;
};

const EMPTY_ENTRIES: RelationshipEntry[] = [];

const EMPTY_INSPECTOR_DATA: ResolvedInspectorData = {
  children: EMPTY_ENTRIES,
  coParents: EMPTY_ENTRIES,
  kind: 'none',
  parents: EMPTY_ENTRIES,
  roommates: EMPTY_ENTRIES,
  tileResidents: EMPTY_ENTRIES,
  tileWorkers: EMPTY_ENTRIES,
};

const getRelationshipEntries = (agentIds: string[], namesById: Map<string, string>) =>
  Array.from(new Set(agentIds)).map((agentId) => ({
    id: agentId,
    name: namesById.get(agentId) ?? agentId,
  }));

const getAgentBuildings = (buildings: Building[], agent: InspectableAgent | undefined) => {
  if (!agent) {
    return {
      home: undefined,
      work: undefined,
    };
  }

  let home: Building | undefined;
  let work: Building | undefined;

  for (const building of buildings) {
    if (!home && building.id === agent.homeId) {
      home = building;
    }
    if (!work && building.id === agent.workId) {
      work = building;
    }

    if (home && work) {
      break;
    }
  }

  return { home, work };
};

const getSortedEntries = (agents: Agent[]) =>
  agents
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

export const resolveInspectorData = (
  world: WorldState,
  selectedAgentSnapshot?: DynamicAgentSnapshot,
): ResolvedInspectorData => {
  if (world.selectedAgentId === undefined) {
    const tile = world.selectedTile ? getTile(world, world.selectedTile) : undefined;
    if (!tile || !isZonedTileType(tile.type)) {
      return EMPTY_INSPECTOR_DATA;
    }

    const building = tile.buildingId
      ? world.entities.buildings.find((entry) => entry.id === tile.buildingId)
      : undefined;

    return {
      ...EMPTY_INSPECTOR_DATA,
      building,
      kind: 'tile',
      tile,
      tileResidents: building
        ? getSortedEntries(world.entities.agents.filter((entry) => entry.homeId === building.id))
        : EMPTY_ENTRIES,
      tileWorkers: building
        ? getSortedEntries(world.entities.agents.filter((entry) => entry.workId === building.id))
        : EMPTY_ENTRIES,
    };
  }

  const agentNamesById = new Map<string, string>();
  const residentsByHomeId = new Map<string, RelationshipEntry[]>();

  for (const worldAgent of world.entities.agents) {
    agentNamesById.set(worldAgent.id, worldAgent.name);
    const entry = { id: worldAgent.id, name: worldAgent.name };
    const residents = residentsByHomeId.get(worldAgent.homeId);

    if (residents) {
      residents.push(entry);
    } else {
      residentsByHomeId.set(worldAgent.homeId, [entry]);
    }
  }

  for (const residents of residentsByHomeId.values()) {
    residents.sort((left, right) => left.name.localeCompare(right.name));
  }

  const agent =
    selectedAgentSnapshot?.id === world.selectedAgentId
      ? selectedAgentSnapshot
      : world.entities.agents.find((entry) => entry.id === world.selectedAgentId);

  if (!agent) {
    return EMPTY_INSPECTOR_DATA;
  }

  const { home, work } = getAgentBuildings(world.entities.buildings, agent);
  const residents = residentsByHomeId.get(agent.homeId);

  return {
    agent,
    building: undefined,
    children: getRelationshipEntries(agent.childIds, agentNamesById),
    coParents: getRelationshipEntries(agent.coParentIds, agentNamesById),
    home,
    kind: 'agent',
    parents: getRelationshipEntries(agent.parentIds, agentNamesById),
    roommates: residents ? residents.filter((entry) => entry.id !== agent.id) : EMPTY_ENTRIES,
    tile: undefined,
    tileResidents: EMPTY_ENTRIES,
    tileWorkers: EMPTY_ENTRIES,
    work,
  };
};
