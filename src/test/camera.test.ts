import { getAgentRenderPosition, getPanToCenterWorldPoint } from '../app/camera';
import { createStarterWorld } from '../sim/world';

describe('camera helpers', () => {
  it('centers a world point in the viewport', () => {
    const pan = getPanToCenterWorldPoint({ width: 20, height: 10 }, { width: 800, height: 600 }, 1, {
      x: 7,
      y: 4,
    });

    expect(pan).toEqual({ x: 120, y: 40 });
  });

  it('uses interpolated frame positions for the selected agent', () => {
    const world = createStarterWorld();
    const agent = world.entities.agents[0]!;

    const point = getAgentRenderPosition(world, agent.id, {
      alpha: 0.25,
      currentFrame: {
        energyValues: new Float32Array([agent.stats.energy]),
        happinessValues: new Float32Array([agent.stats.happiness]),
        hungerValues: new Float32Array([agent.stats.hunger]),
        posX: new Float32Array([agent.pos.x + 4]),
        posY: new Float32Array([agent.pos.y + 8]),
        stateCodes: new Uint8Array([0]),
      },
      previousFrame: {
        energyValues: new Float32Array([agent.stats.energy]),
        happinessValues: new Float32Array([agent.stats.happiness]),
        hungerValues: new Float32Array([agent.stats.hunger]),
        posX: new Float32Array([agent.pos.x]),
        posY: new Float32Array([agent.pos.y]),
        stateCodes: new Uint8Array([0]),
      },
    });

    expect(point).toEqual({
      x: agent.pos.x + 1,
      y: agent.pos.y + 2,
    });
  });
});
