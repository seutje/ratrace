import { MIN_SPEED_FACTOR, ROAD_CAPACITY } from './constants';

export const getCongestionSpeedFactor = (occupancy: number, capacity = ROAD_CAPACITY) => {
  return Math.max(MIN_SPEED_FACTOR, 1 - occupancy / capacity);
};
