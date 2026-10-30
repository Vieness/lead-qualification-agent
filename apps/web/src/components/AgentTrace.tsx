import type { Trace } from '../types';
import { humanize } from '../labels';

/** What the agent did: the supervisor's plan, every tool call and the LLM cost of the run. */
export function AgentTrace({ trace }: { trace: Trace }) {
  const { run, toolCalls } = trace;
  const llmCalls = run.events.filter((e) => e.type === 'llm_call');
  const retries = run.events.filter((e) => e.type === 'llm_retry').length;
  const slowest = Math.max(1, ...toolCalls.map((c) => c.latencyMs));

  return (
    <div className="trace">
      <dl className="stats">
        <div>
          <dt>Duration</dt>
          <dd>{run.durationMs ?? '–'} ms</dd>
        </div>
        <div>
          <dt>LLM calls</dt>
          <dd>
            {llmCalls.length}
            {retries > 0 && ` (+${retries} retries)`}
          </dd>
        </div>
        <div>
          <dt>Tokens in / out</dt>
          <dd>
            {run.usage.inputTokens} / {run.usage.outputTokens}
          </dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{run.model ?? run.llmProvider}</dd>
        </div>
      </dl>

      <h4>Plan (supervisor)</h4>
      <ol className="plan">
        {run.routeLog.map((step) => (
          <li key={step.step}>
            <strong>{humanize(step.next)}</strong> <span className="muted">— {step.reason}</span>
          </li>
        ))}
      </ol>

      <h4>Tool calls</h4>
      <ol className="timeline">
        {toolCalls.map((call) => (
          <li key={call.step} className={call.error ? 'timeline__item--error' : undefined}>
            <span className="timeline__agent">{call.agent}</span>
            <span className="timeline__tool">{call.tool}</span>
            <span className="timeline__bar" aria-hidden="true">
              <span style={{ width: `${(call.latencyMs / slowest) * 100}%` }} />
            </span>
            <span className="timeline__ms">{call.latencyMs} ms</span>
            {call.error && <ToolError error={call.error} />}
          </li>
        ))}
      </ol>

      {run.notes.length > 0 && (
        <>
          <h4>Notes</h4>
          <ul>
            {run.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">Trace {run.traceId}</p>
    </div>
  );
}

const SHORT_ERROR = 140;

/** Provider errors run to several lines of ids and upsell text: one line first, the rest on demand. */
function ToolError({ error }: { error: string }) {
  const firstLine = error.split('\n')[0] ?? '';
  if (error.length <= SHORT_ERROR && firstLine === error) {
    return <p className="timeline__error">{error}</p>;
  }
  const short = firstLine.length > SHORT_ERROR ? `${firstLine.slice(0, SHORT_ERROR)}…` : firstLine;
  return (
    <details className="timeline__error">
      <summary>{short}</summary>
      <p>{error}</p>
    </details>
  );
}
