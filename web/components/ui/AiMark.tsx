/**
 * AiMark — the small sparkle placed on controls that invoke the model or
 * lead to a model-written answer (the "Ask →" button, "ask this as a
 * question" links, suggested questions, answer follow-ups, the
 * machine-written-summary heading). Henry, 2026-09-14: this overrides the
 * design brief's blanket ban on sparkle iconography for those controls
 * only — see web/DESIGN.md ("sparkle = a model will write or interpret
 * something"). Never place it on plain search/browse/document/building
 * links or on "machine-extracted" Marker labels — those are not
 * model-written.
 */
export function AiMark({ className }: { className?: string }) {
  return (
    <svg
      className={['ai-mark', className].filter(Boolean).join(' ')}
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-label="AI"
      role="img"
    >
      <path d="M8 0c.3 2.6 1 4.3 2.1 5.4C11.2 6.5 12.9 7.2 15.5 7.5c-2.6.3-4.3 1-5.4 2.1C8.9 10.7 8.2 12.4 8 15c-.3-2.6-1-4.3-2.1-5.4C4.7 8.5 3 7.8.5 7.5c2.6-.3 4.3-1 5.4-2.1C7 4.3 7.7 2.6 8 0z" />
    </svg>
  );
}
