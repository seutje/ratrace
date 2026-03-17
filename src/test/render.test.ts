import { calculateViewport, DEFAULT_ZOOM } from '../render/canvasRenderer';

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
});
