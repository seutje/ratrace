import { buttonClass, cx, labelClass, panelClass, panelHeadingClass } from './styles';

type ControlsProps = {
  paused: boolean;
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onPauseToggle: () => void;
  onSingleStep: () => void;
  onReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
};

export const Controls = ({
  paused,
  zoom,
  canZoomIn,
  canZoomOut,
  onPauseToggle,
  onSingleStep,
  onReset,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: ControlsProps) => {
  return (
    <section className={cx(panelClass, 'grid gap-[14px]')}>
      <h2 className={panelHeadingClass}>Simulation</h2>
      <div className="grid gap-2.5 min-[721px]:grid-cols-3">
        <button type="button" className={buttonClass} onClick={onPauseToggle}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className={buttonClass} onClick={onSingleStep}>
          Step
        </button>
        <button type="button" className={buttonClass} onClick={onReset}>
          Reset
        </button>
      </div>
      <div className="grid gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className={labelClass}>Zoom</span>
          <strong className="font-mono text-base text-[#281a11]">{Math.round(zoom * 100)}%</strong>
        </div>
        <div className="grid gap-2.5 min-[721px]:grid-cols-[56px_minmax(0,1fr)_56px]">
          <button type="button" className={buttonClass} onClick={onZoomOut} disabled={!canZoomOut}>
            -
          </button>
          <button type="button" className={buttonClass} onClick={onZoomReset}>
            Reset Zoom
          </button>
          <button type="button" className={buttonClass} onClick={onZoomIn} disabled={!canZoomIn}>
            +
          </button>
        </div>
      </div>
    </section>
  );
};
