'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { authClient, useSession } from '@/lib/auth/client';
import { Button, Callout, Dialog, EmptyState, Field, Input, Toast, useToast } from '@/components/ui';

interface SavedSearch {
  id: string;
  label: string;
  params: string;
  createdAt: string;
  lastCheckedAt: string | null;
  lastSeenCount: number;
}

function SignInForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    setError('');
    const { error: err } = await authClient.signIn.magicLink({ email, callbackURL: '/account' });
    if (err) {
      setState('error');
      setError(err.message || 'Could not send a sign-in link. Try again.');
      return;
    }
    setState('sent');
  }

  if (state === 'sent') {
    return (
      <Callout title="Check your email" tone="info">
        <p>
          We sent a sign-in link to <strong>{email}</strong>. It expires in an hour. No password is ever needed — a
          fresh link works every time you come back.
        </p>
      </Callout>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <Field label="Email address" htmlFor="account-email" error={state === 'error' ? error : undefined}>
        <Input
          id="account-email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Button variant="primary" type="submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Send sign-in link'}
      </Button>
      <p className="small muted mt-2">
        No password, ever — we email a one-time link. We only ever use this address to sign you in and, if you save a
        search, to tell you about new matches.
      </p>
    </form>
  );
}

function SavedSearches() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const { show, message } = useToast();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/saved-searches')
      .then((r) => r.json())
      .then((body: { searches?: SavedSearch[] }) => {
        if (cancelled) return;
        setSearches(body.searches || []);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function remove(id: string) {
    setSearches((prev) => prev.filter((s) => s.id !== id));
    try {
      await fetch(`/api/saved-searches/${id}`, { method: 'DELETE' });
      show('Saved search removed.');
    } catch {
      show('Could not remove that saved search — reload and try again.');
    }
  }

  if (state === 'loading') return <p className="small muted">Loading saved searches…</p>;
  if (state === 'error') return <p className="small muted">Saved searches are temporarily unavailable.</p>;
  if (!searches.length) {
    return (
      <p className="small muted">
        No saved searches yet. Use "Save this search" on any <Link href="/search">search results page</Link>.
      </p>
    );
  }

  return (
    <>
      <ul className="plain-list">
        {searches.map((s) => (
          <li key={s.id} className="saved-search-row">
            <Link href={`/search?${s.params}`}>{s.label}</Link>
            <Button variant="quiet" size="small" type="button" onClick={() => remove(s.id)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <p className="small muted mt-2">
        A daily digest of new matches is not sent yet — this list is what it will check first (Henry's v1 note:
        web/scripts/digest.ts computes and prints what it would send).
      </p>
      <Toast message={message} />
    </>
  );
}

function SignedIn({ email }: { email: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);

  async function signOut() {
    await authClient.signOut();
    window.location.href = '/';
  }

  async function confirmDelete() {
    setBusy(true);
    const { error } = await authClient.deleteUser();
    if (error) {
      setBusy(false);
      window.alert(error.message || 'Could not delete your account. Try again.');
      return;
    }
    window.location.href = '/';
  }

  return (
    <>
      <p>
        Signed in as <strong>{email}</strong>.
      </p>
      <div className="actions mb-6">
        <Button variant="secondary" type="button" onClick={signOut}>
          Sign out
        </Button>
        <Button variant="secondary" type="button" onClick={() => dialogRef.current?.showModal()}>
          Delete account
        </Button>
      </div>

      <h2>Case folder</h2>
      <p>
        Your saved pages are synced to this account and available on any device you sign into.{' '}
        <Link href="/case">Open your case folder →</Link>
      </p>

      <h2 className="mt-6">Saved searches</h2>
      <SavedSearches />

      <Dialog
        ref={dialogRef}
        id="delete-account-dialog"
        title="Delete your account?"
        description="This permanently deletes your account, your synced case folder and your saved searches. Anything still saved only in this browser's local storage is not affected. This cannot be undone."
        primaryAction={{ label: busy ? 'Deleting…' : 'Delete account', onClick: confirmDelete }}
      />
    </>
  );
}

export function AccountPanel() {
  const { data, isPending } = useSession();

  if (isPending) return <p className="small muted">Loading…</p>;
  if (data?.user) return <SignedIn email={data.user.email} />;

  return (
    <>
      <SignInForm />
      <div className="mt-6">
        <EmptyState compact title="Why sign in?">
          <p>Sign in to sync your case folder across devices and save searches for a daily digest of new matches.</p>
        </EmptyState>
      </div>
    </>
  );
}
