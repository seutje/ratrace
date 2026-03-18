import { AgentState, BuildingKind, OverlayMode, TileType, WorldState } from '../sim/types';
import { DynamicAgentSnapshot } from '../sim/simulationWorkerTypes';

export type Viewport = {
  tileSize: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

type PanOffset = {
  x: number;
  y: number;
};

export const DEFAULT_ZOOM = 1;
export const MIN_ZOOM = 0.125;
export const MAX_ZOOM = 4;

const tilePalette: Record<TileType, string> = {
  [TileType.Empty]: '#efe4cb',
  [TileType.Road]: '#53524f',
  [TileType.Residential]: '#6f9b6f',
  [TileType.Commercial]: '#4f7fb5',
  [TileType.Industrial]: '#d0a74e',
  [TileType.Blocked]: '#29231d',
};

const agentPalette: Record<AgentState, string> = {
  [AgentState.Idle]: '#2a3127',
  [AgentState.MovingToWork]: '#b55c2f',
  [AgentState.Working]: '#9b3d1f',
  [AgentState.MovingHome]: '#1d6f66',
  [AgentState.Sleeping]: '#344a72',
  [AgentState.MovingToShop]: '#5b4fa6',
  [AgentState.Shopping]: '#0e615f',
  [AgentState.Wandering]: '#694d2c',
};

export const calculateViewport = (
  world: Pick<WorldState, 'width' | 'height'>,
  width: number,
  height: number,
  zoom = 1,
  pan: PanOffset = { x: 0, y: 0 },
): Viewport => {
  const fittedTileSize = Math.max(1, Math.floor(Math.min(width / world.width, height / world.height)));
  const tileSize = Math.max(1, Math.floor(fittedTileSize * zoom));
  const usedWidth = tileSize * world.width;
  const usedHeight = tileSize * world.height;

  return {
    tileSize,
    offsetX: Math.floor((width - usedWidth) / 2 + pan.x),
    offsetY: Math.floor((height - usedHeight) / 2 + pan.y),
    width,
    height,
  };
};

export const tileToPixel = (x: number, y: number, viewport: Viewport) => ({
  x: viewport.offsetX + x * viewport.tileSize,
  y: viewport.offsetY + y * viewport.tileSize,
});

export const getStaticWorldCacheKey = (
  world: Pick<WorldState, 'metrics'>,
  viewport: Pick<Viewport, 'width' | 'height' | 'tileSize' | 'offsetX' | 'offsetY'>,
) =>
  [
    world.metrics.mapVersion,
    viewport.width,
    viewport.height,
    viewport.tileSize,
    viewport.offsetX,
    viewport.offsetY,
  ].join(':');

export const renderStaticWorld = (ctx: CanvasRenderingContext2D, world: WorldState, viewport: Viewport) => {
  ctx.clearRect(0, 0, viewport.width, viewport.height);

  const sky = ctx.createLinearGradient(0, 0, 0, viewport.height);
  sky.addColorStop(0, '#f8f0dc');
  sky.addColorStop(1, '#ead4a8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  for (const tile of world.tiles) {
    const pixel = tileToPixel(tile.x, tile.y, viewport);
    ctx.fillStyle = tilePalette[tile.type];
    ctx.fillRect(pixel.x, pixel.y, viewport.tileSize, viewport.tileSize);
    ctx.strokeStyle = 'rgba(37, 28, 19, 0.15)';
    ctx.strokeRect(pixel.x, pixel.y, viewport.tileSize, viewport.tileSize);
  }

  for (const building of world.entities.buildings) {
    const pixel = tileToPixel(building.tile.x, building.tile.y, viewport);
    ctx.fillStyle = 'rgba(33, 24, 16, 0.2)';
    ctx.fillRect(
      pixel.x + viewport.tileSize * 0.15,
      pixel.y + viewport.tileSize * 0.15,
      viewport.tileSize * 0.7,
      viewport.tileSize * 0.7,
    );
  }
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const getOverlayFill = (hue: number, saturation: number, lightness: number, alpha: number) =>
  `hsla(${hue} ${saturation}% ${lightness}% / ${clamp01(alpha)})`;

const drawTileOverlay = (
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  tile: { x: number; y: number },
  fillStyle: string,
) => {
  const pixel = tileToPixel(tile.x, tile.y, viewport);
  const inset = Math.max(1, viewport.tileSize * 0.08);

  ctx.fillStyle = fillStyle;
  ctx.fillRect(
    pixel.x + inset,
    pixel.y + inset,
    Math.max(1, viewport.tileSize - inset * 2),
    Math.max(1, viewport.tileSize - inset * 2),
  );
};

const renderTrafficOverlay = (ctx: CanvasRenderingContext2D, world: WorldState, viewport: Viewport) => {
  const trafficByTile = new Map<string, { x: number; y: number; count: number }>();

  for (const [key, count] of Object.entries(world.traffic)) {
    const [tile] = key.split(':');
    if (!tile) {
      continue;
    }

    const [xText, yText] = tile.split(',');
    const x = Number(xText);
    const y = Number(yText);
    if (Number.isNaN(x) || Number.isNaN(y)) {
      continue;
    }

    const traffic = trafficByTile.get(tile);
    if (traffic) {
      traffic.count += count;
      continue;
    }

    trafficByTile.set(tile, { x, y, count });
  }

  const peak = Math.max(1, world.metrics.trafficPeak);
  for (const traffic of trafficByTile.values()) {
    const intensity = traffic.count / peak;
    drawTileOverlay(ctx, viewport, traffic, getOverlayFill(14, 86, 54, 0.2 + intensity * 0.55));
  }
};

const renderHousingOverlay = (ctx: CanvasRenderingContext2D, world: WorldState, viewport: Viewport) => {
  const occupancy = new Map<string, number>();
  for (const agent of world.entities.agents) {
    occupancy.set(agent.homeId, (occupancy.get(agent.homeId) ?? 0) + 1);
  }

  for (const building of world.entities.buildings) {
    if (building.kind !== BuildingKind.Residential) {
      continue;
    }

    const filledRatio = building.capacity > 0 ? (occupancy.get(building.id) ?? 0) / building.capacity : 0;
    const hue = 110 - clamp01(filledRatio) * 110;
    drawTileOverlay(ctx, viewport, building.tile, getOverlayFill(hue, 58, 54, 0.22 + filledRatio * 0.5));
  }
};

const renderBusinessCashOverlay = (ctx: CanvasRenderingContext2D, world: WorldState, viewport: Viewport) => {
  const cashLevels = world.entities.buildings
    .filter((building) => building.kind === BuildingKind.Commercial || building.kind === BuildingKind.Industrial)
    .map((building) => building.cash);
  const maxCash = Math.max(1, ...cashLevels);

  for (const building of world.entities.buildings) {
    if (building.kind !== BuildingKind.Commercial && building.kind !== BuildingKind.Industrial) {
      continue;
    }

    const cashRatio = clamp01(building.cash / maxCash);
    const hue = cashRatio * 120;
    drawTileOverlay(ctx, viewport, building.tile, getOverlayFill(hue, 62, 46, 0.26 + (1 - cashRatio) * 0.28));
  }
};

const renderRetailStockOverlay = (ctx: CanvasRenderingContext2D, world: WorldState, viewport: Viewport) => {
  for (const building of world.entities.buildings) {
    if (building.kind !== BuildingKind.Commercial) {
      continue;
    }

    const stockRatio = building.capacity > 0 ? clamp01(building.stock / building.capacity) : 0;
    const hue = stockRatio * 120;
    drawTileOverlay(ctx, viewport, building.tile, getOverlayFill(hue, 72, 48, 0.2 + (1 - stockRatio) * 0.42));
  }
};

const renderAgentStatOverlay = (
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  viewport: Viewport,
  mode: Extract<OverlayMode, 'hunger' | 'energy'>,
) => {
  for (const agent of world.entities.agents) {
    const severity = mode === 'hunger' ? clamp01(agent.stats.hunger / 100) : clamp01((100 - agent.stats.energy) / 100);
    if (severity <= 0.15) {
      continue;
    }

    const x = viewport.offsetX + agent.pos.x * viewport.tileSize;
    const y = viewport.offsetY + agent.pos.y * viewport.tileSize;

    ctx.beginPath();
    ctx.arc(x, y, viewport.tileSize * (0.22 + severity * 0.34), 0, Math.PI * 2);
    ctx.fillStyle =
      mode === 'hunger'
        ? getOverlayFill(10, 88, 54, 0.08 + severity * 0.32)
        : getOverlayFill(214, 74, 48, 0.08 + severity * 0.26);
    ctx.fill();
  }
};

const renderOverlay = (ctx: CanvasRenderingContext2D, world: WorldState, viewport: Viewport, overlayMode: OverlayMode) => {
  switch (overlayMode) {
    case 'traffic':
      renderTrafficOverlay(ctx, world, viewport);
      break;
    case 'hunger':
    case 'energy':
      renderAgentStatOverlay(ctx, world, viewport, overlayMode);
      break;
    case 'housing':
      renderHousingOverlay(ctx, world, viewport);
      break;
    case 'businessCash':
      renderBusinessCashOverlay(ctx, world, viewport);
      break;
    case 'retailStock':
      renderRetailStockOverlay(ctx, world, viewport);
      break;
    case 'none':
      break;
  }
};

export const renderDynamicWorld = (
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  viewport: Viewport,
  overlayMode: OverlayMode = 'none',
  interpolation?: {
    alpha: number;
    previousAgents?: DynamicAgentSnapshot[];
  },
) => {
  ctx.lineWidth = 1;

  renderOverlay(ctx, world, viewport, overlayMode);

  for (const [index, agent] of world.entities.agents.entries()) {
    const previousAgent = interpolation?.previousAgents?.[index];
    const canInterpolate = previousAgent?.id === agent.id;
    const interpolationAlpha = interpolation?.alpha ?? 1;
    const posX = canInterpolate
      ? previousAgent.pos.x + (agent.pos.x - previousAgent.pos.x) * interpolationAlpha
      : agent.pos.x;
    const posY = canInterpolate
      ? previousAgent.pos.y + (agent.pos.y - previousAgent.pos.y) * interpolationAlpha
      : agent.pos.y;
    const x = viewport.offsetX + posX * viewport.tileSize;
    const y = viewport.offsetY + posY * viewport.tileSize;

    ctx.beginPath();
    ctx.arc(x, y, viewport.tileSize * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = agentPalette[agent.state];
    ctx.fill();

    if (agent.id === world.selectedAgentId) {
      ctx.strokeStyle = '#fffdf6';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  ctx.fillStyle = 'rgba(33, 24, 16, 0.8)';
  ctx.font = "600 14px ui-monospace, 'SFMono-Regular', monospace";
  ctx.fillText(`Traffic peak ${world.metrics.trafficPeak}`, 20, viewport.height - 20);
};
