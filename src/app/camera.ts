import { calculateViewport } from '../render/canvasRenderer';
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
