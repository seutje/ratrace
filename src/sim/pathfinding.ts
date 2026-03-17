import { TileType, Point, WorldState } from './types';
import { getTile, tileKey } from './utils';

const directions: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
type QueueEntry = {
  key: string;
  score: number;
};

// Scale Manhattan distance by the cheapest possible tile cost so A* stays admissible.
const heuristic = (start: Point, goal: Point) => 0.5 * (Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y));

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

const pushQueueEntry = (queue: QueueEntry[], entry: QueueEntry) => {
  queue.push(entry);
  let index = queue.length - 1;

  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (queue[parentIndex]!.score <= queue[index]!.score) {
      break;
    }

    [queue[parentIndex], queue[index]] = [queue[index]!, queue[parentIndex]!];
    index = parentIndex;
  }
};

const popQueueEntry = (queue: QueueEntry[]) => {
  if (queue.length === 0) {
    return undefined;
  }

  const top = queue[0]!;
  const tail = queue.pop();
  if (queue.length === 0 || !tail) {
    return top;
  }

  queue[0] = tail;
  let index = 0;

  while (true) {
    const leftIndex = index * 2 + 1;
    const rightIndex = leftIndex + 1;
    let smallestIndex = index;

    if (leftIndex < queue.length && queue[leftIndex]!.score < queue[smallestIndex]!.score) {
      smallestIndex = leftIndex;
    }

    if (rightIndex < queue.length && queue[rightIndex]!.score < queue[smallestIndex]!.score) {
      smallestIndex = rightIndex;
    }

    if (smallestIndex === index) {
      return top;
    }

    [queue[index], queue[smallestIndex]] = [queue[smallestIndex]!, queue[index]!];
    index = smallestIndex;
  }
};

export const findPath = (world: WorldState, start: Point, goal: Point): Point[] | null => {
  if (!isTraversable(world, start) || !isTraversable(world, goal)) {
    return null;
  }

  if (start.x === goal.x && start.y === goal.y) {
    return [start];
  }

  const startKey = tileKey(start);
  const startScore = heuristic(start, goal);
  const openSet = new Set([startKey]);
  const openQueue: QueueEntry[] = [{ key: startKey, score: startScore }];
  const cameFrom = new Map<string, Point>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([[startKey, startScore]]);
  const points = new Map<string, Point>([[startKey, start]]);

  while (openQueue.length > 0) {
    const entry = popQueueEntry(openQueue);
    if (!entry) {
      break;
    }

    const currentKey = entry.key;
    const currentScore = fScore.get(currentKey);
    if (currentScore === undefined || entry.score !== currentScore || !openSet.has(currentKey)) {
      continue;
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
    const baseScore = gScore.get(currentKey) ?? Number.POSITIVE_INFINITY;

    for (const direction of directions) {
      const neighbor = { x: current.x + direction.x, y: current.y + direction.y };
      const neighborKey = tileKey(neighbor);
      if (!isTraversable(world, neighbor)) {
        continue;
      }

      points.set(neighborKey, neighbor);
      const tentative = baseScore + movementCost(world, neighbor);
      if (tentative >= (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(neighborKey, current);
      gScore.set(neighborKey, tentative);
      const nextScore = tentative + heuristic(neighbor, goal);
      fScore.set(neighborKey, nextScore);
      openSet.add(neighborKey);
      pushQueueEntry(openQueue, { key: neighborKey, score: nextScore });
    }
  }

  return null;
};
