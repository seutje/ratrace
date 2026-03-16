# RatRace Implementation Plan

## Goal

Build the simulation described in [DESIGN.md](/home/seutje/projects/ratrace/DESIGN.md) as a Vite + React + Canvas application with a deterministic simulation core, React-driven UI panels, and phased delivery that keeps the project runnable at the end of every phase.

## Working Assumptions

- Use TypeScript from the start to make the simulation state, agent state machine, and tile data explicit.
- Use Vite for app scaffolding, React for UI, and Zustand for the world store.
- Keep the simulation core isolated from React so logic can be unit-tested without the browser.
- Maintain a single source of truth for world state and derive rendered UI from it.
- Every phase must leave the app in a buildable state with passing automated checks.

## Cross-Phase Standards

- Add `lint`, `test`, and `build` scripts before feature work expands.
- Prefer pure functions for simulation updates, decisions, and pathfinding.
- Keep rendering code separate from simulation code.
- Add fixtures or seed helpers for deterministic tests.
- If a phase introduces a new subsystem, add at least one focused unit test for it and one integration-style test where practical.

## Phase 0: Project Bootstrap

### Scope

- Initialize a Vite + React + TypeScript project.
- Add Zustand, a test runner such as Vitest, and ESLint.
- Create a minimal folder layout:
  - `src/app`
  - `src/sim`
  - `src/render`
  - `src/ui`
  - `src/test`
- Add a basic app shell that renders a placeholder canvas area and placeholder HUD container.
- Add shared npm scripts: `dev`, `build`, `test`, `lint`.

### Deliverables

- A runnable app scaffold committed in source control.
- Baseline lint and test configuration.
- A documented project structure that matches the simulation/UI split.

### AI-Verifiable Checks

- Run `npm install`.
- Run `npm run build` and confirm success.
- Run `npm run test` and confirm at least one smoke test passes.
- Run `npm run lint` and confirm no errors.
- Run `rg "createRoot|StrictMode|zustand|vitest" src package.json` and confirm the expected stack is present.

## Phase 1: Core Domain Model and Store

### Scope

- Define the core types from the design:
  - world state
  - economy
  - agent
  - building
  - tile
  - path
- Create a Zustand world store with initialization helpers and reset/load hooks.
- Add deterministic world generation for a small starter map with homes, workplaces, shops, and roads.
- Encode the base constants:
  - `60` ticks per second
  - `1 real second = 1 game hour`
  - agent stats and state enums

### Deliverables

- Typed world schema aligned with the design document.
- Seeded starter world that can be recreated exactly in tests.
- Store actions for bootstrapping, stepping time, selecting an agent, and mutating tiles/buildings.

### AI-Verifiable Checks

- Run unit tests that validate world initialization shape and default values.
- Run `rg "ticksPerSecond|game hour|AgentState|WorldState|createWorldStore" src` and confirm the expected primitives exist.
- Add and run a test that creates two worlds with the same seed and asserts identical initial state.
- Run `npm run build`.

## Phase 2: Fixed-Step Simulation Engine

### Scope

- Implement a simulation engine that advances world state using a fixed time step independent of rendering frequency.
- Separate simulation stepping from drawing so the engine can run in tests.
- Advance world clock, day rollover, agent stat decay/recovery hooks, and economy bookkeeping hooks.
- Add pause, resume, and single-step controls exposed through the store.

### Deliverables

- A pure or near-pure `stepWorld` pipeline.
- Simulation scheduler integration with `requestAnimationFrame`.
- Engine controls suitable for later debugging and inspection.

### AI-Verifiable Checks

- Add tests that step the world for `60` ticks and assert one in-game day-time hour passes.
- Add tests for day rollover from `2300` to `0000` and `day + 1`.
- Add tests proving simulation output does not depend on render frame count for the same elapsed time budget.
- Run `npm run test` and `npm run build`.

## Phase 3: Grid Map and Canvas Renderer

### Scope

- Render the tile grid to an HTML5 canvas.
- Implement visual encoding for residential, commercial, industrial, and road tiles.
- Draw buildings and agents in distinct layers.
- Add resize handling and a camera/viewport strategy appropriate for the starter map.
- Keep rendering stateless relative to the simulation engine where possible.

### Deliverables

- Canvas world rendering with stable tile-to-pixel mapping.
- Color-coded map matching the design.
- A renderer API that accepts world state and draws a frame.

### AI-Verifiable Checks

- Add tests for tile-to-pixel coordinate conversion and viewport calculations.
- Run the app in a browser automation step and assert a canvas is present.
- Capture a screenshot and verify that at least three zone colors and road tiles are visible.
- Run `npm run build`.

## Phase 4: Agent Scheduling and Home/Work Loop

### Scope

- Implement the initial agent state machine from the design.
- Support home and work assignments.
- Add work-hour logic so agents move from home to work and back based on the world clock.
- Add movement over the grid using discrete positions or interpolated travel over tile paths.
- Ensure agents physically traverse the world rather than teleport.

### Deliverables

- Agents with `IDLE`, `MOVING_TO_WORK`, `WORKING`, and `SLEEPING` behavior.
- Time-driven home/work routing.
- Visual agent movement on the canvas.

