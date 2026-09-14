'use client';

import { forwardRef, type ReactNode } from 'react';
import { Button } from './Button';

export interface DialogAction {
  label: string;
  onClick: () => void;
}

/**
 * Dialog — native <dialog>, styled by the design system. Exports (CSV etc.)
 * are copy-first: `primaryAction` renders as the primary button (Copy),
 * `secondaryAction` as a plain secondary button (Download), per BRIEF.md.
 */
export const Dialog = forwardRef<HTMLDialogElement, {
  id?: string;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  primaryAction?: DialogAction;
  secondaryAction?: DialogAction;
  onRequestClose?: () => void;
}>(function Dialog({ id, title, description, children, primaryAction, secondaryAction, onRequestClose }, ref) {
  return (
    <dialog ref={ref} id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <h2 id={id ? `${id}-title` : undefined}>{title}</h2>
      {description && <p>{description}</p>}
      {children}
      <div className="actions mt-3">
        {primaryAction && (
          <Button variant="primary" type="button" onClick={primaryAction.onClick}>
            {primaryAction.label}
          </Button>
        )}
        {secondaryAction && (
          <Button variant="secondary" type="button" onClick={secondaryAction.onClick}>
            {secondaryAction.label}
          </Button>
        )}
        <Button
          variant="secondary"
          type="button"
          onClick={
            onRequestClose ||
            ((e) => {
              e.currentTarget.closest('dialog')?.close();
            })
          }
        >
          Close
        </Button>
      </div>
    </dialog>
  );
});
