'use client';
import { useState } from 'react';
import { Button, Field, Textarea } from '@/components/ui';

export function SubmissionForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  return <form action="/api/contradictions" method="post" className="stack" onSubmit={async event => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true); setMessage(''); setFailed(false);
    try {
      const response = await fetch('/api/contradictions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))), signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (!response.ok) { setFailed(true); setMessage(result.error || 'Submission could not be saved. Please try again.'); }
      else { setMessage(`Submission received for review. Reference: ${result.id}. Keep this reference. Nothing has been published.`); form.reset(); }
    } catch { setFailed(true); setMessage('We could not confirm receipt. Please try again; your text is still in the form.'); }
    finally { setBusy(false); }
  }}>
    <Field label="What are you submitting?" htmlFor="comparison-kind">
      <select id="comparison-kind" name="kind" defaultValue="suggestion" required style={{ padding: 10, font: 'inherit', width: '100%' }}>
        <option value="suggestion">Suggest a comparison</option>
        <option value="correction">Correct an existing comparison</option>
      </select>
    </Field>
    <Field label="Source links or Bates pages" htmlFor="comparison-sources">
      <Textarea id="comparison-sources" name="sources" required maxLength={2000} rows={3} placeholder="Link to the records or official statements. For a correction, include the comparison you mean." />
    </Field>
    <Field label="What should we look at?" htmlFor="comparison-note">
      <Textarea id="comparison-note" name="note" required minLength={10} maxLength={6000} rows={6} placeholder="Describe the comparison or correction, including relevant dates, wording, and context. Do not include private personal information." />
    </Field>
    <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit for review'}</Button>
    <p role={failed ? 'alert' : 'status'} aria-live="polite" className="small">{message}</p>
  </form>;
}
