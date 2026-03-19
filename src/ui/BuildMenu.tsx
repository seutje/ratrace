import { BuildMode, TileType } from '../sim/types';
import { buttonClass, cx, panelClass, panelHeadingClass, selectedButtonClass } from './styles';

type BuildMenuProps = {
  mode: BuildMode;
  onChange: (mode: BuildMode) => void;
};

const options: { mode: BuildMode; label: string }[] = [
  { mode: 'select', label: 'Select' },
  { mode: TileType.Road, label: 'Road' },
  { mode: TileType.Residential, label: 'Zone Res' },
  { mode: TileType.Commercial, label: 'Zone Comm' },
  { mode: TileType.Industrial, label: 'Zone Ind' },
];

export const BuildMenu = ({ mode, onChange }: BuildMenuProps) => {
  return (
    <section className={panelClass}>
      <h2 className={panelHeadingClass}>Build Menu</h2>
      <div className="grid gap-2.5 min-[721px]:grid-cols-2">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            className={cx(buttonClass, option.mode === mode && selectedButtonClass)}
            aria-pressed={option.mode === mode}
            onClick={() => onChange(option.mode)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
};
