import { formatClock } from '../sim/utils';
import { useWorldStore } from '../app/store';
import { cx, displayHeadingClass, hudCardClass, labelClass } from './styles';

type HudProps = {
  variant?: 'grid' | 'inline';
};

export const Hud = ({ variant = 'grid' }: HudProps) => {
  const minutesOfDay = useWorldStore((state) => state.world.minutesOfDay);
  const day = useWorldStore((state) => state.world.day);
  const population = useWorldStore((state) => state.world.entities.agents.length);
  const populationCapacity = useWorldStore((state) => state.world.metrics.populationCapacity);
  const treasury = useWorldStore((state) => state.world.economy.treasury);
  const totalWealth = useWorldStore((state) => state.world.economy.totalWealth);

  return (
    <header className={cx('grid gap-3 min-[721px]:grid-cols-3', variant === 'inline' && 'self-center')}>
      <div className={hudCardClass}>
        <span className={labelClass}>World Time</span>
        <strong className={cx(displayHeadingClass, 'm-0 text-[1.45rem]')}>{formatClock(minutesOfDay)}</strong>
        <small className="font-mono text-[#6a5c4f]">day {day}</small>
      </div>
      <div className={hudCardClass}>
        <span className={labelClass}>Population</span>
        <strong className={cx(displayHeadingClass, 'm-0 text-[1.45rem]')}>{population}</strong>
        <small className="font-mono text-[#6a5c4f]">cap {populationCapacity}</small>
      </div>
      <div className={hudCardClass}>
        <span className={labelClass}>Treasury</span>
        <strong className={cx(displayHeadingClass, 'm-0 text-[1.45rem]')}>${treasury}</strong>
        <small className="font-mono text-[#6a5c4f]">wealth {totalWealth}</small>
      </div>
    </header>
  );
};
