import type { ReactNode } from 'react';

/** Panel — bordered surface for grouped content. No shadows, no gradients. */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={['panel', className].filter(Boolean).join(' ')}>{children}</section>;
}

export function PanelHeader({
  title,
  action,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={['panel-header', className].filter(Boolean).join(' ')}>
      <h2>{title}</h2>
      {action}
    </header>
  );
}

export function PanelBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={['panel-body', className].filter(Boolean).join(' ')}>{children}</div>;
}
