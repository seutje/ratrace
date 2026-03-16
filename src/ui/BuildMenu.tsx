import { BuildMode, TileType } from '../sim/types';

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
    <section className="panel">
      <h2>Build Menu</h2>
      <div className="build-grid">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            className={option.mode === mode ? 'selected' : undefined}
            onClick={() => onChange(option.mode)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
};
