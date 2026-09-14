'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui';

/** "Copy link to this search" (docs/PLAN.md B6 Part 2: saved-search alerts
 *  as copy-a-link only — no accounts, no email delivery in v1).
 *
 *  Extension point: Henry's 2026-09-14 direction is that a real alerts
 *  feature (emailed on a saved search, once accounts exist) comes later.
 *  This hook is the reusable half — it just copies the current URL — so
 *  that feature can build its own control on top of it (e.g. a form that
 *  copies the link *and* offers to email it) without forking this file. */
export function useCopyCurrentLink() {
  const [message, setMessage] = useState('');
  const copy = async () => {
    const link = window.location.href;
    try {
      await navigator.clipboard.writeText(link);
      setMessage('Link copied.');
    } catch {
      window.prompt('Copy this link:', link);
      setMessage('');
    }
  };
  return { copy, message };
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
