import type { ReactNode } from 'react';

/**
 * EmptyState — no-results / 404 / gone pages. Heavy top rule, plain copy,
 * optional actions. `compact` uses an h2 (20px) instead of the page-level
 * h1 (36px) for inline empty states nested inside an otherwise populated
 * page (e.g. a search results list), where a full page-title rule reads
 * too heavy.
 */
export function EmptyState({
  eyebrow,
  title,
  children,
  actions,
  compact = false,
}: {
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}) {
  const Heading = compact ? 'h2' : 'h1';
  return (
    <div className={['empty-state', compact ? 'empty-state-compact' : ''].filter(Boolean).join(' ')}>
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <Heading>{title}</Heading>
      {children}
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}
