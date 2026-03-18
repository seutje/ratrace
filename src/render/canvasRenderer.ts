import { AgentState, TileType, WorldState } from '../sim/types';

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

export const renderDynamicWorld = (ctx: CanvasRenderingContext2D, world: WorldState, viewport: Viewport) => {
  ctx.lineWidth = 1;

  for (const agent of world.entities.agents) {
    const x = viewport.offsetX + agent.pos.x * viewport.tileSize;
    const y = viewport.offsetY + agent.pos.y * viewport.tileSize;

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
