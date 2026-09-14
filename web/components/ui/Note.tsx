import type { ReactNode } from 'react';

export type CalloutTone = 'plain' | 'info' | 'error';

/**
 * Callout — generalizes the astra `.note` / `.coverage` / `.provenance` /
 * `.error-note` blocks into one component with a consistent tone set.
 */
export function Callout({
  tone = 'plain',
  title,
  children,
  role,
  className,
  id,
}: {
  tone?: CalloutTone;
  title?: ReactNode;
  children: ReactNode;
  role?: string;
  className?: string;
  id?: string;
}) {
  return (
    <div id={id} className={['callout', `callout-${tone}`, className].filter(Boolean).join(' ')} role={role}>
      {title && <h3>{title}</h3>}
      {children}
    </div>
  );
}

/** Note — alias kept for call sites that read better as "a note", same component. */
export const Note = Callout;
