'use client';
import { useState } from 'react';
import { Button, Field, Input, Textarea } from '@/components/ui';

export function ReportForm({ bates = '' }: { bates?: string }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      action="/api/report"
      method="post"
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage('');
        const form = e.currentTarget;
        try {
          const response = await fetch('/api/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.fromEntries(new FormData(form))),
          });
          const result = await response.json();
          if (!response.ok) setMessage(result.error || 'Report could not be saved. Please try again.');
          else {
            setMessage(`Report received. Reference: ${result.id}. Keep this reference; no email address is collected.`);
            form.reset();
          }
        } catch {
          setMessage('Report could not be saved. Please try again, or report it through the City’s official portal.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Bates page" htmlFor="report-bates">
        <Input id="report-bates" name="bates" defaultValue={bates} placeholder="NYC-WTC_000058160" pattern="NYC-WTC_[0-9]{9}" maxLength={17} required />
      </Field>
      <Field label="Location on the page" htmlFor="report-location">
        <Input id="report-location" name="location" placeholder="For example: lower-right corner, signature line" maxLength={500} required />
      </Field>
      <Field label="Note" htmlFor="report-note">
        <Textarea id="report-note" name="note" placeholder="Describe the kind of information and your concern. Do not repeat private details." maxLength={4000} required />
      </Field>
      <Button variant="primary" disabled={busy} type="submit">
        {busy ? 'Sending…' : 'Send report'}
      </Button>
      <p role="status" aria-live="polite" className="small">
        {message}
      </p>
    </form>
  );
}
