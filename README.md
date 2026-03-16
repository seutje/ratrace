# RatRace

RatRace is a Vite + React + TypeScript city simulation with a deterministic fixed-step engine, a canvas world renderer, and React-driven HUD and inspector panels.

## Setup

- `npm install`
- `npm run dev`

## Scripts

- `npm run dev` starts the Vite dev server.
- `npm run test` runs the Vitest suite.
- `npm run lint` runs ESLint.
- `npm run build` creates a production build.

## Architecture

- `src/sim` contains the deterministic simulation core, world generation, routing, economy, congestion, and lifecycle logic.
- `src/render` contains the canvas renderer and the animation loop hook.
- `src/ui` contains React HUD, controls, build tools, and the agent inspector.
- `src/app` contains the Zustand store and the application shell.
