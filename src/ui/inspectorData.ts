import { DynamicAgentSnapshot } from '../sim/simulationWorkerTypes';
import { Agent, AgentSex, AgentState, Building, WorldState } from '../sim/types';

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

export type RelationshipEntry = {
  id: string;
  name: string;
};

type InspectableAgent = Pick<Agent, 'homeId' | 'workId'>;

export type ResolvedInspectorData = {
  agent?: Agent | DynamicAgentSnapshot;
  children: RelationshipEntry[];
  coParents: RelationshipEntry[];
  home?: Building;
  parents: RelationshipEntry[];
  roommates: RelationshipEntry[];
  work?: Building;
};

const EMPTY_ENTRIES: RelationshipEntry[] = [];

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

export const resolveInspectorData = (
  world: WorldState,
  selectedAgentSnapshot?: DynamicAgentSnapshot,
): ResolvedInspectorData => {
  if (world.selectedAgentId === undefined) {
    return {
      children: EMPTY_ENTRIES,
      coParents: EMPTY_ENTRIES,
      parents: EMPTY_ENTRIES,
      roommates: EMPTY_ENTRIES,
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
    return {
      children: EMPTY_ENTRIES,
      coParents: EMPTY_ENTRIES,
      parents: EMPTY_ENTRIES,
      roommates: EMPTY_ENTRIES,
    };
  }

  const { home, work } = getAgentBuildings(world.entities.buildings, agent);
  const residents = residentsByHomeId.get(agent.homeId);

  return {
    agent,
    children: getRelationshipEntries(agent.childIds, agentNamesById),
    coParents: getRelationshipEntries(agent.coParentIds, agentNamesById),
    home,
    parents: getRelationshipEntries(agent.parentIds, agentNamesById),
    roommates: residents ? residents.filter((entry) => entry.id !== agent.id) : EMPTY_ENTRIES,
    work,
  };
};
