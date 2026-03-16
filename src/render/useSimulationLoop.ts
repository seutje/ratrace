import { useEffect, useRef } from 'react';

export const useSimulationLoop = (advanceElapsed: (elapsedMs: number) => void) => {
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    let frame = 0;

    const loop = (time: number) => {
      if (lastTimeRef.current !== null) {
        advanceElapsed(time - lastTimeRef.current);
      }
      lastTimeRef.current = time;
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      lastTimeRef.current = null;
    };
  }, [advanceElapsed]);
};
