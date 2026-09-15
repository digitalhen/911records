'use client';
import { useState } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { requestShortlink } from '@/lib/shortlinks/client';

export function CopySearch() {
  const [q, setQ] = useState('');
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  return (
    <form
      className="stack-sm mt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const target = `/search?q=${encodeURIComponent(q.trim())}`;
        let link = `${window.location.origin}${target}`;
        try { link = await requestShortlink(target); } catch { /* Full URL fallback. */ }
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
