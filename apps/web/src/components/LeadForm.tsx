import { LEAD_MESSAGE_MAX, LEAD_MESSAGE_MIN } from '@contracts/limits';
import { useId, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { samples } from '../samples';
import type { LeadDraft, QualificationResult } from '../types';

const EMPTY: LeadDraft = { name: '', email: '', company: '', website: '', message: '' };

type Field = keyof LeadDraft;
const FIELDS: Array<{ name: Field; label: string; type?: string; optional?: boolean }> = [
  { name: 'name', label: 'Name' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'company', label: 'Company', optional: true },
  { name: 'website', label: 'Website', optional: true },
];

/** Optional fields left empty are omitted, so the API applies its own rules. */
function toRequest(draft: LeadDraft) {
  return Object.fromEntries(Object.entries(draft).filter(([, v]) => v.trim() !== '')) as LeadDraft;
}

export function LeadForm({ onResult }: { onResult: (result: QualificationResult) => void }) {
  const formId = useId();
  const [draft, setDraft] = useState<LeadDraft>(EMPTY);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);

  const update = (field: Field, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    setFieldErrors((e) => ({ ...e, [field]: undefined }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      onResult(await api.qualify(toRequest(draft)));
    } catch (err) {
      if (err instanceof ApiError && err.details.length > 0) {
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
        setError('Please fix the highlighted fields.');
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setPending(false);
    }
  }

  const length = draft.message.trim().length;
  return (
    <form
      className="card form"
      onSubmit={(event) => void submit(event)}
      aria-busy={pending}
      noValidate
    >
      <div className="samples">
        <span className="samples__label">Try a sample:</span>
        {samples.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`chip ${s.attack ? 'chip--attack' : ''}`}
            onClick={() => {
              setDraft(s.lead);
              setFieldErrors({});
              setError(null);
            }}
            disabled={pending}
          >
            {s.attack ? '⚠ ' : ''}
            {s.label}
          </button>
        ))}
      </div>

      <div className="form__grid">
        {FIELDS.map((f) => {
          const id = `${formId}-${f.name}`;
          return (
            <div key={f.name} className="field">
              <label htmlFor={id}>
                {f.label}
                {f.optional && <small> (optional)</small>}
              </label>
              <input
                id={id}
                name={f.name}
                type={f.type ?? 'text'}
                value={draft[f.name]}
                onChange={(e) => update(f.name, e.target.value)}
                aria-invalid={Boolean(fieldErrors[f.name])}
                aria-describedby={fieldErrors[f.name] ? `${id}-error` : undefined}
              />
              {fieldErrors[f.name] && (
                <span className="field__error" id={`${id}-error`}>
                  {fieldErrors[f.name]}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="field">
        <label htmlFor={`${formId}-message`}>Message</label>
        <textarea
          id={`${formId}-message`}
          name="message"
          rows={6}
          value={draft.message}
          onChange={(e) => update('message', e.target.value)}
          aria-invalid={Boolean(fieldErrors.message)}
          aria-describedby={`${formId}-message-hint`}
        />
        <span className="field__hint" id={`${formId}-message-hint`}>
          {fieldErrors.message ??
            `${length} / ${LEAD_MESSAGE_MAX} characters (min ${LEAD_MESSAGE_MIN})`}
        </span>
      </div>

      {error && (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      )}

      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={pending}>
          {pending ? 'Agent is analysing the lead…' : 'Qualify lead'}
        </button>
        <button type="button" className="button" onClick={() => setDraft(EMPTY)} disabled={pending}>
          Clear
        </button>
      </div>
    </form>
  );
}
