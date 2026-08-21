/**
 * Run a loader on a fixed cadence while the screen is on top and the tab is in the
 * foreground.
 *
 * A screen that fetches once on focus prints whatever was true at the moment it opened and
 * then holds it — for a risk score and a 20-minute projection, both of which move as new
 * frames land, that reads as "nothing is changing" when the truth is "nobody asked again".
 * Polling stops while the tab is hidden or the screen is behind another one, so a backgrounded
 * page does not keep spending requests on a view nobody is looking at, and resumes with an
 * immediate call so the first thing a returning user sees is current.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

export function usePoll(run: () => void, intervalMs = 20000): void {
  // The loader identity changes on every render of the caller; keeping it in a ref means the
  // interval is not torn down and restarted each time, which would keep resetting the clock.
  const runRef = useRef(run);
  runRef.current = run;

  useFocusEffect(
    useCallback(() => {
      let timer: ReturnType<typeof setInterval> | null = null;

      const tick = () => runRef.current();

      const start = () => {
        if (timer != null) return;
        tick();
        timer = setInterval(tick, intervalMs);
      };

      const stop = () => {
        if (timer == null) return;
        clearInterval(timer);
        timer = null;
      };

      if (AppState.currentState === 'active') start();

      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') start();
        else stop();
      });

      return () => {
        stop();
        sub.remove();
      };
    }, [intervalMs]),
  );
}
