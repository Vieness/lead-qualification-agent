import { api } from '../api';
import { useLoad } from '../hooks/useLoad';

export function StatusBar() {
  const { state } = useLoad(api.health, 'health');

  if (state.status === 'loading') return <span className="status">Checking API…</span>;
  if (state.status === 'error') {
    return <span className="status status--down">API unavailable</span>;
  }
  const { db, llmProvider, storage } = state.data;
  return (
    <span className={`status ${db === 'ok' ? 'status--ok' : 'status--down'}`}>
      API {db === 'ok' ? 'online' : 'degraded'} · LLM: {llmProvider} · DB: {storage}
    </span>
  );
}
