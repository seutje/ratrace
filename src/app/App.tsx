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
import {
  buildCanvasUiModel,
  findCanvasUiScrollRegionAtPoint,
  findCanvasUiElementAtPoint,
  getDefaultCanvasDrawerState,
  isCanvasUiPoint,
  renderCanvasUi,
  type CanvasDrawerState,
  type CanvasScrollState,
  type CanvasUiAction,
} from '../render/canvasUi';
import { useSimulationLoop } from '../render/useSimulationLoop';
import { BuildMode, OverlayMode, WorldState } from '../sim/types';
import { getTile, isZonedTileType } from '../sim/utils';
import {
  findAgentAtCanvasPoint,
  getRenderInterpolationState,
  startSimulationWorker,
  stopSimulationWorker,
  tileFromCanvasPoint,
  useWorldStore,
} from './store';
import { getAgentRenderPosition, getDefaultZoomForViewport, getPanToCenterWorldPoint } from './camera';
import { msPerTick } from '../sim/constants';

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

type TouchPointState = {
  point: CanvasPoint;
  startedOnUi: boolean;
};

type DragState = {
  kind: 'canvas';
  moved: boolean;
  originPan: PanOffset;
  pointerId: number;
  startPoint: CanvasPoint;
} | {
  kind: 'ui';
  pointerId: number;
  pressedElementId?: string;
};

type PinchState = {
  pointerIds: [number, number];
  startDistance: number;
  startZoom: number;
  worldPoint: CanvasPoint;
};

const zoomIn = (zoom: number) => Math.min(MAX_ZOOM, zoom * 2);
const zoomOut = (zoom: number) => Math.max(MIN_ZOOM, zoom / 2);
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
const DRAG_THRESHOLD_PX = 4;
const MAX_INTERPOLATION_EXTRAPOLATION = 0.18;
const MOBILE_LAYOUT_BREAKPOINT = 720;
const appBackgroundStyle = {
  background:
    'radial-gradient(circle at top left, rgba(232, 180, 94, 0.4), transparent 24%), radial-gradient(circle at bottom right, rgba(63, 109, 161, 0.24), transparent 24%), linear-gradient(180deg, #f8eedb 0%, #e4cda2 100%)',
};

const getPointDistance = (left: CanvasPoint, right: CanvasPoint) => Math.hypot(right.x - left.x, right.y - left.y);

const getPointCenter = (left: CanvasPoint, right: CanvasPoint): CanvasPoint => ({
  x: (left.x + right.x) / 2,
  y: (left.y + right.y) / 2,
});
const appGlowStyle = {
  background:
    'radial-gradient(circle at 12% 18%, rgba(255, 255, 255, 0.42), transparent 22%), radial-gradient(circle at 86% 14%, rgba(255, 216, 154, 0.28), transparent 18%), linear-gradient(180deg, rgba(255, 244, 220, 0.12), rgba(59, 35, 12, 0.08))',
};

