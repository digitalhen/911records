'use client';
import { useState } from 'react';
import { Button, Field, Input } from '@/components/ui';

export function CopySearch() {
  const [q, setQ] = useState('');
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  return (
    <form
      className="stack-sm mt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const link = `${window.location.origin}/search?q=${encodeURIComponent(q.trim())}`;
        setUrl(link);
        try {
          await navigator.clipboard.writeText(link);
          setMessage('Search link copied.');
        } catch {
          setMessage('Select and copy the link below.');
        }
      }}
    >
      <Field label="Search to revisit" htmlFor="saved-query">
        <Input id="saved-query" value={q} onChange={(e) => setQ(e.target.value)} required maxLength={500} placeholder="Liberty Street asbestos" />
      </Field>
      <Button variant="secondary" type="submit">
        Copy search link
      </Button>
      {url && <Input aria-label="Search link" readOnly value={url} onFocus={(e) => e.target.select()} />}
      <p role="status" className="small">
        {message}
      </p>
      <p className="small muted">Copy this link to check again after a capture. No email alerts or automatic notifications.</p>
    </form>
  );
}
