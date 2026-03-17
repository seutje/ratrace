import { createRng, Rng } from './random';
import { BuildingKind, Point, WorldState } from './types';

const firstNames = ['Ari', 'Bea', 'Cleo', 'Dax', 'Etta', 'Faye', 'Gus', 'Ivo', 'Juno', 'Kip', 'Lena', 'Miro'];
const lastNames = ['Ash', 'Bell', 'Cinder', 'Dune', 'Elm', 'Flint', 'Grove', 'Hale', 'Irons', 'Jett', 'Keene', 'Lark'];
const districts = ['North', 'South', 'East', 'West', 'Central'] as const;
const residentialLabels = ['Court', 'House', 'Heights', 'Terrace', 'Square', 'Row'];
const commercialLabels = ['Market', 'Corner', 'Arcade', 'Exchange', 'Mart', 'Bazaar'];
const industrialLabels = ['Works', 'Yard', 'Foundry', 'Depot', 'Mill', 'Plant'];
const buildingKindSalt: Record<BuildingKind, number> = {
  [BuildingKind.Residential]: 0x45d9f3b,
  [BuildingKind.Commercial]: 0x119de1f3,
  [BuildingKind.Industrial]: 0x344b5409,
};

const mixSeed = (seed: number, ...parts: number[]) => {
  let value = seed >>> 0;

  for (const part of parts) {
    value = Math.imul(value ^ (part >>> 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  }

  return value;
};

const pick = <Value>(values: Value[], rng: Rng) => values[Math.floor(rng() * values.length)]!;

export const createBuildingLabel = (seed: number, rng: Rng, kind: BuildingKind, index: number) => {
  const district = districts[(seed + index) % districts.length]!;
  const serial = Math.floor(rng() * 90) + 10;

  if (kind === BuildingKind.Residential) {
    return `${district} ${residentialLabels[index % residentialLabels.length]} ${serial}`;
  }
  if (kind === BuildingKind.Commercial) {
    return `${district} ${commercialLabels[index % commercialLabels.length]} ${serial}`;
  }
  return `${district} ${industrialLabels[index % industrialLabels.length]} ${serial}`;
};

export const createAgentName = (rng: Rng) => `${pick(firstNames, rng)} ${pick(lastNames, rng)}`;

export const createRuntimeBuildingLabel = (world: WorldState, kind: BuildingKind, point: Point) => {
  const index = world.entities.buildings.filter((building) => building.kind === kind).length;
  const seed = mixSeed(world.seed, point.x, point.y, world.metrics.mapVersion + 1, index, buildingKindSalt[kind]);
  return createBuildingLabel(seed, createRng(seed), kind, index);
};

export const createRuntimeAgentName = (world: WorldState, home: Point, shiftStartMinute: number) => {
  const seed = mixSeed(world.seed, world.day, world.tick, world.entities.agents.length + 1, home.x, home.y, shiftStartMinute);
  return createAgentName(createRng(seed));
};
