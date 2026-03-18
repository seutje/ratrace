import { OverlayMode } from '../sim/types';
import { overlayOptions } from './overlayOptions';

type OverlayMenuProps = {
  mode: OverlayMode;
  onChange: (mode: OverlayMode) => void;
};

export const OverlayMenu = ({ mode, onChange }: OverlayMenuProps) => {
  return (
    <section className="panel">
      <h2>Overlay Modes</h2>
      <div className="overlay-grid">
        {overlayOptions.map((option) => (
          <button
            key={option.mode}
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
