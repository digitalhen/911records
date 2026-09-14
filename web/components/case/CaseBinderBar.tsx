'use client';

import Link from 'next/link';
import { useCaseFolder } from '@/lib/case/useCaseFolder';

/**
 * Compact case-binder bar (issue #32, item 2) — design/astra's sticky navy
 * `.binder` strip (results.html/answer.html), trimmed to what the real case
 * store actually has (a flat list of saved pages, no named "case file" or
 * lettered exhibits): current saved-page count and a link to /case. Reads
 * the same browser-local store as the nav's `CaseCountBadge` and `/case`
 * itself (`lib/case/useCaseFolder`), so it never drifts from either.
 */
export function CaseBinderBar() {
  const { count } = useCaseFolder();
  return (
    <div className="binder">
      <Link href="/case">
        <b>{count > 0 ? `Case folder · ${count} page${count === 1 ? '' : 's'} saved` : 'Case folder · no pages saved yet'}</b>
      </Link>
      <Link href="/case">Review case folder →</Link>
    </div>
  );
}
