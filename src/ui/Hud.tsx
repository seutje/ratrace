import { formatClock, toClockNumber } from '../sim/utils';
import { useWorldStore } from '../app/store';

export const Hud = () => {
  const minutesOfDay = useWorldStore((state) => state.world.minutesOfDay);
  const population = useWorldStore((state) => state.world.entities.agents.length);
  const populationCapacity = useWorldStore((state) => state.world.metrics.populationCapacity);
  const treasury = useWorldStore((state) => state.world.economy.treasury);
  const totalWealth = useWorldStore((state) => state.world.economy.totalWealth);

  return (
    <header className="hud">
      <div>
        <span className="label">World Time</span>
        <strong>{formatClock(minutesOfDay)}</strong>
        <small>{toClockNumber(minutesOfDay)}</small>
      </div>
      <div>
        <span className="label">Population</span>
        <strong>{population}</strong>
        <small>cap {populationCapacity}</small>
      </div>
      <div>
        <span className="label">Treasury</span>
        <strong>${treasury}</strong>
        <small>wealth {totalWealth}</small>
      </div>
    </header>
  );
};
