import { useCallback, useEffect, useRef } from 'react';

// Runs `callback` immediately and then every `intervalMs` while `enabled` is true.
// Polling pauses while the tab is hidden and catches up as soon as it becomes visible.
// Returns `refresh`, a stable function that runs the callback right away (e.g. on a socket event).
export function usePolling(callback, intervalMs, enabled = true) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!enabled) return undefined;

    const tick = () => {
      if (document.visibilityState === 'visible') callbackRef.current();
    };

    tick();
    const timer = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs, enabled]);

  return useCallback(() => callbackRef.current(), []);
}
