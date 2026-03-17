import { BuildMode, WorldState } from './types';

export type SimulationWorkerInboundMessage =
  | {
      type: 'init';
      carryMs: number;
      world: WorldState;
    }
  | {
      type: 'advance';
      elapsedMs: number;
      maxElapsedMs: number;
    }
  | {
      type: 'bootstrap';
      seed: number;
    }
  | {
      type: 'reset';
    }
  | {
      type: 'step';
    }
  | {
      type: 'selectAgent';
      agentId?: string;
    }
  | {
      type: 'paintTile';
      mode: BuildMode;
      x: number;
      y: number;
    };

export type SimulationWorkerOutboundMessage = {
  type: 'snapshot';
  carryMs: number;
  world: WorldState;
};
