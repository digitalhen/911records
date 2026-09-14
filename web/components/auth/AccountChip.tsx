'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/auth/client';
import { setAccountUser } from '@/lib/case/store';

/** The header's account affordance (issue #21): "Sign in" when signed out,
 *  the account's email when signed in — both link to /account, which holds
 *  the actual sign-in form / session controls. This is also the one place
 *  that tells lib/case/store.ts the session changed, so case-folder sync
 *  (pull-and-merge on sign-in) fires without every case-folder caller
 *  needing to know accounts exist. Mounted once in components/Header.tsx,
 *  so it runs on every page. */
export function AccountChip() {
  const { data, isPending } = useSession();
  const userId = data?.user?.id ?? null;

  useEffect(() => {
    if (isPending) return;
    void setAccountUser(userId);
  }, [isPending, userId]);

  // Renders as one more link inside <nav className="nav"> (components/Header.tsx)
  // so it picks up the existing nav-link styling with no new CSS needed —
  // see NOTES-B19.md for the small dedicated style the coordinator may want
  // instead (right-aligned, visually distinct from the section links).
  if (isPending) return null;

  if (!data?.user) {
    return <Link href="/account">Sign in</Link>;
  }

  return (
    <Link href="/account" title="Account settings">
      {data.user.email}
    </Link>
  );
}
