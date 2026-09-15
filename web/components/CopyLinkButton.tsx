'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui';
import { requestShortlink } from '@/lib/shortlinks/client';

/** Copy a short link preserving the current query and anchor, with a full-URL fallback. */
export function useCopyCurrentLink() {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const copy = async () => {
    if (pending) return;
    setPending(true);
    let link = window.location.href;
    let shortened = false;
    try {
      link = await requestShortlink(window.location.pathname + window.location.search + window.location.hash);
      shortened = true;
    } catch { /* Keep the full URL available when the shortlink service is down. */ }
    try {
      await navigator.clipboard.writeText(link);
      setMessage(window.location.pathname === '/case' ? 'Link copied. Your saved case contents stay in this browser.' : shortened ? 'Short link copied.' : 'Full link copied; shortlink unavailable.');
    } catch {
      window.prompt('Copy this link:', link);
      setMessage('');
    } finally { setPending(false); }
  };
  return { copy, message, pending };
}

/** The button + note as used today on /search and /changes. `note` lets a
 *  caller replace the default "no email alerts yet" copy once that changes;
 *  `children` is a slot for whatever the alerts feature adds alongside it
 *  (an email field, a frequency picker) without needing a new component. */
export function CopyLinkButton({
  label = 'Copy link to this search',
  note,
  children,
}: {
  label?: string;
  note?: string;
  children?: ReactNode;
}) {
  const { copy, message } = useCopyCurrentLink();
  return (
    <div className="mt-4">
      <Button variant="secondary" type="button" onClick={copy}>
        {label}
      </Button>
      {children}
      <p className="small muted mt-2" role="status">
        {message || note || 'Email alerts are not offered yet — copy this link to check back after a new release.'}
      </p>
    </div>
  );
}
