import { useMemo } from 'react';
import { AgentSex, AgentState, Agent, Building } from '../sim/types';
import { useWorldStore } from '../app/store';
import { buttonClass, cx, labelClass, panelClass, panelHeadingClass, selectedButtonClass } from './styles';
import { getKnownAgentNamesById } from './inspectorData';

const stateColors: Record<AgentState, string> = {
  [AgentState.Idle]: '#3d4738',
  [AgentState.MovingToWork]: '#b55c2f',
  [AgentState.Working]: '#8f2c1a',
  [AgentState.MovingHome]: '#0f6e69',
  [AgentState.Sleeping]: '#30527f',
  [AgentState.MovingToShop]: '#6252ab',
  [AgentState.Shopping]: '#2d8580',
  [AgentState.Wandering]: '#76532d',
};

const sexLabels: Record<AgentSex, string> = {
  [AgentSex.Female]: 'Female',
  [AgentSex.Male]: 'Male',
};

type InspectorProps = {
  followActive: boolean;
  onFollowToggle: () => void;
};

type RelationshipEntry = {
  id: string;
  name: string;
};

type InspectableAgent = Pick<Agent, 'homeId' | 'workId'>;

const EMPTY_ENTRIES: RelationshipEntry[] = [];

const getRelationshipEntries = (agentIds: string[], namesById: Map<string, string>) =>
  Array.from(new Set(agentIds)).map((agentId) => ({
    id: agentId,
    name: namesById.get(agentId) ?? agentId,
  }));

