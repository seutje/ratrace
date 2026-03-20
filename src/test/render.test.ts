import { renderDynamicWorld, calculateViewport, DEFAULT_ZOOM } from '../render/canvasRenderer';
import { AgentSex, AgentState, BuildingKind, TileType, type WorldState } from '../sim/types';

const createWalletWorld = (): WorldState => ({
  day: 1,
  economy: { inflation: 1, supplyStock: 0, totalWealth: 0, treasury: 100 },
  entities: {
    agents: [
      {
        age: 30,
        carriedMeals: 0,
        childIds: [],
        coParentIds: [],
        commuteToHomeRoute: null,
        commuteToHomeRouteMapVersion: 0,
        commuteToWorkRoute: null,
        commuteToWorkRouteMapVersion: 0,
        daysInCity: 1,
        homeId: 'home-1',
        id: 'agent-1',
        keptMaxHungerToday: false,
        lastCompletedShiftDay: 0,
        maxHungerStreakDays: 0,
        memory: {
          averageCommuteMinutes: 0,
          completedShifts: 0,
          lastCommuteMinutes: 0,
          longestCommuteMinutes: 0,
          recentHardshipDays: 0,
          shoppingTrips: 0,
          unpaidHours: 0,
        },
        name: 'Rhea',
        parentIds: [],
        paidShiftWorkMinutes: 0,
        pos: { x: 2, y: 2 },
        route: [],
        routeComputeCount: 0,
        routeIndex: 0,
        routeMapVersion: 0,
        sex: AgentSex.Female,
        shiftDay: 0,
        shiftStartMinute: 480,
        shiftWorkMinutes: 0,
        state: AgentState.Idle,
        stats: { energy: 80, happiness: 80, hunger: 20 },
        thought: 'idle',
        traits: { appetite: 1, resilience: 1, stamina: 1, thrift: 1 },
        wallet: 140,
        workId: 'work-1',
      },
      {
        age: 28,
        carriedMeals: 0,
        childIds: [],
        coParentIds: [],
        commuteToHomeRoute: null,
        commuteToHomeRouteMapVersion: 0,
        commuteToWorkRoute: null,
        commuteToWorkRouteMapVersion: 0,
        daysInCity: 1,
        homeId: 'home-1',
        id: 'agent-2',
        keptMaxHungerToday: false,
        lastCompletedShiftDay: 0,
        maxHungerStreakDays: 0,
        memory: {
          averageCommuteMinutes: 0,
          completedShifts: 0,
          lastCommuteMinutes: 0,
          longestCommuteMinutes: 0,
          recentHardshipDays: 0,
          shoppingTrips: 0,
          unpaidHours: 0,
        },
        name: 'Bram',
        parentIds: [],
        paidShiftWorkMinutes: 0,
        pos: { x: 4, y: 3 },
        route: [],
        routeComputeCount: 0,
        routeIndex: 0,
        routeMapVersion: 0,
        sex: AgentSex.Male,
        shiftDay: 0,
        shiftStartMinute: 480,
        shiftWorkMinutes: 0,
        state: AgentState.Idle,
        stats: { energy: 80, happiness: 80, hunger: 20 },
        thought: 'idle',
        traits: { appetite: 1, resilience: 1, stamina: 1, thrift: 1 },
        wallet: 90,
        workId: 'work-1',
      },
    ],
    buildings: [
      {
        capacity: 2,
        cash: 100,
        id: 'home-1',
        kind: BuildingKind.Residential,
        label: 'Home',
        pantryCapacity: 4,
        pantryStock: 2,
        stock: 0,
        tile: { x: 2, y: 2 },
      },
      {
        capacity: 2,
        cash: 100,
        id: 'work-1',
        kind: BuildingKind.Commercial,
        label: 'Shop',
        pantryCapacity: 0,
        pantryStock: 0,
        stock: 5,
        tile: { x: 4, y: 3 },
      },
    ],
  },
  height: 8,
  metrics: { mapVersion: 0, pathComputations: 0, populationCapacity: 2, trafficPeak: 0 },
  minutesOfDay: 480,
  obituary: [],
  seed: 1,
  selectedAgentId: undefined,
  selectedTile: undefined,
  tick: 1,
  tiles: Array.from({ length: 64 }, (_, index) => ({
    buildingId: undefined,
    type: TileType.Empty,
    x: index % 8,
    y: Math.floor(index / 8),
  })),
  traffic: {},
  width: 8,
});

describe('calculateViewport', () => {
  it('applies zoom on top of the fitted tile size and keeps the map centered', () => {
    const fitted = calculateViewport({ width: 20, height: 10 }, 800, 600, 1);
    const zoomed = calculateViewport({ width: 20, height: 10 }, 800, 600, DEFAULT_ZOOM);

    expect(fitted.tileSize).toBe(40);
    expect(zoomed.tileSize).toBe(40);
    expect(zoomed.offsetX).toBe(0);
    expect(zoomed.offsetY).toBe(100);
  });

  it('never shrinks tiles below one pixel', () => {
    const viewport = calculateViewport({ width: 50, height: 50 }, 50, 50, 0.01);

    expect(viewport.tileSize).toBe(1);
  });

  it('draws rank labels for the richest agents in wallet overlay mode', () => {
    const fillText = vi.fn();
    const context = {
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
      fillText,
      set fillStyle(_value: string) {},
      set font(_value: string) {},
      set lineWidth(_value: number) {},
      set strokeStyle(_value: string) {},
    } as unknown as CanvasRenderingContext2D;

    const world = createWalletWorld();

    const viewport = calculateViewport(world, 320, 320, DEFAULT_ZOOM);
    renderDynamicWorld(context, world, viewport, 'wallet');

    expect(fillText).toHaveBeenCalledWith(expect.stringContaining('1. Rhea $140'), expect.any(Number), expect.any(Number));
    expect(fillText).toHaveBeenCalledWith(expect.stringContaining('2. Bram $90'), expect.any(Number), expect.any(Number));
  });

  it('ranks wallet overlay leaders from the current frame wallet values', () => {
    const fillText = vi.fn();
    const context = {
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
      fillText,
      set fillStyle(_value: string) {},
      set font(_value: string) {},
      set lineWidth(_value: number) {},
      set strokeStyle(_value: string) {},
    } as unknown as CanvasRenderingContext2D;

    const world = createWalletWorld();
    world.entities.agents[0]!.wallet = 10;
    world.entities.agents[1]!.wallet = 20;

    const viewport = calculateViewport(world, 320, 320, DEFAULT_ZOOM);
    renderDynamicWorld(context, world, viewport, 'wallet', {
      alpha: 1,
      currentFrame: {
        energyValues: new Float32Array(world.entities.agents.map((agent) => agent.stats.energy)),
        happinessValues: new Float32Array(world.entities.agents.map((agent) => agent.stats.happiness)),
        hungerValues: new Float32Array(world.entities.agents.map((agent) => agent.stats.hunger)),
        posX: new Float32Array(world.entities.agents.map((agent) => agent.pos.x)),
        posY: new Float32Array(world.entities.agents.map((agent) => agent.pos.y)),
        stateCodes: new Uint8Array(world.entities.agents.length),
        walletValues: new Float32Array([200, 50]),
      },
    });

    expect(fillText).toHaveBeenCalledWith(expect.stringContaining('1. Rhea $200'), expect.any(Number), expect.any(Number));
    expect(fillText).toHaveBeenCalledWith(expect.stringContaining('2. Bram $50'), expect.any(Number), expect.any(Number));
  });
});
