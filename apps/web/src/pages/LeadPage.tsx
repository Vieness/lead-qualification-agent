import { useEffect, useState } from 'react';
import { api } from '../api';
import { ResultView } from '../components/ResultView';
import { useLoad } from '../hooks/useLoad';
import type { Trace } from '../types';

export function LeadPage({ id }: { id: string }) {
  const { state, set } = useLoad(() => api.getLead(id), id);
  const [trace, setTrace] = useState<Trace | null>(null);
  const traceId = state.status === 'ready' ? state.data.result.traceId : null;

  useEffect(() => {
    if (!traceId) return;
    let cancelled = false;
    // The trace is a nice-to-have: the result is shown even if it cannot be loaded
    api.getTrace(traceId).then(
      (t) => !cancelled && setTrace(t),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  if (state.status === 'loading') return <p className="muted">Loading lead…</p>;
  if (state.status === 'error') {
    return (
      <p className="alert alert--error" role="alert">
        {state.error.status === 404 ? 'This lead does not exist.' : state.error.message}
      </p>
    );
  }
  return <ResultView record={state.data} trace={trace} onApproved={set} />;
}