const getAgentBuildings = (buildings: Building[] | undefined, agent: InspectableAgent | undefined) => {
  if (!buildings || !agent) {
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

const RelationshipList = ({
  entries,
  onSelect,
}: {
  entries: RelationshipEntry[];
  onSelect: (agentId: string) => void;
}) => {
  if (entries.length === 0) {
    return <dd className="max-w-[13rem] text-right">None</dd>;
  }

  return (
    <dd className="max-w-[13rem] text-right">
      {entries.map((entry, index) => (
        <span key={entry.id}>
          {index > 0 ? ', ' : null}
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-inherit underline decoration-[rgba(40,26,17,0.4)] underline-offset-2 transition-colors duration-150 ease-out hover:text-[#8f2c1a]"
            onClick={() => onSelect(entry.id)}
          >
            {entry.name}
          </button>
        </span>
      ))}
    </dd>
  );
};

export const Inspector = ({ followActive, onFollowToggle }: InspectorProps) => {
  const selectedAgentId = useWorldStore((state) => state.world.selectedAgentId);
  const selectedAgentSnapshot = useWorldStore((state) => state.selectedAgentSnapshot);
  const worldAgents = useWorldStore((state) =>
    state.world.selectedAgentId !== undefined ? state.world.entities.agents : undefined,
  );
  const obituary = useWorldStore((state) =>
    state.world.selectedAgentId !== undefined ? state.world.obituary : undefined,
  );
  const buildings = useWorldStore((state) =>
    state.world.selectedAgentId !== undefined ? state.world.entities.buildings : undefined,
  );
  const selectAgent = useWorldStore((state) => state.selectAgent);

  const agentIndexes = useMemo(() => {
    if (!worldAgents || !obituary) {
      return {
        agentNamesById: new Map<string, string>(),
        residentsByHomeId: new Map<string, RelationshipEntry[]>(),
      };
    }

    const agentNamesById = getKnownAgentNamesById({ agents: worldAgents, obituary });
    const residentsByHomeId = new Map<string, RelationshipEntry[]>();

    for (const worldAgent of worldAgents) {
      const residents = residentsByHomeId.get(worldAgent.homeId);
      const entry = { id: worldAgent.id, name: worldAgent.name };

      if (residents) {
        residents.push(entry);
      } else {
        residentsByHomeId.set(worldAgent.homeId, [entry]);
      }
    }

    for (const residents of residentsByHomeId.values()) {
      residents.sort((left, right) => left.name.localeCompare(right.name));
    }

    return {
      agentNamesById,
      residentsByHomeId,
    };
  }, [obituary, worldAgents]);

  const agent = useMemo(
    () =>
      selectedAgentSnapshot?.id === selectedAgentId
        ? selectedAgentSnapshot
        : selectedAgentId !== undefined
          ? worldAgents?.find((entry) => entry.id === selectedAgentId)
          : undefined,
    [selectedAgentId, selectedAgentSnapshot, worldAgents],
  );
  const { home, work } = useMemo(() => getAgentBuildings(buildings, agent), [agent, buildings]);
  const homeLabel = home?.label ?? 'None';
  const workLabel = work?.label ?? 'None';
  const roommates = useMemo(() => {
    if (!agent) {
      return EMPTY_ENTRIES;
    }

    const residents = agentIndexes.residentsByHomeId.get(agent.homeId);
    return residents ? residents.filter((entry) => entry.id !== agent.id) : EMPTY_ENTRIES;
  }, [agent, agentIndexes]);
  const parents = useMemo(
    () => (agent ? getRelationshipEntries(agent.parentIds, agentIndexes.agentNamesById) : EMPTY_ENTRIES),
    [agent, agentIndexes],
  );
  const children = useMemo(
    () => (agent ? getRelationshipEntries(agent.childIds, agentIndexes.agentNamesById) : EMPTY_ENTRIES),
    [agent, agentIndexes],
  );
  const coParents = useMemo(
    () => (agent ? getRelationshipEntries(agent.coParentIds, agentIndexes.agentNamesById) : EMPTY_ENTRIES),
    [agent, agentIndexes],
  );

  return (
    <section className={`${panelClass} grid gap-3`}>
      <h2 className={panelHeadingClass}>Inspector</h2>
      {agent ? (
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <strong>{agent.name}</strong>
            <span
              className="rounded-full px-[10px] py-1.5 font-mono text-[0.78rem] text-[#fffdf6]"
              style={{ backgroundColor: stateColors[agent.state] }}
            >
              {agent.state}
            </span>
          </div>
          <button
            type="button"
            className={cx(buttonClass, 'w-full', followActive && selectedButtonClass)}
            aria-pressed={followActive}
            onClick={onFollowToggle}
          >
            Follow
          </button>
          <p className="m-0 italic text-[#5b4837]">"{agent.thought}"</p>
          <dl className="m-0 grid gap-2.5">
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Sex</dt>
              <dd>{sexLabels[agent.sex]}</dd>
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Wallet</dt>
              <dd>${agent.wallet}</dd>
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Lunches</dt>
              <dd>{agent.carriedMeals}</dd>
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Hunger</dt>
              <dd>{agent.stats.hunger.toFixed(1)}</dd>
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Energy</dt>
              <dd>{agent.stats.energy.toFixed(1)}</dd>
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Happiness</dt>
              <dd>{agent.stats.happiness.toFixed(1)}</dd>
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Traits</dt>
              <dd className="text-right">
                A {agent.traits.appetite.toFixed(2)} / S {agent.traits.stamina.toFixed(2)}
                <br />
                T {agent.traits.thrift.toFixed(2)} / R {agent.traits.resilience.toFixed(2)}
              </dd>
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Home</dt>
              <dd>{homeLabel}</dd>
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Work</dt>
              <dd>{workLabel}</dd>
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Roommates</dt>
              <RelationshipList entries={roommates} onSelect={selectAgent} />
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Had Child With</dt>
              <RelationshipList entries={coParents} onSelect={selectAgent} />
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Children</dt>
              <RelationshipList entries={children} onSelect={selectAgent} />
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Parents</dt>
              <RelationshipList entries={parents} onSelect={selectAgent} />
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Pantry</dt>
              <dd>{home ? `${home.pantryStock}/${home.pantryCapacity}` : 'None'}</dd>
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Memory</dt>
              <dd className="text-right">
                Avg {agent.memory.averageCommuteMinutes.toFixed(0)}m / Max {agent.memory.longestCommuteMinutes.toFixed(0)}m
                <br />
                Shops {agent.memory.shoppingTrips} / Shifts {agent.memory.completedShifts}
              </dd>
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Hardship</dt>
              <dd>
                {agent.memory.recentHardshipDays}d, unpaid {agent.memory.unpaidHours}h
              </dd>
            </div>
            <div className="flex justify-between gap-2.5">
              <dt className={labelClass}>Path Count</dt>
              <dd>{agent.routeComputeCount}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="m-0 text-[#5b4837]">Click an agent on the canvas to inspect them.</p>
      )}
    </section>
  );
};
