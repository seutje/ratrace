import { TileType, Point, WorldState } from './types';
import { getTile, tileKey } from './utils';

const directions: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const heuristic = (start: Point, goal: Point) => Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y);

const movementCost = (world: WorldState, point: Point) => {
  const tile = getTile(world, point);
  if (!tile) {
    return Number.POSITIVE_INFINITY;
  }

  return tile.type === TileType.Road ? 0.5 : 1;
};

export const isTraversable = (world: WorldState, point: Point) => {
  const tile = getTile(world, point);
  return Boolean(tile && tile.type !== TileType.Blocked);
};

export const findPath = (world: WorldState, start: Point, goal: Point): Point[] | null => {
  if (!isTraversable(world, start) || !isTraversable(world, goal)) {
    return null;
  }

  if (start.x === goal.x && start.y === goal.y) {
    return [start];
  }

  const openSet = new Set([tileKey(start)]);
  const cameFrom = new Map<string, Point>();
  const gScore = new Map<string, number>([[tileKey(start), 0]]);
  const fScore = new Map<string, number>([[tileKey(start), heuristic(start, goal)]]);
  const points = new Map<string, Point>([[tileKey(start), start]]);

  while (openSet.size > 0) {
    let currentKey = '';
    let currentScore = Number.POSITIVE_INFINITY;

    for (const key of openSet) {
      const score = fScore.get(key) ?? Number.POSITIVE_INFINITY;
      if (score < currentScore) {
        currentScore = score;
        currentKey = key;
      }
    }

    const current = points.get(currentKey);
    if (!current) {
      break;
    }

    if (current.x === goal.x && current.y === goal.y) {
      const path: Point[] = [current];
      let walkKey = currentKey;
      while (cameFrom.has(walkKey)) {
        const parent = cameFrom.get(walkKey)!;
        path.unshift(parent);
        walkKey = tileKey(parent);
      }
      return path;
    }

    openSet.delete(currentKey);

    for (const direction of directions) {
      const neighbor = { x: current.x + direction.x, y: current.y + direction.y };
      const neighborKey = tileKey(neighbor);
      if (!isTraversable(world, neighbor)) {
        continue;
      }

      points.set(neighborKey, neighbor);
      const tentative = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + movementCost(world, neighbor);
      if (tentative >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(neighborKey, current);
      gScore.set(neighborKey, tentative);
      fScore.set(neighborKey, tentative + heuristic(neighbor, goal));
      openSet.add(neighborKey);
    }
  }

  return null;
};
