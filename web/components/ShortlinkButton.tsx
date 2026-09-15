'use client';
import { useCopyCurrentLink } from './CopyLinkButton';

export function ShortlinkButton() {
  const { copy, message, pending } = useCopyCurrentLink();
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
    <button type="button" onClick={copy} disabled={pending} title="Copy a short link to this page" style={{ font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid currentColor', borderRadius: 4, padding: '4px 8px', cursor: 'pointer' }}>
      {pending ? 'Creating link…' : 'Copy short link'}
    </button>
    <span role="status" className="small muted">{message}</span>
  </span>;
}