export const App = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const staticLayerRef = useRef<HTMLCanvasElement | null>(null);
  const staticLayerKeyRef = useRef('');
  const canvasUiModelRef = useRef<ReturnType<typeof buildCanvasUiModel> | null>(null);
  const viewportRef = useRef<ReturnType<typeof calculateViewport> | null>(null);
  const panRef = useRef<PanOffset>({ x: 0, y: 0 });
  const zoomRef = useRef(DEFAULT_ZOOM);
  const dragStateRef = useRef<DragState | null>(null);
  const pinchStateRef = useRef<PinchState | null>(null);
  const activeTouchPointsRef = useRef(new Map<number, TouchPointState>());
  const followAgentRef = useRef(false);
  const pausedRef = useRef(false);
  const buildModeRef = useRef<BuildMode>('select');
  const overlayModeRef = useRef<OverlayMode>('none');
  const drawerStateRef = useRef<CanvasDrawerState>(getDefaultCanvasDrawerState(0));
  const scrollStateRef = useRef<CanvasScrollState>({ obituary: 0 });
  const cameraPresetAppliedRef = useRef(false);
  const cameraTouchedRef = useRef(false);
  const drawerPresetAppliedRef = useRef(false);
  const drawerTouchedRef = useRef(false);
  const [size, setSize] = useState<CanvasSize>({ width: 960, height: 640 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState<PanOffset>({ x: 0, y: 0 });
  const [followAgent, setFollowAgent] = useState(false);
  const [drawerState, setDrawerState] = useState<CanvasDrawerState>(getDefaultCanvasDrawerState(0));
  const [scrollState, setScrollState] = useState<CanvasScrollState>({ obituary: 0 });
  const mobileLayout = size.width <= MOBILE_LAYOUT_BREAKPOINT;

  const worldWidth = useWorldStore((state) => state.world.width);
  const worldHeight = useWorldStore((state) => state.world.height);
  const selectedAgentId = useWorldStore((state) => state.world.selectedAgentId);
  const obituaryCount = useWorldStore((state) => state.world.obituary.length);
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
  const selectTile = useWorldStore((state) => state.selectTile);
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

  useEffect(() => {
    const nextZoom = getDefaultZoomForViewport({ width: worldWidth, height: worldHeight }, size);
    if (cameraPresetAppliedRef.current && cameraTouchedRef.current) {
      return;
    }

    cameraPresetAppliedRef.current = true;
    setZoom(nextZoom);
    setPan({ x: 0, y: 0 });
  }, [size, worldHeight, worldWidth]);

  useEffect(() => {
    const nextDrawerState = getDefaultCanvasDrawerState(size.width);
    if (drawerPresetAppliedRef.current && drawerTouchedRef.current) {
      return;
    }

    drawerPresetAppliedRef.current = true;
    setDrawerState(nextDrawerState);
  }, [size.width]);

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
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    buildModeRef.current = buildMode;
  }, [buildMode]);

  useEffect(() => {
    overlayModeRef.current = overlayMode;
  }, [overlayMode]);

  useEffect(() => {
    followAgentRef.current = followAgent;
  }, [followAgent]);

  useEffect(() => {
    drawerStateRef.current = drawerState;
  }, [drawerState]);

  useEffect(() => {
    scrollStateRef.current = scrollState;
  }, [scrollState]);

  useEffect(() => {
    if (obituaryCount === 0 && scrollStateRef.current.obituary !== 0) {
      setScrollState({ obituary: 0 });
    }
  }, [obituaryCount]);

  useEffect(() => {
    if (!followAgent) {
      return;
    }

    const world = useWorldStore.getState().world;
    const { previous, current } = getRenderInterpolationState();
    const target = getAgentRenderPosition(world, world.selectedAgentId, {
      alpha: 1,
      currentFrame: current?.frame,
      previousFrame: previous?.frame,
    });

    if (!target) {
      setFollowAgent(false);
      return;
    }

    setPan(getPanToCenterWorldPoint(world, size, zoomRef.current, target));
  }, [followAgent, selectedAgentId, size, zoom]);

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

    let frame = 0;

    const drawWorld = (world: WorldState, frameTime: number) => {
      const { previous, current, currentReceivedAtMs, estimatedIntervalMs } = getRenderInterpolationState();
      const interpolationWindowMs =
        previous && current
          ? Math.max(
              msPerTick,
              (current.tick - previous.tick) * msPerTick,
              estimatedIntervalMs || 0,
            )
          : msPerTick;
      const interpolationAlpha =
        previous && current
          ? Math.max(
              0,
              Math.min(1 + MAX_INTERPOLATION_EXTRAPOLATION, (frameTime - currentReceivedAtMs) / interpolationWindowMs),
            )
          : 1;
      const interpolation = {
        alpha: interpolationAlpha,
        currentFrame: current?.frame,
        previousFrame: previous?.frame,
      };
      const target = followAgentRef.current
        ? getAgentRenderPosition(world, world.selectedAgentId, interpolation)
        : undefined;
      const effectivePan = target ? getPanToCenterWorldPoint(world, size, zoomRef.current, target) : panRef.current;
      const effectiveViewport = target
        ? calculateViewport(
            { width: world.width, height: world.height },
            size.width,
            size.height,
            zoomRef.current,
            effectivePan,
          )
        : viewport;

      if (target) {
        panRef.current = effectivePan;
        viewportRef.current = effectiveViewport;
      }

      const staticLayerKey = getStaticWorldCacheKey(world, effectiveViewport);
      if (staticLayerKeyRef.current !== staticLayerKey) {
        staticLayerKeyRef.current = staticLayerKey;
        const layerCanvas = staticLayerRef.current ?? document.createElement('canvas');
        layerCanvas.width = size.width;
        layerCanvas.height = size.height;
        const layerContext = layerCanvas.getContext('2d');
        if (layerContext) {
          renderStaticWorld(layerContext, world, effectiveViewport);
          staticLayerRef.current = layerCanvas;
        } else {
          staticLayerRef.current = null;
        }
      }

      if (staticLayerRef.current && typeof context.drawImage === 'function') {
        context.clearRect(0, 0, effectiveViewport.width, effectiveViewport.height);
        context.drawImage(staticLayerRef.current, 0, 0);
      } else {
        renderStaticWorld(context, world, effectiveViewport);
      }

      renderDynamicWorld(context, world, effectiveViewport, overlayModeRef.current, interpolation);
      canvasUiModelRef.current = renderCanvasUi(context, {
        buildMode: buildModeRef.current,
        drawers: drawerStateRef.current,
        followActive: followAgentRef.current,
        height: size.height,
        overlayMode: overlayModeRef.current,
        paused: pausedRef.current,
        scrollOffsets: scrollStateRef.current,
        selectedAgentSnapshot: useWorldStore.getState().selectedAgentSnapshot,
        width: size.width,
        world,
        zoom: zoomRef.current,
      });
    };

    const renderFrame = (time: number) => {
      drawWorld(useWorldStore.getState().world, time);
      frame = requestAnimationFrame(renderFrame);
    };

    frame = requestAnimationFrame(renderFrame);

    return () => cancelAnimationFrame(frame);
  }, [size, viewport]);

  const getCanvasPoint = (
    event: PointerEvent<HTMLCanvasElement> | WheelEvent<HTMLCanvasElement>,
  ): CanvasPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const markCameraTouched = () => {
    cameraTouchedRef.current = true;
  };

  const setSecondaryDrawerState = (drawer: Exclude<keyof CanvasDrawerState, 'overview'>) => {
    drawerTouchedRef.current = true;
    setDrawerState((current) => {
      const nextOpen = !current[drawer];
      if (!mobileLayout || !nextOpen) {
        return {
          ...current,
          [drawer]: nextOpen,
        };
      }

      return {
        ...current,
        inspector: false,
        obituary: false,
        overlays: false,
        tools: false,
        [drawer]: true,
      };
    });
  };

  const ensureMobileInspectorOpen = () => {
    if (!mobileLayout) {
      return;
    }

    drawerTouchedRef.current = true;
    setDrawerState((current) => ({
      ...current,
      inspector: true,
      obituary: false,
      overlays: false,
      tools: false,
    }));
  };

  const zoomToCanvasPoint = (nextZoom: number, point: CanvasPoint, worldPoint?: CanvasPoint) => {
    const currentViewport = viewportRef.current;
    if (!currentViewport) {
      return;
    }

    const anchorPoint = worldPoint ?? {
      x: (point.x - currentViewport.offsetX) / currentViewport.tileSize,
      y: (point.y - currentViewport.offsetY) / currentViewport.tileSize,
    };
    const centeredViewport = calculateViewport({ width: worldWidth, height: worldHeight }, size.width, size.height, nextZoom);

    setZoom(nextZoom);
    setPan({
      x: point.x - anchorPoint.x * centeredViewport.tileSize - centeredViewport.offsetX,
      y: point.y - anchorPoint.y * centeredViewport.tileSize - centeredViewport.offsetY,
    });
  };

  const handleCanvasAction = (point: CanvasPoint) => {
    const currentViewport = viewportRef.current;
    if (!currentViewport) {
      return;
    }

    if (buildModeRef.current !== 'select') {
      const tile = tileFromCanvasPoint(point, currentViewport.tileSize, {
        x: currentViewport.offsetX,
        y: currentViewport.offsetY,
      });
      if (tile.x >= 0 && tile.y >= 0 && tile.x < worldWidth && tile.y < worldHeight) {
        paintTile(tile.x, tile.y, buildModeRef.current);
      }
      return;
    }

    const world = useWorldStore.getState().world;
    const currentFrame = getRenderInterpolationState().current?.frame;
    const foundAgent = findAgentAtCanvasPoint(
      world,
      point,
      currentViewport.tileSize,
      { x: currentViewport.offsetX, y: currentViewport.offsetY },
      currentFrame,
    );
    if (foundAgent) {
      selectAgent(foundAgent.id);
      ensureMobileInspectorOpen();
      return;
    }

    const tile = tileFromCanvasPoint(point, currentViewport.tileSize, {
      x: currentViewport.offsetX,
      y: currentViewport.offsetY,
    });
    const selectedTile = getTile(world, tile);
    selectTile(selectedTile && isZonedTileType(selectedTile.type) ? tile : undefined);
    if (selectedTile && isZonedTileType(selectedTile.type)) {
      ensureMobileInspectorOpen();
    }
  };

  const resetView = () => {
    cameraTouchedRef.current = false;
    setZoom(getDefaultZoomForViewport({ width: worldWidth, height: worldHeight }, size));
    setPan({ x: 0, y: 0 });
  };

  const getCanvasUiModel = () =>
    canvasUiModelRef.current ??
    buildCanvasUiModel({
      buildMode: buildModeRef.current,
      drawers: drawerStateRef.current,
      followActive: followAgentRef.current,
      height: size.height,
      overlayMode: overlayModeRef.current,
      paused: pausedRef.current,
      scrollOffsets: scrollStateRef.current,
      selectedAgentSnapshot: useWorldStore.getState().selectedAgentSnapshot,
      width: size.width,
      world: useWorldStore.getState().world,
      zoom: zoomRef.current,
    });

  const handleCanvasUiAction = (action: CanvasUiAction) => {
    switch (action.type) {
      case 'toggleDrawer':
        if (action.drawer === 'overview') {
          drawerTouchedRef.current = true;
          setDrawerState((current) => ({
            ...current,
            overview: !current.overview,
          }));
        } else {
          setSecondaryDrawerState(action.drawer);
        }
        break;
      case 'togglePause':
        setPaused(!pausedRef.current);
        break;
      case 'singleStep':
        singleStep();
        break;
      case 'resetSimulation':
        reset();
        break;
      case 'zoomIn':
        markCameraTouched();
        setZoom((currentZoom) => zoomIn(currentZoom));
        break;
      case 'zoomOut':
        markCameraTouched();
        setZoom((currentZoom) => zoomOut(currentZoom));
        break;
      case 'resetZoom':
        resetView();
        break;
      case 'setBuildMode':
        setBuildMode(action.mode);
        break;
      case 'setOverlayMode':
        setOverlayMode(action.mode);
        break;
      case 'toggleFollow':
        setFollowAgent((currentFollow) => !currentFollow);
        break;
      case 'selectAgent':
        selectAgent(action.agentId);
        ensureMobileInspectorOpen();
        break;
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'touch') {
      event.preventDefault();
    }

    if (event.pointerType !== 'touch' && event.button !== 0) {
      return;
    }

    const point = getCanvasPoint(event);
    const uiModel = getCanvasUiModel();
    const uiElement = findCanvasUiElementAtPoint(uiModel, point);
    const uiPoint = uiElement ?? (isCanvasUiPoint(uiModel, point) ? { id: undefined } : undefined);
    const startedOnUi = Boolean(uiPoint);

    if (event.pointerType === 'touch') {
      activeTouchPointsRef.current.set(event.pointerId, { point, startedOnUi });
      event.currentTarget.setPointerCapture(event.pointerId);

      if (activeTouchPointsRef.current.size === 2) {
        const touchEntries = [...activeTouchPointsRef.current.entries()];
        dragStateRef.current = null;

        if (touchEntries.every(([, touchPoint]) => !touchPoint.startedOnUi)) {
          const [[firstPointerId, firstTouch], [secondPointerId, secondTouch]] = touchEntries as [
            [number, TouchPointState],
            [number, TouchPointState],
          ];
          const startDistance = getPointDistance(firstTouch.point, secondTouch.point);
          const currentViewport = viewportRef.current;

          if (startDistance > 0 && currentViewport) {
            const center = getPointCenter(firstTouch.point, secondTouch.point);
            pinchStateRef.current = {
              pointerIds: [firstPointerId, secondPointerId],
              startDistance,
              startZoom: zoomRef.current,
              worldPoint: {
                x: (center.x - currentViewport.offsetX) / currentViewport.tileSize,
                y: (center.y - currentViewport.offsetY) / currentViewport.tileSize,
              },
            };
          }
        } else {
          pinchStateRef.current = null;
        }
        return;
      }
    }

    if (uiPoint) {
      dragStateRef.current = {
        kind: 'ui',
        pointerId: event.pointerId,
        pressedElementId: uiElement?.id,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    dragStateRef.current = {
      kind: 'canvas',
      moved: false,
      originPan: panRef.current,
      pointerId: event.pointerId,
      startPoint: point,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'touch') {
      event.preventDefault();
      const activeTouchPoint = activeTouchPointsRef.current.get(event.pointerId);
      if (activeTouchPoint) {
        activeTouchPointsRef.current.set(event.pointerId, {
          ...activeTouchPoint,
          point: getCanvasPoint(event),
        });
      }

      const pinchState = pinchStateRef.current;
      if (pinchState && pinchState.pointerIds.includes(event.pointerId)) {
        const [firstPointer, secondPointer] = pinchState.pointerIds
          .map((pointerId) => activeTouchPointsRef.current.get(pointerId)?.point)
          .filter((point): point is CanvasPoint => Boolean(point));
        if (firstPointer && secondPointer) {
          if (followAgentRef.current) {
            followAgentRef.current = false;
            setFollowAgent(false);
          }

          const nextZoom = clampZoom(
            pinchState.startZoom * (getPointDistance(firstPointer, secondPointer) / pinchState.startDistance),
          );
          markCameraTouched();
          zoomToCanvasPoint(nextZoom, getPointCenter(firstPointer, secondPointer), pinchState.worldPoint);
        }
        return;
      }
    }

    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId || dragState.kind !== 'canvas') {
      return;
    }

    const point = getCanvasPoint(event);
    const dx = point.x - dragState.startPoint.x;
    const dy = point.y - dragState.startPoint.y;
    const moved = Math.abs(dx) >= DRAG_THRESHOLD_PX || Math.abs(dy) >= DRAG_THRESHOLD_PX;

    if (moved && !dragState.moved) {
      if (followAgentRef.current) {
        followAgentRef.current = false;
        setFollowAgent(false);
      }
      markCameraTouched();
      dragStateRef.current = { ...dragState, moved: true };
    }

    setPan({
      x: dragState.originPan.x + dx,
      y: dragState.originPan.y + dy,
    });
  };

  const handlePointerRelease = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'touch') {
      event.preventDefault();
      activeTouchPointsRef.current.delete(event.pointerId);
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const pinchState = pinchStateRef.current;
    if (pinchState?.pointerIds.includes(event.pointerId)) {
      pinchStateRef.current = null;
      dragStateRef.current = null;
      return;
    }

    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (dragState.kind === 'ui') {
      dragStateRef.current = null;
      const uiElement = dragState.pressedElementId
        ? findCanvasUiElementAtPoint(getCanvasUiModel(), getCanvasPoint(event))
        : undefined;
      if (uiElement && uiElement.id === dragState.pressedElementId) {
        handleCanvasUiAction(uiElement.action);
      }
      return;
    }

    dragStateRef.current = null;

    if (!dragState.moved) {
      setPan(dragState.originPan);
      handleCanvasAction(getCanvasPoint(event));
    }
  };

  const handlePointerCancel = (event: PointerEvent<HTMLCanvasElement>) => {
    activeTouchPointsRef.current.delete(event.pointerId);
    if (pinchStateRef.current?.pointerIds.includes(event.pointerId)) {
      pinchStateRef.current = null;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    if (dragState.kind === 'canvas') {
      setPan(dragState.originPan);
    }
  };

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();

    const currentViewport = viewportRef.current;
    if (!currentViewport) {
      return;
    }

    const point = getCanvasPoint(event);
    const uiModel = getCanvasUiModel();
    const scrollRegion = findCanvasUiScrollRegionAtPoint(uiModel, point);
    if (scrollRegion) {
      if (scrollRegion.maxOffset > 0) {
        setScrollState((current) => ({
          ...current,
          [scrollRegion.id]: Math.max(0, Math.min(scrollRegion.maxOffset, scrollRegion.offset + event.deltaY)),
        }));
      }
      return;
    }

    if (isCanvasUiPoint(uiModel, point)) {
      return;
    }
    const currentZoom = zoomRef.current;
    const nextZoom = clampZoom(currentZoom * Math.exp(-event.deltaY * 0.0015));
    if (nextZoom === currentZoom) {
      return;
    }

    markCameraTouched();
    zoomToCanvasPoint(nextZoom, point);
  };

  return (
    <main className="relative h-full w-full overflow-hidden" style={appBackgroundStyle}>
      <div className="pointer-events-none absolute inset-0 z-0" style={appGlowStyle} />
      <div className="absolute inset-0 z-[1]" ref={stageRef}>
        <canvas
          aria-label="RatRace world canvas"
          ref={canvasRef}
          className="block h-full w-full touch-none"
          data-follow-active={String(followAgent)}
          data-zoom={zoom.toFixed(3)}
          style={{ touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerRelease}
          onPointerCancel={handlePointerCancel}
          onWheel={handleWheel}
        />
      </div>
    </main>
  );
};
