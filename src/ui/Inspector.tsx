import { AgentState } from '../sim/types';
import { useWorldStore } from '../app/store';
import { buttonClass, cx, labelClass, panelClass, panelHeadingClass, selectedButtonClass } from './styles';

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

type InspectorProps = {
  followActive: boolean;
  onFollowToggle: () => void;
};

export const Inspector = ({ followActive, onFollowToggle }: InspectorProps) => {
  const selectedAgentId = useWorldStore((state) => state.world.selectedAgentId);
  const selectedAgentSnapshot = useWorldStore((state) => state.selectedAgentSnapshot);
  const agent = useWorldStore((state) =>
    selectedAgentSnapshot?.id === selectedAgentId
      ? selectedAgentSnapshot
      : state.world.entities.agents.find((entry) => entry.id === selectedAgentId),
  );
  const home = useWorldStore((state) => {
    if (!agent) {
      return undefined;
    }

    return state.world.entities.buildings.find((building) => building.id === agent.homeId);
  });
  const homeLabel = useWorldStore((state) => {
    if (!agent) {
      return 'None';
    }

    return state.world.entities.buildings.find((building) => building.id === agent.homeId)?.label ?? 'None';
  });
  const workLabel = useWorldStore((state) => {
    if (!agent) {
      return 'None';
    }

    return state.world.entities.buildings.find((building) => building.id === agent.workId)?.label ?? 'None';
  });

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
              <dt className={labelClass}>Home</dt>
              <dd>{homeLabel}</dd>
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Work</dt>
              <dd>{workLabel}</dd>
            </div>
            <div className="flex justify-between gap-2.5 border-b border-[rgba(60,40,20,0.1)] pb-2">
              <dt className={labelClass}>Pantry</dt>
              <dd>{home ? `${home.pantryStock}/${home.pantryCapacity}` : 'None'}</dd>
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
