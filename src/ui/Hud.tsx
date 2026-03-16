import { formatClock, toClockNumber } from '../sim/utils';
import { WorldState } from '../sim/types';

type HudProps = {
  world: WorldState;
};

export const Hud = ({ world }: HudProps) => {
  return (
    <header className="hud">
      <div>
        <span className="label">World Time</span>
        <strong>{formatClock(world.minutesOfDay)}</strong>
        <small>{toClockNumber(world.minutesOfDay)}</small>
      </div>
      <div>
        <span className="label">Population</span>
        <strong>{world.entities.agents.length}</strong>
        <small>cap {world.metrics.populationCapacity}</small>
      </div>
      <div>
        <span className="label">Treasury</span>
        <strong>${world.economy.treasury}</strong>
        <small>wealth {world.economy.totalWealth}</small>
      </div>
    </header>
  );
};
