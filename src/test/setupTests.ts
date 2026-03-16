import '@testing-library/jest-dom/vitest';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock);
const mockCanvasContext = {
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  fillText: vi.fn(),
  createLinearGradient: vi.fn(() => ({
    addColorStop: vi.fn(),
  })),
  set fillStyle(_value: string) {},
  set strokeStyle(_value: string) {},
  set lineWidth(_value: number) {},
  set font(_value: string) {},
} as unknown as CanvasRenderingContext2D;

HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCanvasContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;
