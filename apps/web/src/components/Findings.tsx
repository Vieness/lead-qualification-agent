import { humanize, SEVERITY_ORDER } from '../labels';
import type { GuardFinding } from '../types';

export function Findings({ findings }: { findings: GuardFinding[] }) {
  if (findings.length === 0)
    return <p className="muted">No findings: nothing risky was detected.</p>;
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  return (
    <ul className="findings">
      {sorted.map((f, i) => (
        <li key={`${f.code}-${i}`} className={`finding finding--${f.severity}`}>
          <span className="badge">{f.severity}</span>
          <div>
            <strong>
              {f.code === 'prompt_injection' ? '⚠ ' : ''}
              {humanize(f.code)}
            </strong>
            <span className="finding__guard"> · {f.guard} guard</span>
            <p>{f.message}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
