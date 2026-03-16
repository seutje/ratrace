import { dayMinutes } from './constants';
import { Point, Tile, WorldState } from './types';

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const tileKey = (point: Point) => `${point.x},${point.y}`;

export const getTileIndex = (world: Pick<WorldState, 'width'>, point: Point) => point.y * world.width + point.x;

export const getTile = (world: Pick<WorldState, 'width' | 'height' | 'tiles'>, point: Point): Tile | undefined => {
  if (point.x < 0 || point.y < 0 || point.x >= world.width || point.y >= world.height) {
    return undefined;
  }

  return world.tiles[getTileIndex(world, point)];
};

export const setTile = (world: WorldState, point: Point, tile: Tile) => {
  world.tiles[getTileIndex(world, point)] = tile;
};

export const tileCenter = (point: Point) => ({
  x: point.x + 0.5,
  y: point.y + 0.5,
});

export const pointToTile = (point: Point): Point => ({
  x: Math.floor(point.x),
  y: Math.floor(point.y),
});

export const samePoint = (left?: Point, right?: Point) =>
  Boolean(left && right && left.x === right.x && left.y === right.y);

export const isSameTile = (left: Point, right: Point) => left.x === right.x && left.y === right.y;

export const formatClock = (minutesOfDay: number) => {
  const hours = Math.floor(minutesOfDay / 60);
  const minutes = minutesOfDay % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

export const toClockNumber = (minutesOfDay: number) => {
  const hours = Math.floor(minutesOfDay / 60);
  const minutes = minutesOfDay % 60;
  return hours * 100 + minutes;
};

export const wrapMinutes = (minutes: number) => ((minutes % dayMinutes) + dayMinutes) % dayMinutes;

export const distance = (left: Point, right: Point) => Math.hypot(right.x - left.x, right.y - left.y);
