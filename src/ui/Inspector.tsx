import { AgentState, WorldState } from '../sim/types';

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

type InspectorProps = {
  world: WorldState;
};

export const Inspector = ({ world }: InspectorProps) => {
  const agent = world.entities.agents.find((entry) => entry.id === world.selectedAgentId);
  const home = world.entities.buildings.find((building) => building.id === agent?.homeId);
  const work = world.entities.buildings.find((building) => building.id === agent?.workId);

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
              <dd>{home?.label ?? 'None'}</dd>
            </div>
            <div>
              <dt>Work</dt>
              <dd>{work?.label ?? 'None'}</dd>
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
