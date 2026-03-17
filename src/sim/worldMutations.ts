import { COMMERCIAL_STARTING_CASH, HOME_PANTRY_UNITS_PER_RESIDENT, INDUSTRIAL_STARTING_CASH } from './constants';
import { pickEmploymentAssignment } from './employment';
import { createRuntimeBuildingLabel } from './naming';
import { BuildMode, BuildingKind, TileType, WorldState } from './types';
import { getTile, setTile } from './utils';

const buildingKindForTile = (type: TileType) => {
  if (type === TileType.Residential) {
    return BuildingKind.Residential;
  }
  if (type === TileType.Commercial) {
    return BuildingKind.Commercial;
  }
  if (type === TileType.Industrial) {
    return BuildingKind.Industrial;
  }
  return undefined;
};

const getStartingBuildingCash = (kind: BuildingKind) => {
  if (kind === BuildingKind.Commercial) {
    return COMMERCIAL_STARTING_CASH;
  }

  if (kind === BuildingKind.Industrial) {
    return INDUSTRIAL_STARTING_CASH;
  }

  return 0;
};

const reassignInvalidReferences = (world: WorldState) => {
  const homes = world.entities.buildings.filter((building) => building.kind === BuildingKind.Residential);
  const workplaces = world.entities.buildings.filter((building) => building.kind !== BuildingKind.Residential);

  world.entities.agents.forEach((agent) => {
    if (!homes.some((building) => building.id === agent.homeId) && homes[0]) {
      agent.homeId = homes[0].id;
    }

    if (!workplaces.some((building) => building.id === agent.workId)) {
      const assignment = pickEmploymentAssignment(
        world.entities.buildings,
        world.entities.agents
          .filter((entry) => entry.id !== agent.id)
          .map((entry) => ({
            workId: entry.workId,
            shiftStartMinute: entry.shiftStartMinute,
          })),
      );

      if (assignment) {
        agent.workId = assignment.workId;
        agent.shiftStartMinute = assignment.shiftStartMinute;
      }
    }
  });
};

export const selectWorldAgent = (world: WorldState, agentId?: string): WorldState => ({
  ...world,
  selectedAgentId: agentId,
});

export const paintWorldTile = (sourceWorld: WorldState, x: number, y: number, mode: BuildMode): WorldState => {
  const world = structuredClone(sourceWorld) as WorldState;
  const point = { x, y };
  const existingTile = getTile(world, point);
  if (!existingTile) {
    return sourceWorld;
  }

  const nextType = mode as TileType;
  const previousBuildingId = existingTile.buildingId;
  if (previousBuildingId) {
    world.entities.buildings = world.entities.buildings.filter((building) => building.id !== previousBuildingId);
  }

  const tile = {
    ...existingTile,
    type: nextType,
    buildingId: undefined,
  };
  setTile(world, point, tile);

  const buildingKind = buildingKindForTile(nextType);
  if (buildingKind) {
    const buildingId = `build-${world.metrics.mapVersion + 1}-${x}-${y}`;
    world.entities.buildings.push({
      id: buildingId,
      kind: buildingKind,
      tile: point,
      cash: getStartingBuildingCash(buildingKind),
      stock: buildingKind === BuildingKind.Commercial ? 4 : buildingKind === BuildingKind.Industrial ? 2 : 0,
      capacity: buildingKind === BuildingKind.Residential ? 2 : 4,
      pantryStock: buildingKind === BuildingKind.Residential ? 2 * HOME_PANTRY_UNITS_PER_RESIDENT : 0,
      pantryCapacity: buildingKind === BuildingKind.Residential ? 2 * HOME_PANTRY_UNITS_PER_RESIDENT : 0,
      label: createRuntimeBuildingLabel(world, buildingKind, point),
    });
    setTile(world, point, {
      ...tile,
      buildingId,
    });
  }

  world.metrics.mapVersion += 1;
  reassignInvalidReferences(world);

  return world;
};
