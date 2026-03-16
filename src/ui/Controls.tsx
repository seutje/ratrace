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
    <section className="panel controls">
      <h2>Simulation</h2>
      <div className="button-row">
        <button type="button" onClick={onPauseToggle}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" onClick={onSingleStep}>
          Step
        </button>
        <button type="button" onClick={onReset}>
          Reset
        </button>
      </div>
      <div className="control-stack">
        <div className="control-meta">
          <span className="label">Zoom</span>
          <strong>{Math.round(zoom * 100)}%</strong>
        </div>
        <div className="button-row zoom-row">
          <button type="button" onClick={onZoomOut} disabled={!canZoomOut}>
            -
          </button>
          <button type="button" onClick={onZoomReset}>
            Reset Zoom
          </button>
          <button type="button" onClick={onZoomIn} disabled={!canZoomIn}>
            +
          </button>
        </div>
      </div>
    </section>
  );
};
