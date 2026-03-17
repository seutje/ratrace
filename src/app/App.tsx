import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  calculateViewport,
  DEFAULT_ZOOM,
  getStaticWorldCacheKey,
  MAX_ZOOM,
  MIN_ZOOM,
  renderDynamicWorld,
  renderStaticWorld,
} from '../render/canvasRenderer';
import { useSimulationLoop } from '../render/useSimulationLoop';
import { WorldState } from '../sim/types';
import { BuildMenu } from '../ui/BuildMenu';
import { Controls } from '../ui/Controls';
import { Hud } from '../ui/Hud';
import { Inspector } from '../ui/Inspector';
import {
  findAgentAtCanvasPoint,
  startSimulationWorker,
  stopSimulationWorker,
  tileFromCanvasPoint,
  useWorldStore,
} from './store';

type CanvasSize = {
  width: number;
  height: number;
};

const zoomIn = (zoom: number) => Math.min(MAX_ZOOM, zoom * 2);
const zoomOut = (zoom: number) => Math.max(MIN_ZOOM, zoom / 2);

export const App = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const staticLayerRef = useRef<HTMLCanvasElement | null>(null);
  const staticLayerKeyRef = useRef('');
  const [size, setSize] = useState<CanvasSize>({ width: 960, height: 640 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  const worldWidth = useWorldStore((state) => state.world.width);
  const worldHeight = useWorldStore((state) => state.world.height);
  const paused = useWorldStore((state) => state.paused);
  const buildMode = useWorldStore((state) => state.buildMode);
  const advanceElapsed = useWorldStore((state) => state.advanceElapsed);
  const setPaused = useWorldStore((state) => state.setPaused);
  const singleStep = useWorldStore((state) => state.singleStep);
  const reset = useWorldStore((state) => state.reset);
  const setBuildMode = useWorldStore((state) => state.setBuildMode);
  const selectAgent = useWorldStore((state) => state.selectAgent);
  const paintTile = useWorldStore((state) => state.paintTile);

  useEffect(() => {
    startSimulationWorker();
    return () => stopSimulationWorker();
  }, []);

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

    const drawWorld = (world: WorldState) => {
      const staticLayerKey = getStaticWorldCacheKey(world, viewport);
      if (staticLayerKeyRef.current !== staticLayerKey) {
        staticLayerKeyRef.current = staticLayerKey;
        const layerCanvas = staticLayerRef.current ?? document.createElement('canvas');
        layerCanvas.width = size.width;
        layerCanvas.height = size.height;
        const layerContext = layerCanvas.getContext('2d');
        if (layerContext) {
          renderStaticWorld(layerContext, world, viewport);
          staticLayerRef.current = layerCanvas;
        } else {
          staticLayerRef.current = null;
        }
      }

      if (staticLayerRef.current && typeof context.drawImage === 'function') {
        context.clearRect(0, 0, viewport.width, viewport.height);
        context.drawImage(staticLayerRef.current, 0, 0);
      } else {
        renderStaticWorld(context, world, viewport);
      }

      renderDynamicWorld(context, world, viewport);
    };

    drawWorld(useWorldStore.getState().world);

    return useWorldStore.subscribe((state, previousState) => {
      if (state.world === previousState.world) {
        return;
      }

      drawWorld(state.world);
    });
  }, [size.height, size.width, viewport]);

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
      if (tile.x >= 0 && tile.y >= 0 && tile.x < worldWidth && tile.y < worldHeight) {
        paintTile(tile.x, tile.y, buildMode);
      }
      return;
    }

    const world = useWorldStore.getState().world;
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
      <Hud />
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
          <Inspector />
        </aside>
      </section>
    </main>
  );
};
