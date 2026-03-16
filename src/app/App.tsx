import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { renderWorld, calculateViewport, DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM } from '../render/canvasRenderer';
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

const zoomIn = (zoom: number) => Math.min(MAX_ZOOM, zoom * 2);
const zoomOut = (zoom: number) => Math.max(MIN_ZOOM, zoom / 2);

export const App = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 960, height: 640 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

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
    const stage = stageRef.current;
    if (!stage) {
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

    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const worldWidth = world.width;
  const worldHeight = world.height;
  const viewport = useMemo(
    () => calculateViewport({ width: worldWidth, height: worldHeight }, size.width, size.height, zoom),
    [size.height, size.width, worldHeight, worldWidth, zoom],
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
        <div className="canvas-frame panel">
          <div className="canvas-header">
            <div>
              <h1>RatRace</h1>
              <p>Deterministic city sim with fixed-step ticks, routing, economy, and congestion.</p>
            </div>
            <span>{paused ? 'Paused' : 'Live'}</span>
          </div>
          <div className="canvas-stage" ref={stageRef}>
            <canvas aria-label="RatRace world canvas" ref={canvasRef} onClick={handleCanvasClick} />
          </div>
        </div>
        <aside className="sidebar">
          <Controls
            paused={paused}
            zoom={zoom}
            canZoomIn={zoom < MAX_ZOOM}
            canZoomOut={zoom > MIN_ZOOM}
            onPauseToggle={() => setPaused(!paused)}
            onSingleStep={singleStep}
            onReset={reset}
            onZoomIn={() => setZoom((currentZoom) => zoomIn(currentZoom))}
            onZoomOut={() => setZoom((currentZoom) => zoomOut(currentZoom))}
            onZoomReset={() => setZoom(DEFAULT_ZOOM)}
          />
          <BuildMenu mode={buildMode} onChange={setBuildMode} />
          <Inspector world={world} />
        </aside>
      </section>
    </main>
  );
};
