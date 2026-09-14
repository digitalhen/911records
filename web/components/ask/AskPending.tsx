'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Pending state for the Ask forms. Answers take ~10–25 s (two model calls plus
 * retrieval) and the forms are plain GET navigations, so without this the page
 * looks dead after submit. Mount inside the form: it listens to the form's own
 * submit event, disables the submit button, and shows the design's "reading
 * records" line. Progressive enhancement — the form works without JS.
 */
export function AskPending() {
  const anchor = useRef<HTMLSpanElement>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const form = anchor.current?.closest('form');
    if (!form) return;
    const onSubmit = () => {
      setPending(true);
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    };
    form.addEventListener('submit', onSubmit);
    const onShow = () => { setPending(false); const b = form.querySelector<HTMLButtonElement>('button[type="submit"]'); if (b) { b.disabled = false; b.removeAttribute('aria-busy'); } };
    window.addEventListener('pageshow', onShow);
    return () => { form.removeEventListener('submit', onSubmit); window.removeEventListener('pageshow', onShow); };
  }, []);
  return (
    <span ref={anchor} className="ask-pending" role="status" aria-live="polite">
      {pending ? 'Reading the records — a cited answer takes about 20 seconds. Questions are answered from the pages; a Bates number or plain keywords open instantly.' : ''}
    </span>
  );
}
