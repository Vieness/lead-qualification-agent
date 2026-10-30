import type { ScoreBreakdownItem } from '../types';
import { humanize } from '../labels';

export function ScoreBreakdown({ items }: { items: ScoreBreakdownItem[] }) {
  if (items.length === 0) return <p className="muted">Not scored.</p>;
  return (
    <ul className="breakdown">
      {items.map((item) => (
        <li key={item.rule}>
          <div className="breakdown__row">
            <span className="breakdown__rule">{humanize(item.rule)}</span>
            <span className="breakdown__points">
              {item.points}/{item.max}
            </span>
          </div>
          <div
            className="bar"
            role="meter"
            aria-label={humanize(item.rule)}
            aria-valuemin={0}
            aria-valuemax={item.max}
            aria-valuenow={item.points}
          >
            <span style={{ width: `${(item.points / item.max) * 100}%` }} />
          </div>
          <p className="breakdown__reason">{item.reason}</p>
        </li>
      ))}
    </ul>
  );
}
