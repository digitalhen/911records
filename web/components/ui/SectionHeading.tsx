import type { ReactNode } from 'react';

/** SectionHeading — eyebrow + title, the recurring "section head" pattern. */
export function SectionHeading({
  eyebrow,
  title,
  action,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={['section-heading', action ? 'section-head' : '', className].filter(Boolean).join(' ')}>
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}
