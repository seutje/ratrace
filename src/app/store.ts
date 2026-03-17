import { create } from 'zustand';
import { advanceWorld, stepWorld } from '../sim/stepWorld';
import { STARTER_WORLD_SEED } from '../sim/constants';
import { TileType, BuildMode, BuildingKind, WorldState } from '../sim/types';
import { createStarterWorld } from '../sim/world';
import { getTile, pointToTile, setTile } from '../sim/utils';

type WorldStore = {
  world: WorldState;
  paused: boolean;
  buildMode: BuildMode;
  carryMs: number;
  bootstrap: (seed?: number) => void;
  reset: () => void;
  setPaused: (paused: boolean) => void;
  singleStep: () => void;
  advanceElapsed: (elapsedMs: number) => void;
  selectAgent: (agentId?: string) => void;
  setBuildMode: (mode: BuildMode) => void;
  paintTile: (x: number, y: number, type: BuildMode) => void;
};

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

const reassignInvalidReferences = (world: WorldState) => {
  const homes = world.entities.buildings.filter((building) => building.kind === BuildingKind.Residential);
  const workplaces = world.entities.buildings.filter((building) => building.kind === BuildingKind.Industrial);

  world.entities.agents.forEach((agent) => {
    if (!homes.some((building) => building.id === agent.homeId) && homes[0]) {
      agent.homeId = homes[0].id;
    }
    if (!workplaces.some((building) => building.id === agent.workId) && workplaces[0]) {
      agent.workId = workplaces[0].id;
    }
  });
};

export const useWorldStore = create<WorldStore>((set) => ({
  world: createStarterWorld(),
  paused: false,
  buildMode: 'select',
  carryMs: 0,
  bootstrap: (seed = STARTER_WORLD_SEED) =>
    set({
      world: createStarterWorld(seed),
      carryMs: 0,
      paused: false,
    }),
  reset: () =>
    set({
      world: createStarterWorld(),
      paused: false,
      carryMs: 0,
    }),
  setPaused: (paused) => set({ paused }),
  singleStep: () =>
    set((state) => ({
      world: stepWorld(state.world),
    })),
  advanceElapsed: (elapsedMs) =>
    set((state) => {
      if (state.paused) {
        return state;
      }

      const advanced = advanceWorld(state.world, elapsedMs, state.carryMs);
      return {
        world: advanced.world,
        carryMs: advanced.carryMs,
      };
    }),
  selectAgent: (agentId) =>
    set((state) => ({
      world: {
        ...state.world,
        selectedAgentId: agentId,
      },
    })),
  setBuildMode: (mode) => set({ buildMode: mode }),
  paintTile: (x, y, mode) =>
    set((state) => {
      if (mode === 'select') {
        return state;
      }

      const world = structuredClone(state.world) as WorldState;
      const point = { x, y };
      const existingTile = getTile(world, point);
      if (!existingTile) {
        return state;
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
          stock: buildingKind === BuildingKind.Commercial ? 4 : buildingKind === BuildingKind.Industrial ? 2 : 0,
          capacity: buildingKind === BuildingKind.Residential ? 2 : 4,
          label: `${buildingKind.toLowerCase()}-${x}-${y}`,
        });
        setTile(world, point, {
          ...tile,
          buildingId,
        });
      }

      world.metrics.mapVersion += 1;
      reassignInvalidReferences(world);

      return {
        world,
      };
    }),
}));

export const selectSelectedAgent = (world: WorldState) =>
  world.entities.agents.find((agent) => agent.id === world.selectedAgentId);

export const findAgentAtCanvasPoint = (
  world: WorldState,
  point: { x: number; y: number },
  tileSize: number,
  offset: { x: number; y: number },
) => {
  const worldPoint = {
    x: (point.x - offset.x) / tileSize,
    y: (point.y - offset.y) / tileSize,
  };

  return world.entities.agents.find((agent) => {
    const dx = agent.pos.x - worldPoint.x;
    const dy = agent.pos.y - worldPoint.y;
    return dx * dx + dy * dy <= 0.45 * 0.45;
  });
};

export const tileFromCanvasPoint = (point: { x: number; y: number }, tileSize: number, offset: { x: number; y: number }) =>
  pointToTile({
    x: (point.x - offset.x) / tileSize,
    y: (point.y - offset.y) / tileSize,
  });
