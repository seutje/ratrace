import { TileType, Point, WorldState } from './types';

const ROAD_COST = 0.5;
const DEFAULT_COST = 1;
const BLOCKED_PARENT = -1;
const UNVISITED_PARENT = -2;
const pathCache = new WeakMap<WorldState['tiles'], Map<string, Point[] | null>>();

type HeapEntry = {
  index: number;
  score: number;
};

// Scale Manhattan distance by the cheapest possible tile cost so A* stays admissible.
const heuristic = (x: number, y: number, goalX: number, goalY: number) => ROAD_COST * (Math.abs(goalX - x) + Math.abs(goalY - y));

const getTileIndex = (world: Pick<WorldState, 'width'>, x: number, y: number) => y * world.width + x;

const isInsideWorld = (world: Pick<WorldState, 'width' | 'height'>, x: number, y: number) =>
  x >= 0 && y >= 0 && x < world.width && y < world.height;

const isTraversableIndex = (world: Pick<WorldState, 'tiles'>, index: number) => world.tiles[index]?.type !== TileType.Blocked;

const movementCostByIndex = (world: Pick<WorldState, 'tiles'>, index: number) =>
  world.tiles[index]?.type === TileType.Road ? ROAD_COST : DEFAULT_COST;

export const isTraversable = (world: WorldState, point: Point) =>
  isInsideWorld(world, point.x, point.y) && isTraversableIndex(world, getTileIndex(world, point.x, point.y));

const pushHeapEntry = (heap: HeapEntry[], entry: HeapEntry) => {
  heap.push(entry);
  let index = heap.length - 1;

  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (heap[parentIndex]!.score <= heap[index]!.score) {
      break;
    }

    [heap[parentIndex], heap[index]] = [heap[index]!, heap[parentIndex]!];
    index = parentIndex;
  }
};

const popHeapEntry = (heap: HeapEntry[]) => {
  if (heap.length === 0) {
    return undefined;
  }

  const top = heap[0]!;
  const tail = heap.pop();
  if (heap.length === 0 || !tail) {
    return top;
  }

  heap[0] = tail;
  let index = 0;

  while (true) {
    const leftIndex = index * 2 + 1;
    const rightIndex = leftIndex + 1;
    let smallestIndex = index;

    if (leftIndex < heap.length && heap[leftIndex]!.score < heap[smallestIndex]!.score) {
      smallestIndex = leftIndex;
    }

    if (rightIndex < heap.length && heap[rightIndex]!.score < heap[smallestIndex]!.score) {
      smallestIndex = rightIndex;
    }

    if (smallestIndex === index) {
      return top;
    }

    [heap[index], heap[smallestIndex]] = [heap[smallestIndex]!, heap[index]!];
    index = smallestIndex;
  }
};

const getCacheKey = (world: Pick<WorldState, 'metrics'>, start: Point, goal: Point) =>
  `${world.metrics.mapVersion}:${start.x},${start.y}>${goal.x},${goal.y}`;

const getPathCache = (world: WorldState) => {
  let cache = pathCache.get(world.tiles);
  if (!cache) {
    cache = new Map<string, Point[] | null>();
    pathCache.set(world.tiles, cache);
  }

  return cache;
};

const reconstructPath = (
  world: Pick<WorldState, 'width'>,
  cameFrom: Int32Array,
  goalIndex: number,
) => {
  const path: Point[] = [];
  let currentIndex = goalIndex;

  while (currentIndex >= 0) {
    path.push({
      x: currentIndex % world.width,
      y: Math.floor(currentIndex / world.width),
    });
    currentIndex = cameFrom[currentIndex] ?? BLOCKED_PARENT;
  }

  path.reverse();
  return path;
};

export const findPath = (world: WorldState, start: Point, goal: Point): Point[] | null => {
  if (!isTraversable(world, start) || !isTraversable(world, goal)) {
    return null;
  }

  if (start.x === goal.x && start.y === goal.y) {
    return [start];
  }

  const cache = getPathCache(world);
  const cacheKey = getCacheKey(world, start, goal);
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const totalTiles = world.width * world.height;
  const startIndex = getTileIndex(world, start.x, start.y);
  const goalIndex = getTileIndex(world, goal.x, goal.y);
  const openHeap: HeapEntry[] = [];
  const closed = new Uint8Array(totalTiles);
  const gScore = new Float64Array(totalTiles);
  const fScore = new Float64Array(totalTiles);
  const cameFrom = new Int32Array(totalTiles);

  gScore.fill(Number.POSITIVE_INFINITY);
  fScore.fill(Number.POSITIVE_INFINITY);
  cameFrom.fill(UNVISITED_PARENT);

  const startScore = heuristic(start.x, start.y, goal.x, goal.y);
  gScore[startIndex] = 0;
  fScore[startIndex] = startScore;
  cameFrom[startIndex] = BLOCKED_PARENT;
  pushHeapEntry(openHeap, { index: startIndex, score: startScore });

  while (openHeap.length > 0) {
    const entry = popHeapEntry(openHeap);
    if (!entry || entry.score !== fScore[entry.index] || closed[entry.index] === 1) {
      continue;
    }

    if (entry.index === goalIndex) {
      const path = reconstructPath(world, cameFrom, goalIndex);
      cache.set(cacheKey, path);
      return path;
    }

    closed[entry.index] = 1;
    const x = entry.index % world.width;
    const y = Math.floor(entry.index / world.width);
    const baseScore = gScore[entry.index];

    const neighbors = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];

    for (const [neighborX, neighborY] of neighbors) {
      if (!isInsideWorld(world, neighborX, neighborY)) {
        continue;
      }

      const neighborIndex = getTileIndex(world, neighborX, neighborY);
      if (closed[neighborIndex] === 1 || !isTraversableIndex(world, neighborIndex)) {
        continue;
      }

      const tentative = baseScore + movementCostByIndex(world, neighborIndex);
      if (tentative >= gScore[neighborIndex]) {
        continue;
      }

      cameFrom[neighborIndex] = entry.index;
      gScore[neighborIndex] = tentative;
      const nextScore = tentative + heuristic(neighborX, neighborY, goal.x, goal.y);
      fScore[neighborIndex] = nextScore;
      pushHeapEntry(openHeap, { index: neighborIndex, score: nextScore });
    }
  }

  cache.set(cacheKey, null);
  return null;
};
