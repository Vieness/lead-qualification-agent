import { api } from '../api';
import { hrefFor } from '../hooks/useHashRoute';
import { useLoad } from '../hooks/useLoad';
import { humanize, TIER } from '../labels';
import { ApproveButton } from './ApproveButton';

export function ReviewQueue() {
  const { state, reload } = useLoad(() => api.listLeads('pending_approval'), 'queue');

  if (state.status === 'loading') return <p className="muted">Loading queue…</p>;
  if (state.status === 'error') {
    return (
      <p className="alert alert--error" role="alert">
        {state.error.message}
      </p>
    );
  }

  const { items } = state.data;
  if (items.length === 0) {
    return (
      <p className="card muted">Nothing waiting for review. New risky leads will appear here.</p>
    );
  }

  return (
    <ul className="queue">
      {items.map(({ lead, result, createdAt }) => {
        const reasons = [
          ...new Set(
            result.guardrails.findings
              .filter((f) => f.severity !== 'info')
              .map((f) => humanize(f.code)),
          ),
        ];
        return (
          <li key={result.leadId} className="card queue__item">
            <div>
              <a href={hrefFor({ page: 'lead', id: result.leadId })} className="queue__title">
                {lead.company ?? lead.name}
              </a>{' '}
              <span className="badge">
                {TIER[result.tier]} · {result.score}
              </span>
              <p>{result.summary}</p>
              <p className="muted small">
                {reasons.length ? `Why: ${reasons.join(', ')}` : 'No draft'} ·{' '}
                {new Date(createdAt).toLocaleString()}
              </p>
            </div>
            {result.draftReply ? (
              <ApproveButton leadId={result.leadId} onApproved={reload} />
            ) : (
              <span className="muted small">Reply manually</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
