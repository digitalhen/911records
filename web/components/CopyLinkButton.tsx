'use client';

import { useState } from 'react';

/** "Copy link to this search" (docs/PLAN.md B6 Part 2: saved-search alerts
 *  as copy-a-link only — no accounts, no email delivery in v1). Copies the
 *  current URL (query + filters already encoded in it by the page) so a
 *  visitor can bookmark or share it and re-run the same search later. */
export function CopyLinkButton({ label = 'Copy link to this search' }: { label?: string }) {
  const [message, setMessage] = useState('');
  return (
    <div style={{ marginTop: 14 }}>
      <button
        className="button"
        type="button"
        onClick={async () => {
          const link = window.location.href;
          try {
            await navigator.clipboard.writeText(link);
            setMessage('Link copied.');
          } catch {
            window.prompt('Copy this link:', link);
            setMessage('');
          }
        }}
      >
        {label}
      </button>
      <p className="small muted" style={{ marginTop: 6 }} role="status">
        {message || 'Email alerts are not offered yet — copy this link to check back after a new release.'}
      </p>
    </div>
  );
}
