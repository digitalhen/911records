'use client';

import { useCaseFolder } from '@/lib/case/useCaseFolder';

/** Nav badge next to "Case folder" (docs/PLAN.md B6: "the nav's 'Case
 *  folder' shows a count badge"). Renders nothing until hydration has read
 *  localStorage, and nothing at all when the folder is empty, matching
 *  design/astra's `.count` styling already in globals.css. */
export function CaseCountBadge() {
  const { count } = useCaseFolder();
  if (!count) return null;
  return <span className="count">{count}</span>;
}
