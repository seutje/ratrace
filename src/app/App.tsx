import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
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
import { Drawer } from '../ui/Drawer';
import { Hud } from '../ui/Hud';
import { Inspector } from '../ui/Inspector';
import { OverlayMenu } from '../ui/OverlayMenu';
import { getOverlayModeLabel } from '../ui/overlayOptions';
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

type PanOffset = {
  x: number;
  y: number;
};

type CanvasPoint = {
  x: number;
  y: number;
};

type DragState = {
  pointerId: number;
  startPoint: CanvasPoint;
  originPan: PanOffset;
  moved: boolean;
};

const zoomIn = (zoom: number) => Math.min(MAX_ZOOM, zoom * 2);
const zoomOut = (zoom: number) => Math.max(MIN_ZOOM, zoom / 2);
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
const DRAG_THRESHOLD_PX = 4;

export const App = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const staticLayerRef = useRef<HTMLCanvasElement | null>(null);
  const staticLayerKeyRef = useRef('');
  const viewportRef = useRef<ReturnType<typeof calculateViewport> | null>(null);
  const panRef = useRef<PanOffset>({ x: 0, y: 0 });
  const zoomRef = useRef(DEFAULT_ZOOM);
  const dragStateRef = useRef<DragState | null>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 960, height: 640 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState<PanOffset>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const worldWidth = useWorldStore((state) => state.world.width);
  const worldHeight = useWorldStore((state) => state.world.height);
  const paused = useWorldStore((state) => state.paused);
  const buildMode = useWorldStore((state) => state.buildMode);
  const overlayMode = useWorldStore((state) => state.overlayMode);
  const advanceElapsed = useWorldStore((state) => state.advanceElapsed);
  const setPaused = useWorldStore((state) => state.setPaused);
  const singleStep = useWorldStore((state) => state.singleStep);
  const reset = useWorldStore((state) => state.reset);
  const setBuildMode = useWorldStore((state) => state.setBuildMode);
  const setOverlayMode = useWorldStore((state) => state.setOverlayMode);
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
    () => calculateViewport({ width: worldWidth, height: worldHeight }, size.width, size.height, zoom, pan),
    [pan, size.height, size.width, worldHeight, worldWidth, zoom],
  );

  useEffect(() => {
    viewportRef.current = viewport;
    panRef.current = pan;
    zoomRef.current = zoom;
  }, [pan, viewport, zoom]);

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

      renderDynamicWorld(context, world, viewport, overlayMode);
    };

    drawWorld(useWorldStore.getState().world);

    return useWorldStore.subscribe((state, previousState) => {
      if (state.world === previousState.world) {
        return;
      }

      drawWorld(state.world);
    });
  }, [overlayMode, size.height, size.width, viewport]);

  const getCanvasPoint = (
    event: PointerEvent<HTMLCanvasElement> | WheelEvent<HTMLCanvasElement>,
  ): CanvasPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const handleCanvasAction = (point: CanvasPoint) => {
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

  const resetView = () => {
    setZoom(DEFAULT_ZOOM);
    setPan({ x: 0, y: 0 });
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return;
    }

    const point = getCanvasPoint(event);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startPoint: point,
      originPan: panRef.current,
      moved: false,
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const point = getCanvasPoint(event);
    const dx = point.x - dragState.startPoint.x;
    const dy = point.y - dragState.startPoint.y;
    const moved = Math.abs(dx) >= DRAG_THRESHOLD_PX || Math.abs(dy) >= DRAG_THRESHOLD_PX;

    if (moved && !dragState.moved) {
      dragStateRef.current = { ...dragState, moved: true };
    }

    setPan({
      x: dragState.originPan.x + dx,
      y: dragState.originPan.y + dy,
    });
  };

  const handlePointerRelease = (event: PointerEvent<HTMLCanvasElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragStateRef.current = null;
    setIsPanning(false);

    if (!dragState.moved) {
      setPan(dragState.originPan);
      handleCanvasAction(getCanvasPoint(event));
    }
  };

  const handlePointerCancel = (event: PointerEvent<HTMLCanvasElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragStateRef.current = null;
    setIsPanning(false);
    setPan(dragState.originPan);
  };

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();

    const currentViewport = viewportRef.current;
    if (!currentViewport) {
      return;
    }

    const point = getCanvasPoint(event);
    const worldPoint = {
      x: (point.x - currentViewport.offsetX) / currentViewport.tileSize,
      y: (point.y - currentViewport.offsetY) / currentViewport.tileSize,
    };
    const currentZoom = zoomRef.current;
    const nextZoom = clampZoom(currentZoom * Math.exp(-event.deltaY * 0.0015));
    if (nextZoom === currentZoom) {
      return;
    }

    const centeredViewport = calculateViewport({ width: worldWidth, height: worldHeight }, size.width, size.height, nextZoom);
    setZoom(nextZoom);
    setPan({
      x: point.x - worldPoint.x * centeredViewport.tileSize - centeredViewport.offsetX,
      y: point.y - worldPoint.y * centeredViewport.tileSize - centeredViewport.offsetY,
    });
  };

  return (
    <main className="app-shell">
      <div className="background-glow" />
      <div className={`canvas-stage ${isPanning ? 'is-panning' : ''}`} ref={stageRef}>
        <canvas
          aria-label="RatRace world canvas"
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerRelease}
          onPointerCancel={handlePointerCancel}
          onWheel={handleWheel}
        />
      </div>
      <div className="overlay-layer">
        <Drawer
          title="Overview"
          className="drawer-overview"
          summary={<span className="drawer-pill">{paused ? 'Paused' : 'Live'}</span>}
        >
          <div className="drawer-overview-content">
            <div className="drawer-intro">
              <h1>RatRace</h1>
              <p>Drag with the left mouse button to pan. Scroll to zoom the city like a map.</p>
            </div>
            <Hud variant="inline" />
          </div>
        </Drawer>
        <Drawer title="Tools" className="drawer-tools" defaultOpen={false}>
          <div className="drawer-stack">
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
              onZoomReset={resetView}
            />
            <BuildMenu mode={buildMode} onChange={setBuildMode} />
          </div>
        </Drawer>
        <Drawer
          title="Overlays"
          className="drawer-overlays"
          defaultOpen={false}
          summary={<span className="drawer-pill">{getOverlayModeLabel(overlayMode)}</span>}
        >
          <OverlayMenu mode={overlayMode} onChange={setOverlayMode} />
        </Drawer>
        <Drawer title="Inspector" className="drawer-inspector">
          <Inspector />
        </Drawer>
      </div>
    </main>
  );
};
