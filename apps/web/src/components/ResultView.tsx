import { DECISION, statusLabel, TIER } from '../labels';
import type { LeadRecord, Trace } from '../types';
import { AgentTrace } from './AgentTrace';
import { ApproveButton } from './ApproveButton';
import { DraftReply } from './DraftReply';
import { Findings } from './Findings';
import { ScoreBreakdown } from './ScoreBreakdown';

type Props = {
  record: LeadRecord;
  trace: Trace | null;
  onApproved: (record: LeadRecord) => void;
};

export function ResultView({ record, trace, onApproved }: Props) {
  const { result, lead } = record;
  const decision = DECISION[result.decision];
  const waiting = result.status === 'pending_approval';

  return (
    <article className="result" aria-live="polite">
      <header className={`banner banner--${result.decision}`}>
        <div>
          <p className="banner__label">{decision.label}</p>
          <p className="banner__summary">{result.summary}</p>
          <p className="banner__status">
            {statusLabel(record)} · {decision.hint}
          </p>
        </div>
        <div className="banner__score" aria-label={`Score ${result.score} of 100`}>
          <span>{result.score}</span>
          <small>{TIER[result.tier]}</small>
        </div>
      </header>
      {waiting && (
        <div className="card card--action">
          {result.draftReply ? (
            <>
              <p>
                The agent parked this lead for a person. Review the findings and the draft, then
                approve.
              </p>
              <ApproveButton leadId={result.leadId} onApproved={onApproved} />
            </>
          ) : (
            // Approving means "send this draft"; the API refuses it without one (409 no_draft)
            <p>The agent wrote no draft for this lead. Review the findings and reply manually.</p>
          )}
        </div>
      )}

      <div className="grid">
        <section className="card">
          <h3>Score</h3>
          {result.tierCap && (
            <p className="alert alert--warn">
              Tier capped at {result.tierCap.tier}: {result.tierCap.reasons.join('; ')}.
            </p>
          )}
          <ScoreBreakdown items={result.scoreBreakdown} />
        </section>
        <section className="card">
          <h3>Guardrails</h3>
          <Findings findings={result.guardrails.findings} />
        </section>
      </div>

      <section className="card">
        <h3>Draft reply</h3>
        <DraftReply draft={result.draftReply} />
      </section>

      {result.matchedCases.length > 0 && (
        <section className="card">
          <h3>Similar past projects</h3>
          <ul className="cases">
            {result.matchedCases.map((c) => (
              <li key={c.id}>
                <strong>{c.title}</strong>{' '}
                <span className="badge">{Math.round(c.relevance * 100)}% match</span>
                <p className="muted">{c.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h3>How the agent worked</h3>
        {trace ? <AgentTrace trace={trace} /> : <p className="muted">Loading trace…</p>}
      </section>

      <details className="card">
        <summary>Original lead</summary>
        <p>
          <strong>{lead.name}</strong> · {lead.email}
          {lead.company && ` · ${lead.company}`}
          {lead.website && ` · ${lead.website}`}
        </p>
        <pre className="draft__body">{lead.message}</pre>
      </details>
    </article>
  );
}
