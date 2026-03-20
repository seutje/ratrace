# RatRace

RatRace is a city simulation with a deterministic fixed-step engine, a canvas world renderer, and HUD with inspector panels.

In `Select` mode, clicking an agent opens the inspector for that agent, and clicking a residential, commercial, or industrial tile opens the inspector for that tile. Zoned-tile inspection includes the tile coordinates, zoning type, building record, economic values, pantry values, assignment counts, and any linked residents or workers.

## Setup

- `npm install`
- `npm run dev`

## Scripts

- `npm run dev` starts the Vite dev server.
- `npm run test` runs the Vitest suite.
- `npm run lint` runs ESLint.
- `npm run build` creates a production build.

## How the simulation works

The simulation runs as a deterministic fixed-step worker. One simulation tick happens `60` times per real second, and each tick advances the game clock by `1` in-game minute. That means a full in-game day is `1440` ticks, or about `24` real seconds at normal speed. Because the simulation advances in fixed steps instead of variable render-frame deltas, the same seed and the same inputs produce the same world state.

### World generation

`createStarterWorld()` builds a repeatable city from a numeric seed.

- The map starts as a `144 x 96` tile grid.
- Roads are laid out as a regular arterial grid, including the outer border and every fourth row and column.
- Buildable lots are any non-road tiles that touch a road.
- Residential, commercial, and industrial buildings are then placed by scoring candidate lots instead of choosing purely at random:
  - commercial lots prefer the center of the city
  - industrial lots prefer outer-edge cluster zones
  - residential lots are split between a denser central area and smaller pockets near industrial clusters
- Every placed building writes its type back onto the tile map and gets deterministic labels, capacities, stock, pantry capacity, and starting cash.
- The starter population is then created and assigned:
  - each agent gets a home from the available residential slots
  - each agent gets a workplace in either industry or retail
  - jobs receive staggered shift start times so the whole population does not move at once
  - each agent starts with randomized wallet, stats, sex, personality traits, and an adult starting age
  - starting ages are varied deterministically so the initial population does not all die off on the same day

### The fixed-step update loop

Every tick runs the same ordered simulation pass in `stepWorldInPlace()`:

1. Advance `tick`, `minutesOfDay`, and `day`.
2. On hourly boundaries, move public money into struggling businesses and restock shops from factories.
3. Recompute traffic occupancy for the current positions of all agents.
4. For each agent:
   - update hunger, energy, and happiness
   - activate a work shift if its start time has arrived
   - choose a destination based on current needs
   - assign or reuse a route
   - move incrementally toward the next route point
   - process arrival effects such as working, sleeping, or shopping
5. At midnight, run population turnover, household consolidation, and household growth.
6. Recalculate economy totals such as total wealth and global supply stock.

The worker publishes either full snapshots or compact dynamic snapshots back to the UI, so rendering stays decoupled from the simulation state updates. The renderer interpolates only across compatible snapshots and resets interpolation on full snapshots, which prevents the follow camera from blending against stale agent indices after structural population changes.

### Agents, needs, and daily routine

Agents are not scripted with one hardcoded schedule. Each tick they react to a mix of time, resources, memory, and traits.

- Hunger rises over time.
- Energy falls while awake and recovers while sleeping.
- Happiness is recomputed from hunger, fatigue, commute stress, hardship history, and unpaid work.
- Traits change behavior:
  - `appetite` changes how quickly hunger becomes urgent
  - `stamina` changes fatigue and sleep recovery
  - `thrift` changes shopping urgency and basket size
  - `resilience` changes how sharply hardship damages happiness
- Commute memory records recent travel times and feeds back into later decisions such as sleep urgency and shopping thresholds.

The main decision priorities are:

- sleep if energy is too low or it is nighttime
- go to work if an active shift is in progress
- shop if the household pantry is empty or running low and there is a staffed store with stock
- otherwise return home or stay idle if already there

Homes have a pantry, and agents can use it in two ways:

- eat directly from the pantry when home and hungry
- pack one meal to carry to work or on the road

Packed lunches are only consumed when hunger fully maxes out, which lets homes buffer future hunger instead of forcing an immediate shop trip. Sleep is also modeled as a committed block: once an agent starts sleeping, they stay asleep for at least the minimum sleep window and possibly longer if their energy deficit is large.

