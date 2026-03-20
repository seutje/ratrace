import { calculateViewport, DEFAULT_ZOOM, MAX_ZOOM } from '../render/canvasRenderer';
import { CompactAgentFrame } from '../sim/simulationWorkerTypes';
import { Point, WorldState } from '../sim/types';

type CanvasSize = {
  width: number;
  height: number;
};

type AgentInterpolation = {
  alpha: number;
  currentFrame?: CompactAgentFrame;
  previousFrame?: CompactAgentFrame;
};

const MOBILE_CAMERA_BREAKPOINT = 720;
const MOBILE_TARGET_TILE_SIZE = 4;

const getFramePosition = (frame: CompactAgentFrame | undefined, index: number, fallback: Point) => ({
  x: frame && index < frame.posX.length ? frame.posX[index]! : fallback.x,
  y: frame && index < frame.posY.length ? frame.posY[index]! : fallback.y,
});

export const getAgentRenderPosition = (
  world: WorldState,
  agentId: string | undefined,
  interpolation?: AgentInterpolation,
): Point | undefined => {
  if (!agentId) {
    return undefined;
  }

  const agentIndex = world.entities.agents.findIndex((agent) => agent.id === agentId);
  if (agentIndex < 0) {
    return undefined;
  }

  const agent = world.entities.agents[agentIndex]!;
  const currentPosition = getFramePosition(interpolation?.currentFrame, agentIndex, agent.pos);
  const previousPosition = getFramePosition(interpolation?.previousFrame, agentIndex, currentPosition);

  if (!interpolation?.previousFrame || !interpolation.currentFrame) {
    return currentPosition;
  }

  return {
    x: previousPosition.x + (currentPosition.x - previousPosition.x) * interpolation.alpha,
    y: previousPosition.y + (currentPosition.y - previousPosition.y) * interpolation.alpha,
  };
};

export const getPanToCenterWorldPoint = (
  world: Pick<WorldState, 'width' | 'height'>,
  size: CanvasSize,
  zoom: number,
  point: Point,
) => {
  const centeredViewport = calculateViewport(world, size.width, size.height, zoom);

  return {
    x: size.width / 2 - point.x * centeredViewport.tileSize - centeredViewport.offsetX,
    y: size.height / 2 - point.y * centeredViewport.tileSize - centeredViewport.offsetY,
  };
};

export const getDefaultZoomForViewport = (
  world: Pick<WorldState, 'width' | 'height'>,
  size: CanvasSize,
) => {
  if (size.width <= 0 || size.height <= 0 || size.width > MOBILE_CAMERA_BREAKPOINT) {
    return DEFAULT_ZOOM;
  }

  const fittedTileSize = Math.max(1, Math.floor(Math.min(size.width / world.width, size.height / world.height)));
  return Math.min(MAX_ZOOM, Math.max(DEFAULT_ZOOM, MOBILE_TARGET_TILE_SIZE / fittedTileSize));
};
