type ControlsProps = {
  paused: boolean;
  onPauseToggle: () => void;
  onSingleStep: () => void;
  onReset: () => void;
};

export const Controls = ({ paused, onPauseToggle, onSingleStep, onReset }: ControlsProps) => {
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
    </section>
  );
};
