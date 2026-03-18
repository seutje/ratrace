import { TileType, Point, WorldState } from './types';

const ROAD_COST = 0.5;
const DEFAULT_COST = 1;
const BLOCKED_PARENT = -1;
const UNVISITED_PARENT = -2;
const goalSearchCache = new WeakMap<WorldState['tiles'], Map<string, GoalSearchResult>>();

type HeapEntry = {
  index: number;
  score: number;
};

type GoalSearchResult = {
  nextHop: Int32Array;
};

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

const getGoalCacheKey = (world: Pick<WorldState, 'metrics'>, goal: Point) =>
  `${world.metrics.mapVersion}:${goal.x},${goal.y}`;

const getGoalSearchCache = (world: WorldState) => {
  let cache = goalSearchCache.get(world.tiles);
  if (!cache) {
    cache = new Map<string, GoalSearchResult>();
    goalSearchCache.set(world.tiles, cache);
  }

  return cache;
};

const reconstructPathFromNextHop = (world: Pick<WorldState, 'width'>, nextHop: Int32Array, startIndex: number) => {
  const path: Point[] = [];
  let currentIndex = startIndex;

  while (currentIndex >= 0) {
    path.push({
      x: currentIndex % world.width,
      y: Math.floor(currentIndex / world.width),
    });
    currentIndex = nextHop[currentIndex] ?? BLOCKED_PARENT;
  }
  return path;
};

const computeGoalSearch = (world: WorldState, goal: Point): GoalSearchResult => {
  const totalTiles = world.width * world.height;
  const goalIndex = getTileIndex(world, goal.x, goal.y);
  const openHeap: HeapEntry[] = [];
  const closed = new Uint8Array(totalTiles);
  const gScore = new Float64Array(totalTiles);
  const nextHop = new Int32Array(totalTiles);

  gScore.fill(Number.POSITIVE_INFINITY);
  nextHop.fill(UNVISITED_PARENT);

  gScore[goalIndex] = 0;
  nextHop[goalIndex] = BLOCKED_PARENT;
  pushHeapEntry(openHeap, { index: goalIndex, score: 0 });

  while (openHeap.length > 0) {
    const entry = popHeapEntry(openHeap);
    if (!entry || entry.score !== gScore[entry.index] || closed[entry.index] === 1) {
      continue;
    }

    closed[entry.index] = 1;
    const x = entry.index % world.width;
    const y = Math.floor(entry.index / world.width);
    const baseScore = gScore[entry.index];
    const reverseStepCost = movementCostByIndex(world, entry.index);

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

      const tentative = baseScore + reverseStepCost;
      if (tentative >= gScore[neighborIndex]) {
        continue;
      }

      gScore[neighborIndex] = tentative;
      nextHop[neighborIndex] = entry.index;
      pushHeapEntry(openHeap, { index: neighborIndex, score: tentative });
    }
  }

  return {
    nextHop,
  };
};

export const findPath = (world: WorldState, start: Point, goal: Point): Point[] | null => {
  if (!isTraversable(world, start) || !isTraversable(world, goal)) {
    return null;
  }

  if (start.x === goal.x && start.y === goal.y) {
    return [start];
  }

  const cache = getGoalSearchCache(world);
  const cacheKey = getGoalCacheKey(world, goal);
  let goalSearch = cache.get(cacheKey);
  if (!goalSearch) {
    goalSearch = computeGoalSearch(world, goal);
    cache.set(cacheKey, goalSearch);
  }

  const startIndex = getTileIndex(world, start.x, start.y);
  if (goalSearch.nextHop[startIndex] === UNVISITED_PARENT) {
    return null;
  }

  return reconstructPathFromNextHop(world, goalSearch.nextHop, startIndex);
};
