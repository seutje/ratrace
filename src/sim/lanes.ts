import { Agent, Point, TileType, WorldState } from './types';
import { getTile, pointToTile, tileCenter, tileKey } from './utils';

export type LaneDirection = 'east' | 'west' | 'north' | 'south';

const LANE_OFFSET = 0.25;

export const getLaneDirection = (from: Point, to: Point): LaneDirection | undefined => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dx) + Math.abs(dy) !== 1) {
    return undefined;
  }

  if (dx === 1) {
    return 'east';
  }
  if (dx === -1) {
    return 'west';
  }
  if (dy === 1) {
    return 'south';
  }
  return 'north';
};

export const getRoadLaneCenter = (tile: Point, direction: LaneDirection): Point => {
  switch (direction) {
    case 'east':
      return { x: tile.x + 0.5, y: tile.y + 0.5 + LANE_OFFSET };
    case 'west':
      return { x: tile.x + 0.5, y: tile.y + 0.5 - LANE_OFFSET };
    case 'north':
      return { x: tile.x + 0.5 + LANE_OFFSET, y: tile.y + 0.5 };
    case 'south':
      return { x: tile.x + 0.5 - LANE_OFFSET, y: tile.y + 0.5 };
  }
};

export const getAgentLaneDirection = (agent: Pick<Agent, 'pos' | 'route' | 'routeIndex'>): LaneDirection | undefined => {
  return getAgentLaneDirectionFromTile(agent, getAgentCurrentTile(agent));
};

export const getAgentCurrentTile = (agent: Pick<Agent, 'pos' | 'route' | 'routeIndex'>): Point => {
  if (agent.routeIndex > 0 && agent.routeIndex <= agent.route.length) {
    return agent.route[agent.routeIndex - 1]!;
  }

  if (agent.route.length > 0) {
    return agent.route[agent.route.length - 1]!;
  }

  return pointToTile(agent.pos);
};

export const getAgentLaneDirectionFromTile = (
  agent: Pick<Agent, 'route' | 'routeIndex'>,
  currentTile: Point,
): LaneDirection | undefined => {
  if (agent.routeIndex >= agent.route.length) {
    return undefined;
  }

  return getLaneDirection(currentTile, agent.route[agent.routeIndex]!);
};

export const getAgentTrafficKey = (
  world: Pick<WorldState, 'width' | 'height' | 'tiles'>,
  agent: Pick<Agent, 'pos' | 'route' | 'routeIndex'>,
  currentTile = getAgentCurrentTile(agent),
  currentTileType = getTile(world, currentTile)?.type ?? TileType.Empty,
) => {
  const direction = currentTileType === TileType.Road ? getAgentLaneDirectionFromTile(agent, currentTile) : undefined;
  return direction ? `${tileKey(currentTile)}:${direction}` : tileKey(currentTile);
};

export const getRouteTargetPoint = (
  world: Pick<WorldState, 'width' | 'height' | 'tiles'>,
  agent: Pick<Agent, 'pos' | 'route' | 'routeIndex'>,
  currentTile = getAgentCurrentTile(agent),
) => {
  const targetTile = agent.route[agent.routeIndex];
  if (!targetTile) {
    return agent.pos;
  }

  const targetType = getTile(world, targetTile)?.type ?? TileType.Empty;
  const direction = getLaneDirection(currentTile, targetTile);

  if (targetType !== TileType.Road || !direction) {
    return tileCenter(targetTile);
  }

  return getRoadLaneCenter(targetTile, direction);
};
