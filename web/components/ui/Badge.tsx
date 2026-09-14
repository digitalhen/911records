import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'blue' | 'green' | 'red' | 'amber';

/** Badge — small status/type label (e.g. "removed", "redacted", collection tag). */
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={['badge', tone !== 'neutral' ? `badge-${tone}` : ''].filter(Boolean).join(' ')}>{children}</span>;
}

/**
 * Marker — the standard "machine-extracted" label required on every derived
 * value (dates, addresses, contaminants, readings, topic names, etc). Links
 * to a page that explains extraction; never claims the value is verified.
 */
export function Marker({ href, label = 'Machine-extracted' }: { href?: string; label?: string }) {
  const content = href ? <a href={href}>{label}</a> : label;
  return <span className="marker">{content}</span>;
}
