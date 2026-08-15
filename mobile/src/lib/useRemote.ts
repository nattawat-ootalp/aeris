/**
 * One loading/error/data state machine for every screen that reads from the backend.
 * Refetches whenever the screen regains focus so a returning user never reads a stale
 * snapshot rendered as current (TDD §5.6/§14).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { NoDeviceError } from './device';

export interface Remote<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** True when the request could not run because no device has resolved yet (NoDeviceError). */
  noDevice: boolean;
  reload: () => void;
}

export function useRemote<T>(loader: () => Promise<T>): Remote<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noDevice, setNoDevice] = useState(false);
  // Only the newest request may write state — an earlier slow response must not overwrite
  // a newer one (device switch, rapid refocus).
  const requestId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const reload = useCallback(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    setNoDevice(false);
    loader()
      .then((d) => {
        if (!mounted.current || id !== requestId.current) return;
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (!mounted.current || id !== requestId.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setNoDevice(e instanceof NoDeviceError);
        setLoading(false);
      });
  }, [loader]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  return { data, loading, error, noDevice, reload };
}
