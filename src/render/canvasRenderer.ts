import { AgentState, BuildingKind, OverlayMode, TileType, WorldState } from '../sim/types';
import { agentStateOrder, CompactAgentFrame } from '../sim/simulationWorkerTypes';
import { getTile } from '../sim/utils';

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

const agentPaletteByCode = agentStateOrder.map((state) => agentPalette[state]);

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

const getFrameValue = (values: Float32Array | Uint8Array | undefined, index: number, fallback: number) =>
  values && index < values.length ? values[index]! : fallback;

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
  currentFrame?: CompactAgentFrame,
) => {
  for (const [index, agent] of world.entities.agents.entries()) {
    const hunger = getFrameValue(currentFrame?.hungerValues, index, agent.stats.hunger);
    const energy = getFrameValue(currentFrame?.energyValues, index, agent.stats.energy);
    const posX = getFrameValue(currentFrame?.posX, index, agent.pos.x);
    const posY = getFrameValue(currentFrame?.posY, index, agent.pos.y);
    const severity = mode === 'hunger' ? clamp01(hunger / 100) : clamp01((100 - energy) / 100);
    if (severity <= 0.15) {
      continue;
    }

    const x = viewport.offsetX + posX * viewport.tileSize;
    const y = viewport.offsetY + posY * viewport.tileSize;

    ctx.beginPath();
    ctx.arc(x, y, viewport.tileSize * (0.22 + severity * 0.34), 0, Math.PI * 2);
    ctx.fillStyle =
      mode === 'hunger'
        ? getOverlayFill(10, 88, 54, 0.08 + severity * 0.32)
        : getOverlayFill(214, 74, 48, 0.08 + severity * 0.26);
    ctx.fill();
  }
};

const walletLabelWidth = (label: string) => Math.max(44, Math.ceil(label.length * 7.2) + 16);

const renderWalletOverlay = (
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  viewport: Viewport,
  currentFrame?: CompactAgentFrame,
) => {
  if (world.entities.agents.length === 0) {
    return;
  }

  const getWalletValue = (index: number) =>
    getFrameValue(currentFrame?.walletValues, index, world.entities.agents[index]!.wallet);
  const maxWallet = Math.max(1, ...world.entities.agents.map((_agent, index) => getWalletValue(index)));
  const rankedAgentIndices = world.entities.agents
    .map((_agent, index) => index)
    .sort((left, right) => {
      const walletDelta = getWalletValue(right) - getWalletValue(left);
      if (walletDelta !== 0) {
        return walletDelta;
      }

      return world.entities.agents[left]!.name.localeCompare(world.entities.agents[right]!.name);
    })
    .slice(0, 5);
  const leaderIndices = new Set(rankedAgentIndices);

  for (const [index, agent] of world.entities.agents.entries()) {
    const wealthRatio = clamp01(getWalletValue(index) / maxWallet);
    if (wealthRatio <= 0.05) {
      continue;
    }

    const posX = getFrameValue(currentFrame?.posX, index, agent.pos.x);
    const posY = getFrameValue(currentFrame?.posY, index, agent.pos.y);
    const x = viewport.offsetX + posX * viewport.tileSize;
    const y = viewport.offsetY + posY * viewport.tileSize;
    const isLeader = leaderIndices.has(index);

    ctx.beginPath();
    ctx.arc(x, y, viewport.tileSize * (0.24 + wealthRatio * 0.42), 0, Math.PI * 2);
    ctx.fillStyle = getOverlayFill(43, 90, 52, 0.08 + wealthRatio * (isLeader ? 0.48 : 0.3));
    ctx.fill();

    if (!isLeader) {
      continue;
    }

    ctx.beginPath();
    ctx.arc(x, y, viewport.tileSize * (0.31 + wealthRatio * 0.3), 0, Math.PI * 2);
    ctx.strokeStyle = getOverlayFill(28, 88, 34, 0.42 + wealthRatio * 0.4);
    ctx.lineWidth = Math.max(1.5, viewport.tileSize * 0.09);
    ctx.stroke();
  }

  ctx.font = "600 12px ui-monospace, 'SFMono-Regular', monospace";
  for (const [rank, index] of rankedAgentIndices.entries()) {
    const agent = world.entities.agents[index]!;
    const posX = getFrameValue(currentFrame?.posX, index, agent.pos.x);
    const posY = getFrameValue(currentFrame?.posY, index, agent.pos.y);
    const x = viewport.offsetX + posX * viewport.tileSize;
    const y = viewport.offsetY + posY * viewport.tileSize;
    const label = `${rank + 1}. ${agent.name} $${Math.round(getWalletValue(index))}`;
    const width = walletLabelWidth(label);
    const labelX = Math.round(x - width / 2);
    const labelY = Math.round(y - viewport.tileSize * 0.95 - rank * 2);

    ctx.fillStyle = 'rgba(58, 37, 10, 0.84)';
    ctx.fillRect(labelX, labelY - 14, width, 18);
    ctx.strokeStyle = 'rgba(255, 222, 145, 0.78)';
    ctx.lineWidth = 1;
    ctx.strokeRect(labelX, labelY - 14, width, 18);
    ctx.fillStyle = '#fff6d8';
    ctx.fillText(label, labelX + 8, labelY);
  }
};

