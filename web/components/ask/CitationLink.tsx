'use client';

import { useRef, useState } from 'react';

/**
 * One inline citation on an answer permalink (design/astra/answer.html's
 * `.citation` links). Hover/tap reveals a `.source-peek` panel (styles
 * already in globals.css) with the page's thumbnail image — a coarse stand-
 * in for a tight crop around the cited span, which would need the excerpt's
 * character offsets matched against the page's word boxes (lib/boxes.ts);
 * left as a follow-up, noted in web/NOTES-B3.md.
 */
export function CitationLink({
  batesPage,
  href,
  thumbSrc,
  label,
}: {
  batesPage: string;
  href: string;
  thumbSrc: string;
  label: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  function show(): void {
    const el = ref.current;
    if (!el || typeof window === 'undefined') return;
    const r = el.getBoundingClientRect();
    const panelWidth = 470;
    setPos({ top: r.bottom + 8, left: Math.max(12, Math.min(r.left, window.innerWidth - panelWidth - 12)) });
  }
  function hide(): void {
    setPos(null);
  }

  return (
    <>
      <a
        ref={ref}
        className="citation"
        href={href}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={hide}
        aria-label={`Open Bates page ${batesPage}`}
      >
        [{batesPage.replace(/^NYC-WTC_/, '')}] ↗
      </a>
      {pos && (
        <span className="source-peek" role="tooltip" style={{ top: pos.top, left: pos.left }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbSrc} alt={`Page thumbnail, ${batesPage}`} />
          <span className="small muted block mt-2">{label}</span>
        </span>
      )}
    </>
  );
}
