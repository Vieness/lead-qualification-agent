import { useState } from 'react';
import type { DraftReply as Draft } from '../types';

export function DraftReply({ draft }: { draft: Draft | null }) {
  const [copied, setCopied] = useState(false);
  if (!draft) return <p className="muted">No draft was written for this lead.</p>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${draft?.subject}\n\n${draft?.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied (permissions, insecure context): the text stays selectable
    }
  }

  return (
    <div className="draft">
      <div className="draft__header">
        <span>
          <span className="badge">{draft.language.toUpperCase()}</span>{' '}
          <strong>{draft.subject}</strong>
        </span>
        <button type="button" className="button button--small" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="draft__body">{draft.body}</pre>
    </div>
  );
}
