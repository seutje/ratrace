import { OverlayMode } from '../sim/types';
import { overlayOptions } from './overlayOptions';
import { buttonClass, cx, panelClass, panelHeadingClass, selectedButtonClass } from './styles';

type OverlayMenuProps = {
  mode: OverlayMode;
  onChange: (mode: OverlayMode) => void;
};

export const OverlayMenu = ({ mode, onChange }: OverlayMenuProps) => {
  return (
    <section className={panelClass}>
      <h2 className={panelHeadingClass}>Overlay Modes</h2>
      <div className="grid gap-2.5 min-[721px]:grid-cols-2">
        {overlayOptions.map((option) => (
          <button
            key={option.mode}
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