### AI-Verifiable Checks

- Add tests that simulate a workday and assert agent state transitions in the expected order.
- Add tests that confirm an agent position changes incrementally over multiple ticks rather than jumping directly to destination.
- Add a deterministic integration test for one agent assigned to one home and one workplace.
- Run browser automation to confirm agent markers move over time while the simulation is unpaused.

## Phase 5: Pathfinding and Road Speed Rules

### Scope

- Implement A* pathfinding on the tile grid.
- Recompute paths only when a destination changes or the map invalidates a route.
- Make road tiles provide `2x` movement speed versus non-road traversal.
- Add path caching or route invalidation hooks to avoid unnecessary recalculation.

### Deliverables

- A tested pathfinding module.
- Route-following logic integrated into agent movement.
- Road speed advantage reflected in travel time.

### AI-Verifiable Checks

- Add unit tests for A* on simple grids, blocked paths, and no-path scenarios.
- Add a test proving path computation is not repeated every tick while destination is unchanged.
- Add a test comparing travel duration on road-heavy and off-road routes and assert the road route is faster.
- Run `npm run test` and `npm run build`.

## Phase 6: HUD, Selection, Inspector, and Build Tools

### Scope

- Build the React HUD showing world time, total population, and city treasury.
- Support clicking agents on the canvas to select them.
- Add an inspector panel that shows agent stats, state, wallet, home/work IDs, and a thought string.
- Add a build menu for painting roads and zoning residential, commercial, and industrial tiles.
- Connect map edits to simulation/path invalidation.

### Deliverables

- Functional React UI layered over the canvas.
- Agent selection and inspection flow.
- Basic map editing tools.

### AI-Verifiable Checks

- Add component tests for HUD values and inspector rendering from store state.
- Add browser automation that clicks an agent and asserts inspector fields update.
- Add browser automation that paints at least one road tile and verifies the tile type changed in UI or state debug output.
- Run `npm run test`, `npm run lint`, and `npm run build`.

## Phase 7: Economy and Shopping Logic

### Scope

- Implement agent wallets, wages, shop spending, and industrial stock production.
- Add commercial building stock consumption and industrial building stock generation.
- Extend the state machine with shopping behavior tied to hunger and available cash.
- Enforce `wallet === 0` preventing purchases.
- Update treasury and aggregate wealth metrics as defined by the chosen economy rules.

### Deliverables

- A closed-loop basic economy among industrial, commercial, and residential systems.
- Agent shopping decisions driven by hunger and wallet state.
- HUD and inspector updates reflecting money and stock changes.

### AI-Verifiable Checks

- Add tests for wage payment during work and wallet deduction during shopping.
- Add tests that a hungry agent with cash enters shopping flow and a hungry agent with `wallet === 0` does not complete a purchase.
- Add tests for stock decrement at shops and stock increment at industry.
- Run a deterministic simulation for several in-game days and assert economy values remain finite and non-negative where required.

## Phase 8: Traffic and Congestion

### Scope

- Track road occupancy by tile.
- Apply congestion-based speed reduction using the design formula.
- Surface congestion visually or through debug metrics.
- Ensure path following and congestion interact without breaking determinism.

### Deliverables

- Road capacity model.
- Per-agent speed adjustments based on occupancy.
- Observable traffic effects in the simulation.

### AI-Verifiable Checks

- Add tests for the congestion speed formula with low, medium, and over-capacity occupancy.
- Add a scenario test with many agents sharing one corridor and assert travel time increases compared with the uncongested baseline.
- Add a browser automation step that runs a dense scenario and verifies traffic metrics or visibly slowed movement.
- Run `npm run test` and `npm run build`.

## Phase 9: Life Cycle, Population Turnover, and Stability Pass

### Scope

- Implement agent arrival and departure rules for the "life and death" milestone.
- Add safe cleanup for agents leaving the world so references, paths, and selections do not dangle.
- Balance rates and defaults so the simulation remains legible over extended runtime.
- Add lightweight telemetry or debug panels for population, wealth, and performance trends.

### Deliverables

- Stable population turnover mechanics.
- Cleanup-safe entity lifecycle handling.
- Longer-run simulation resilience improvements.

### AI-Verifiable Checks

- Add tests that spawn and remove agents while preserving valid store invariants.
- Add tests confirming selected agents are deselected or remapped safely when removed.
- Run a soak test for an extended deterministic simulation and assert no crashes, NaN values, or unbounded entity-reference leaks occur.
- Run `npm run test`, `npm run lint`, and `npm run build`.

## Final Hardening Pass

### Scope

- Audit performance hotspots in simulation stepping and rendering.
- Tighten naming, comments, and developer documentation.
- Add a short README section covering setup, scripts, and architecture boundaries.
- Remove dead code and unstable debug-only hooks that are no longer needed.

### AI-Verifiable Checks

- Run the full verification suite: `npm run lint`, `npm run test`, `npm run build`.
- Run a production preview or equivalent smoke check and confirm the app loads.
- Search for leftover placeholders with `rg "TODO|FIXME|placeholder" src`.
- Confirm the README documents setup and the phase-complete feature set.
