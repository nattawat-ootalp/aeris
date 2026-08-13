/**
 * Minimal async-state hook so screens render loading / error / data explicitly
 * (never a fabricated "current" value while data is missing — TDD §14).
 */
import { useCallback, useEffect, useState } from 'react';
import type { ApiResult } from '../api/client';

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'success'; data: T };

export function useAsync<T>(
  fetcher: () => Promise<ApiResult<T>>,
  deps: readonly unknown[] = [],
): { state: AsyncState<T>; reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });

  const run = useCallback(() => {
    let active = true;
    setState({ status: 'loading' });
    fetcher().then((res) => {
      if (!active) return;
      setState(res.ok ? { status: 'success', data: res.data } : { status: 'error', error: res.error });
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => run(), [run]);

  return { state, reload: run };
}