const renderOverlay = (
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  viewport: Viewport,
  overlayMode: OverlayMode,
  currentFrame?: CompactAgentFrame,
) => {
  switch (overlayMode) {
    case 'traffic':
      renderTrafficOverlay(ctx, world, viewport);
      break;
    case 'hunger':
    case 'energy':
      renderAgentStatOverlay(ctx, world, viewport, overlayMode, currentFrame);
      break;
    case 'wallet':
      renderWalletOverlay(ctx, world, viewport, currentFrame);
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
    currentFrame?: CompactAgentFrame;
    previousFrame?: CompactAgentFrame;
  },
) => {
  ctx.lineWidth = 1;

  const currentFrame = interpolation?.currentFrame;
  const previousFrame = interpolation?.previousFrame;
  renderOverlay(ctx, world, viewport, overlayMode, currentFrame);

  if (world.selectedTile) {
    const selectedTile = getTile(world, world.selectedTile);
    if (selectedTile) {
      const pixel = tileToPixel(selectedTile.x, selectedTile.y, viewport);
      const inset = Math.max(1, Math.floor(viewport.tileSize * 0.08));
      const size = Math.max(1, viewport.tileSize - inset * 2);
      ctx.strokeStyle = 'rgba(255, 253, 246, 0.98)';
      ctx.lineWidth = Math.max(2, Math.floor(viewport.tileSize * 0.1));
      ctx.strokeRect(pixel.x + inset, pixel.y + inset, size, size);
      ctx.strokeStyle = 'rgba(40, 26, 17, 0.72)';
      ctx.lineWidth = 1;
      ctx.strokeRect(pixel.x + inset + 1, pixel.y + inset + 1, Math.max(1, size - 2), Math.max(1, size - 2));
    }
  }

  for (const [index, agent] of world.entities.agents.entries()) {
    const canInterpolate =
      Boolean(currentFrame && previousFrame && index < currentFrame.posX.length && index < previousFrame.posX.length);
    const interpolationAlpha = interpolation?.alpha ?? 1;
    const posX = canInterpolate
      ? previousFrame!.posX[index]! + (currentFrame!.posX[index]! - previousFrame!.posX[index]!) * interpolationAlpha
      : agent.pos.x;
    const posY = canInterpolate
      ? previousFrame!.posY[index]! + (currentFrame!.posY[index]! - previousFrame!.posY[index]!) * interpolationAlpha
      : agent.pos.y;
    const x = viewport.offsetX + posX * viewport.tileSize;
    const y = viewport.offsetY + posY * viewport.tileSize;

    ctx.beginPath();
    ctx.arc(x, y, viewport.tileSize * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = currentFrame ? agentPaletteByCode[currentFrame.stateCodes[index]!] ?? agentPalette[agent.state] : agentPalette[agent.state];
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
