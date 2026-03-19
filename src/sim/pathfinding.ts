import { TileType, Point, WorldState } from './types';

const ROAD_COST = 0.5;
const DEFAULT_COST = 1;
const BLOCKED_PARENT = -1;
const UNVISITED_PARENT = -2;
// Reverse goal searches scan the whole map, so promoting too early turns
// short commute bursts into long worker stalls. Wait until a destination is
// requested often enough that the up-front cost is likely to pay back.
const GOAL_SEARCH_PROMOTION_THRESHOLD = 12;
const goalSearchCache = new WeakMap<WorldState['tiles'], Map<string, GoalCacheEntry>>();
const pathCache = new WeakMap<WorldState['tiles'], Map<string, Point[] | null>>();

type HeapEntry = {
  index: number;
  score: number;
};

type GoalSearchResult = {
  nextHop: Int32Array;
};

type GoalCacheEntry = {
  requests: number;
  search?: GoalSearchResult;
};

// Scale Manhattan distance by the cheapest possible tile cost so A* stays admissible.
const heuristic = (x: number, y: number, goalX: number, goalY: number) =>
  ROAD_COST * (Math.abs(goalX - x) + Math.abs(goalY - y));

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
    cache = new Map<string, GoalCacheEntry>();
    goalSearchCache.set(world.tiles, cache);
  }

  return cache;
};

const getPathCacheKey = (world: Pick<WorldState, 'metrics'>, start: Point, goal: Point) =>
  `${world.metrics.mapVersion}:${start.x},${start.y}>${goal.x},${goal.y}`;

const getPathCache = (world: WorldState) => {
  let cache = pathCache.get(world.tiles);
  if (!cache) {
    cache = new Map<string, Point[] | null>();
    pathCache.set(world.tiles, cache);
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

const reconstructPath = (world: Pick<WorldState, 'width'>, cameFrom: Int32Array, goalIndex: number) => {
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

const findPathDirect = (world: WorldState, start: Point, goal: Point): Point[] | null => {
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
      return reconstructPath(world, cameFrom, goalIndex);
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

  return null;
};

export const findPath = (world: WorldState, start: Point, goal: Point): Point[] | null => {
  if (!isTraversable(world, start) || !isTraversable(world, goal)) {
    return null;
  }

  if (start.x === goal.x && start.y === goal.y) {
    return [start];
  }

  const pairCache = getPathCache(world);
  const pairCacheKey = getPathCacheKey(world, start, goal);
  const cachedPath = pairCache.get(pairCacheKey);
  if (cachedPath !== undefined) {
    return cachedPath;
  }

  const goalCache = getGoalSearchCache(world);
  const goalCacheKey = getGoalCacheKey(world, goal);
  let goalEntry = goalCache.get(goalCacheKey);
  if (!goalEntry) {
    goalEntry = { requests: 0 };
    goalCache.set(goalCacheKey, goalEntry);
  }

  goalEntry.requests += 1;

  if (!goalEntry.search && goalEntry.requests >= GOAL_SEARCH_PROMOTION_THRESHOLD) {
    goalEntry.search = computeGoalSearch(world, goal);
  }

  if (goalEntry.search) {
    const startIndex = getTileIndex(world, start.x, start.y);
    const path =
      goalEntry.search.nextHop[startIndex] === UNVISITED_PARENT
        ? null
        : reconstructPathFromNextHop(world, goalEntry.search.nextHop, startIndex);
    pairCache.set(pairCacheKey, path);
    return path;
  }

  const path = findPathDirect(world, start, goal);
  pairCache.set(pairCacheKey, path);
  return path;
};
