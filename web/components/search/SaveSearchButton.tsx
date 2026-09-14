'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/auth/client';
import { Button } from '@/components/ui';

/** "Save this search" (issue #21 / docs/PLAN.md Accounts): a real,
 *  account-backed alert list, replacing the copy-a-link-only v1 note next
 *  to it (components/CopyLinkButton.tsx, passed this as its `children`
 *  slot per that file's own extension-point comment). Saved searches show
 *  up on /account; web/scripts/digest.ts is the (stubbed, not yet emailing)
 *  daily check for new matches. */
export function SaveSearchButton({ label, params }: { label: string; params: string }) {
  const { data, isPending } = useSession();
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState('');

  if (isPending) return null;

  if (!data?.user) {
    return (
      <p className="small muted mt-2">
        <Link href="/account">Sign in</Link> to save this search and get a daily digest of new matches.
      </p>
    );
  }

  async function save() {
    setState('saving');
    try {
      const res = await fetch('/api/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, params }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || 'Could not save this search');
      setState('saved');
      setMessage('Saved. Manage saved searches on your account page.');
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Could not save this search');
    }
  }

  return (
    <div className="mt-2">
      <Button variant="secondary" size="small" type="button" onClick={save} disabled={state === 'saving' || state === 'saved'}>
        {state === 'saved' ? 'Search saved ✓' : 'Save this search'}
      </Button>
      {message && (
        <p className="small muted mt-1" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
