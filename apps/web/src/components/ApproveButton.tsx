import { useState } from 'react';
import { api, ApiError } from '../api';
import type { LeadRecord } from '../types';

export function ApproveButton({
  leadId,
  onApproved,
}: {
  leadId: string;
  onApproved: (record: LeadRecord) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setPending(true);
    setError(null);
    try {
      onApproved(await api.approve(leadId));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Already handled: refresh to see the current status.'
          : err instanceof Error
            ? err.message
            : String(err),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="approve">
      <button
        type="button"
        className="button button--primary"
        onClick={() => void approve()}
        disabled={pending}
      >
        {pending ? 'Approving…' : 'Approve'}
      </button>
      {error && (
        <span className="field__error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
