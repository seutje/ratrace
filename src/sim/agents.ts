import { createRng, Rng } from './random';
import { Agent, AgentMemory, AgentTraits } from './types';

const TRAIT_MIN = 0.8;
const TRAIT_MAX = 1.2;
const TRAIT_MUTATION_RANGE = 0.12;

const roundTrait = (value: number) => Math.round(value * 100) / 100;

const clampTrait = (value: number) => roundTrait(Math.min(TRAIT_MAX, Math.max(TRAIT_MIN, value)));

const createTrait = (rng: Rng) => clampTrait(TRAIT_MIN + rng() * (TRAIT_MAX - TRAIT_MIN));

const mixSeed = (seed: number, ...parts: number[]) => {
  let value = seed >>> 0;

  for (const part of parts) {
    value = Math.imul(value ^ (part >>> 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  }

  return value;
};

const blendTrait = (left: number, right: number, rng: Rng) =>
  clampTrait((left + right) / 2 + (rng() - 0.5) * TRAIT_MUTATION_RANGE);

export const createAgentTraits = (rng: Rng): AgentTraits => ({
  appetite: createTrait(rng),
  stamina: createTrait(rng),
  thrift: createTrait(rng),
  resilience: createTrait(rng),
});

export const createInheritedAgentTraits = (
  seed: number,
  firstParent: Agent,
  secondParent: Agent,
  saltParts: number[],
): AgentTraits => {
  const rng = createRng(mixSeed(seed, ...saltParts));

  return {
    appetite: blendTrait(firstParent.traits.appetite, secondParent.traits.appetite, rng),
    stamina: blendTrait(firstParent.traits.stamina, secondParent.traits.stamina, rng),
    thrift: blendTrait(firstParent.traits.thrift, secondParent.traits.thrift, rng),
    resilience: blendTrait(firstParent.traits.resilience, secondParent.traits.resilience, rng),
  };
};

export const createAgentMemory = (): AgentMemory => ({
  averageCommuteMinutes: 0,
  lastCommuteMinutes: 0,
  longestCommuteMinutes: 0,
  recentHardshipDays: 0,
  shoppingTrips: 0,
  completedShifts: 0,
  unpaidHours: 0,
});
