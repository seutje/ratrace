import { advanceRenderSnapshotState } from '../app/store';
import { getAgentRenderPosition } from '../app/camera';
import { WorldDynamicSnapshot } from '../sim/simulationWorkerTypes';
import { WorldState } from '../sim/types';
import { createStarterWorld } from '../sim/world';

const toSnapshot = (world: WorldState): WorldDynamicSnapshot => ({
  day: world.day,
  economy: { ...world.economy },
  entities: {
    buildings: world.entities.buildings.map((building) => ({
      ...building,
      tile: { ...building.tile },
    })),
  },
  frame: {
    energyValues: new Float32Array(world.entities.agents.map((agent) => agent.stats.energy)),
    happinessValues: new Float32Array(world.entities.agents.map((agent) => agent.stats.happiness)),
    hungerValues: new Float32Array(world.entities.agents.map((agent) => agent.stats.hunger)),
    posX: new Float32Array(world.entities.agents.map((agent) => agent.pos.x)),
    posY: new Float32Array(world.entities.agents.map((agent) => agent.pos.y)),
    stateCodes: new Uint8Array(world.entities.agents.length),
  },
  metrics: { ...world.metrics },
  minutesOfDay: world.minutesOfDay,
  obituary: world.obituary.map((entry) => ({ ...entry })),
  selectedAgent: undefined,
  selectedAgentId: world.selectedAgentId,
  selectedTile: world.selectedTile ? { ...world.selectedTile } : undefined,
  tick: world.tick,
  traffic: { ...world.traffic },
});

describe('render snapshot interpolation', () => {
  it('keeps the previous compatible snapshot for smooth interpolation', () => {
    const world = createStarterWorld();
    const first = toSnapshot(world);
    const second = toSnapshot({
      ...world,
      tick: world.tick + 2,
    });

    const initialState = advanceRenderSnapshotState(
      {
        current: null,
        currentReceivedAtMs: 0,
        estimatedIntervalMs: 0,
        previous: null,
        previousReceivedAtMs: 0,
      },
      first,
      { receivedAtMs: 100 },
    );
    const nextState = advanceRenderSnapshotState(initialState, second, { receivedAtMs: 140 });

    expect(nextState.previous).toBe(first);
    expect(nextState.current).toBe(second);
    expect(nextState.previousReceivedAtMs).toBe(100);
    expect(nextState.currentReceivedAtMs).toBe(140);
  });

  it('resets interpolation across full snapshots so follow mode cannot use a stale agent index', () => {
    const previousWorld = createStarterWorld();
    previousWorld.entities.agents[0]!.pos = { x: 5, y: 5 };
    previousWorld.entities.agents[1]!.pos = { x: 20, y: 20 };
    previousWorld.entities.agents[2]!.pos = { x: 40, y: 40 };

    const selectedAgent = previousWorld.entities.agents[2]!;
    previousWorld.selectedAgentId = selectedAgent.id;

    const currentWorld = structuredClone(previousWorld);
    currentWorld.tick += 2;
    currentWorld.entities.agents = currentWorld.entities.agents.slice(1);
    currentWorld.selectedAgentId = selectedAgent.id;
    currentWorld.entities.agents[1]!.pos = { x: 60, y: 60 };

    const previousSnapshot = toSnapshot(previousWorld);
    const currentSnapshot = toSnapshot(currentWorld);
    const interpolationState = advanceRenderSnapshotState(
      {
        current: null,
        currentReceivedAtMs: 0,
        estimatedIntervalMs: 0,
        previous: null,
        previousReceivedAtMs: 0,
      },
      previousSnapshot,
      { receivedAtMs: 100 },
    );
    const staleInterpolationState = advanceRenderSnapshotState(interpolationState, currentSnapshot, {
      receivedAtMs: 120,
    });
    const resetInterpolationState = advanceRenderSnapshotState(interpolationState, currentSnapshot, {
      receivedAtMs: 120,
      resetInterpolation: true,
    });

    expect(
      getAgentRenderPosition(currentWorld, selectedAgent.id, {
        alpha: 0,
        currentFrame: staleInterpolationState.current?.frame,
        previousFrame: staleInterpolationState.previous?.frame,
      }),
    ).toEqual({ x: 20, y: 20 });

    expect(
      getAgentRenderPosition(currentWorld, selectedAgent.id, {
        alpha: 0,
        currentFrame: resetInterpolationState.current?.frame,
        previousFrame: resetInterpolationState.previous?.frame,
      }),
    ).toEqual({ x: 60, y: 60 });
    expect(resetInterpolationState.previous).toBe(currentSnapshot);
    expect(resetInterpolationState.current).toBe(currentSnapshot);
  });
});
