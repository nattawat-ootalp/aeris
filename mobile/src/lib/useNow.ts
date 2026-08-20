/**
 * A clock that re-renders its caller on a fixed tick.
 *
 * How old a reading is changes every second, but nothing about the reading itself does — so a
 * screen that only re-renders when new data arrives would print the age it had at arrival and
 * then hold it, which reads as "this is current" for as long as the screen stays open. Ages
 * are derived from this value so they count up on their own.
 */
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Seconds between `at` (epoch ms) and now, or null when there is no timestamp to age. Never
 *  negative: a clock that disagrees with the device by a second must not read as the future. */
export function ageSeconds(at: number | null | undefined, now: number): number | null {
  if (at == null) return null;
  return Math.max(0, (now - at) / 1000);
}
