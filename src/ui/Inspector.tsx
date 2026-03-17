import { AgentState } from '../sim/types';
import { useWorldStore } from '../app/store';

const stateColors: Record<AgentState, string> = {
  [AgentState.Idle]: '#3d4738',
  [AgentState.MovingToWork]: '#b55c2f',
  [AgentState.Working]: '#8f2c1a',
  [AgentState.MovingHome]: '#6252ab',
  [AgentState.Sleeping]: '#30527f',
  [AgentState.MovingToShop]: '#0f6e69',
  [AgentState.Shopping]: '#2d8580',
  [AgentState.Wandering]: '#76532d',
};

export const Inspector = () => {
  const selectedAgentId = useWorldStore((state) => state.world.selectedAgentId);
  const agent = useWorldStore((state) => state.world.entities.agents.find((entry) => entry.id === selectedAgentId));
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
    <section className="panel inspector">
      <h2>Inspector</h2>
      {agent ? (
        <div>
          <div className="inspector-title">
            <strong>{agent.name}</strong>
            <span style={{ backgroundColor: stateColors[agent.state] }}>{agent.state}</span>
          </div>
          <p className="thought">"{agent.thought}"</p>
          <dl>
            <div>
              <dt>Wallet</dt>
              <dd>${agent.wallet}</dd>
            </div>
            <div>
              <dt>Hunger</dt>
              <dd>{agent.stats.hunger.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Energy</dt>
              <dd>{agent.stats.energy.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Happiness</dt>
              <dd>{agent.stats.happiness.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Home</dt>
              <dd>{homeLabel}</dd>
            </div>
            <div>
              <dt>Work</dt>
              <dd>{workLabel}</dd>
            </div>
            <div>
              <dt>Pantry</dt>
              <dd>{home ? `${home.pantryStock}/${home.pantryCapacity}` : 'None'}</dd>
            </div>
            <div>
              <dt>Path Count</dt>
              <dd>{agent.routeComputeCount}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="empty-state">Click an agent on the canvas to inspect them.</p>
      )}
    </section>
  );
};
