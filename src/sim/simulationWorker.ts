/// <reference lib="webworker" />

import { STARTER_WORLD_SEED } from './constants';
import { advanceWorld, stepWorld } from './stepWorld';
import { SimulationWorkerInboundMessage, SimulationWorkerOutboundMessage } from './simulationWorkerTypes';
import { selectWorldAgent, paintWorldTile } from './worldMutations';
import { createStarterWorld } from './world';

let world = createStarterWorld();
let carryMs = 0;

const publishSnapshot = () => {
  const message: SimulationWorkerOutboundMessage = {
    type: 'snapshot',
    world,
    carryMs,
  };

  self.postMessage(message);
};

self.onmessage = (event: MessageEvent<SimulationWorkerInboundMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'init':
      world = message.world;
      carryMs = message.carryMs;
      publishSnapshot();
      break;
    case 'advance': {
      const advanced = advanceWorld(world, message.elapsedMs, carryMs, {
        maxElapsedMs: message.maxElapsedMs,
      });
      world = advanced.world;
      carryMs = advanced.carryMs;
      publishSnapshot();
      break;
    }
    case 'bootstrap':
      world = createStarterWorld(message.seed);
      carryMs = 0;
      publishSnapshot();
      break;
    case 'reset':
      world = createStarterWorld(STARTER_WORLD_SEED);
      carryMs = 0;
      publishSnapshot();
      break;
    case 'step':
      world = stepWorld(world);
      publishSnapshot();
      break;
    case 'selectAgent':
      world = selectWorldAgent(world, message.agentId);
      publishSnapshot();
      break;
    case 'paintTile':
      world = paintWorldTile(world, message.x, message.y, message.mode);
      publishSnapshot();
      break;
  }
};

export {};
