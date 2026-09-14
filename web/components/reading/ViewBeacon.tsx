'use client';
// Fires once per document-page load, feeding app.doc_views (B22, issue #36).
// navigator.sendBeacon: no cookies, fire-and-forget, safe on unmount/nav.
// Renders nothing. See app/api/v/route.ts for what happens with the doc id.
import { useEffect } from 'react';

export function ViewBeacon({ doc }: { doc: string }) {
  useEffect(() => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon('/api/v', doc);
      }
    } catch {
      // best-effort counter; never let this affect the page
    }
    // Intentionally fires once per mount (once per page load) — not on every
    // re-render, and not repeated for the same `doc`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default ViewBeacon;
