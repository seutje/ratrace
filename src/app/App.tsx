import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { renderWorld, calculateViewport } from '../render/canvasRenderer';
import { useSimulationLoop } from '../render/useSimulationLoop';
import { BuildMenu } from '../ui/BuildMenu';
import { Controls } from '../ui/Controls';
import { Hud } from '../ui/Hud';
import { Inspector } from '../ui/Inspector';
import { findAgentAtCanvasPoint, tileFromCanvasPoint, useWorldStore } from './store';

type CanvasSize = {
  width: number;
  height: number;
};

export const App = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 960, height: 640 });

  const world = useWorldStore((state) => state.world);
  const paused = useWorldStore((state) => state.paused);
  const buildMode = useWorldStore((state) => state.buildMode);
  const advanceElapsed = useWorldStore((state) => state.advanceElapsed);
  const setPaused = useWorldStore((state) => state.setPaused);
  const singleStep = useWorldStore((state) => state.singleStep);
  const reset = useWorldStore((state) => state.reset);
  const setBuildMode = useWorldStore((state) => state.setBuildMode);
  const selectAgent = useWorldStore((state) => state.selectAgent);
  const paintTile = useWorldStore((state) => state.paintTile);

  useSimulationLoop(advanceElapsed);

  useEffect(() => {
    const container = frameRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      setSize({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const worldWidth = world.width;
  const worldHeight = world.height;
  const viewport = useMemo(
    () => calculateViewport({ width: worldWidth, height: worldHeight }, size.width, size.height),
    [size.height, size.width, worldHeight, worldWidth],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    renderWorld(context, world, viewport);
  }, [size.height, size.width, viewport, world]);

  const handleCanvasClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    if (buildMode !== 'select') {
      const tile = tileFromCanvasPoint(point, viewport.tileSize, {
        x: viewport.offsetX,
        y: viewport.offsetY,
      });
      if (tile.x >= 0 && tile.y >= 0 && tile.x < world.width && tile.y < world.height) {
        paintTile(tile.x, tile.y, buildMode);
      }
      return;
    }

    const foundAgent = findAgentAtCanvasPoint(
      world,
      point,
      viewport.tileSize,
      { x: viewport.offsetX, y: viewport.offsetY },
    );
    selectAgent(foundAgent?.id);
  };

  return (
    <main className="app-shell">
      <div className="background-glow" />
      <Hud world={world} />
      <section className="content">
        <div className="canvas-frame panel" ref={frameRef}>
          <div className="canvas-header">
            <div>
              <h1>RatRace</h1>
              <p>Deterministic city sim with fixed-step ticks, routing, economy, and congestion.</p>
            </div>
            <span>{paused ? 'Paused' : 'Live'}</span>
          </div>
          <canvas aria-label="RatRace world canvas" ref={canvasRef} onClick={handleCanvasClick} />
        </div>
        <aside className="sidebar">
          <Controls
            paused={paused}
            onPauseToggle={() => setPaused(!paused)}
            onSingleStep={singleStep}
            onReset={reset}
          />
          <BuildMenu mode={buildMode} onChange={setBuildMode} />
          <Inspector world={world} />
        </aside>
      </section>
    </main>
  );
};
