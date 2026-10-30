import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api';

export type LoadState<T> =
  { status: 'loading' } | { status: 'error'; error: ApiError } | { status: 'ready'; data: T };

const toApiError = (err: unknown) =>
  err instanceof ApiError ? err : new ApiError(0, 'unknown', String(err));

/**
 * Loads data when `key` changes and exposes `reload` and `set` (for optimistic updates after
 * a mutation). State only changes in promise callbacks, never synchronously in the effect.
 */
export function useLoad<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => !cancelled && setState({ status: 'ready', data }),
      (err: unknown) => !cancelled && setState({ status: 'error', error: toApiError(err) }),
    );
    return () => {
      cancelled = true;
    };
    // `load` is recreated on every render; `key` and `version` are what should refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const set = useCallback((data: T) => setState({ status: 'ready', data }), []);
  return { state, reload, set };
}