### Movement, routing, and congestion

Movement is tile-based for routing but continuous for rendering.

- Routes are orthogonal tile paths generated by A* pathfinding.
- Roads are cheaper than non-road tiles, so agents prefer the street network over cutting across zoning when both are possible.
- Frequently requested destinations are promoted into a reverse goal-search cache, which makes repeated commutes cheaper to compute.
- Agents also cache their home-to-work and work-to-home commute routes until the map changes.
- While a route is active, the simulation reuses it by index and only invalidates it when the destination changes, the agent falls off the expected path, or `mapVersion` changes.
- Nearest staffed retail targets are cached across the whole tile grid and rebuilt lazily when map edits or shop service availability change, which keeps pantry-refill and emergency-food decisions cheap even at high population.
- Map edits increment `mapVersion`, which invalidates cached commute routes without recomputing them eagerly.

Actual movement is incremental rather than teleporting:

- agents move a short distance each tick
- road travel is faster than off-road travel
- road tiles use directional lane centers, so opposite directions occupy separate virtual lanes on the same tile
- occupancy reservations prevent two agents from claiming the same blocking slot at once
- congestion slows movement using a simple capacity curve with a floor, so heavy traffic never reaches zero speed but can back up significantly

Residential, commercial, and industrial building tiles allow overlap, which lets multiple residents or workers exist on the same building tile without deadlocking the simulation.

### Economy model

The economy is intentionally small and mechanical rather than market-sim heavy.

- Industrial buildings pay hourly wages out of their own cash reserves.
- When factories successfully pay workers, they also produce inventory.
- Commercial buildings pay clerks out of their own cash reserves.
- Shoppers buy pantry goods from commercial stock using personal wallet cash.
- Retail sales split into:
  - shop revenue
  - sales tax sent to the treasury
- Once per hour, commercial buildings restock by purchasing wholesale inventory from industrial buildings.
- Also once per hour, the treasury can subsidize businesses that are below their target cash level, but only when treasury reserves are above the configured reserve target.
- Subsidy priority is based on which businesses have the weakest payroll runway, so near-failing employers are topped up first.

Economy totals are recomputed from treasury cash, agent wallets, business cash, and stored goods. The result is a closed-loop toy economy where money circulates through wages, retail, wholesale transfers, taxes, and subsidies.

### Population turnover and household growth

At midnight the simulation performs long-horizon lifecycle updates.

- Every in-game day counts as one year of age.
- Starter agents begin at varied adult ages, while newborn household-growth agents begin at age `0`.
- Agents die after reaching age `100`.
- Agents track whether they spent the day at maximum hunger.
- Repeated full-hunger days increase hardship memory.
- Agents that remain at maximum hunger for too many consecutive days are removed from the city.
- Every death is recorded in the left-side `Obituary` drawer, including a visible entry count plus the cause, day, and age at death.
- Isolated residents, and residents stuck in same-sex-only roommate households, can relocate into occupied homes with spare room, with relocation preferring households that create mixed-sex living arrangements and immediate growth opportunities.
- If housing capacity is available, a residential household can add one new resident per day when:
  - two qualifying residents of opposite sexes live in the home
  - they each have at least `$100` and spend it when the household grows
  - happiness is high enough
  - recent hardship and unpaid work stay below the cutoff
- New residents inherit blended traits from their parents, receive deterministic names, join the household, and are assigned a job and shift.

This makes population change an outcome of household prosperity and food security rather than a disconnected spawn timer.

### Player edits and simulation response

The build tools modify tiles directly in `paintWorldTile()`.

- Painting a zoning tile can create a new building with starter cash, capacity, and stock.
- Repainting over an existing building removes that building first.
- Agents whose home or workplace becomes invalid are reassigned to valid buildings when possible.
- The map version increments on every edit, which invalidates old routes and forces future pathfinding to respect the new layout.

## Architecture

- `src/sim` contains the deterministic simulation core, world generation, routing, economy, congestion, and lifecycle logic.
- `src/render` contains the canvas renderer, the animation loop hook, and the in-canvas drawer HUD including the `Obituary` log.
- `src/ui` contains React HUD, controls, build tools, and the agent inspector.
- `src/app` contains the Zustand store and the application shell.
