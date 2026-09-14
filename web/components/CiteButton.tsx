'use client';

export function CiteButton({ citation }: { citation: string }) {
  return (
    <button
      className="button primary"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(citation);
          window.alert('Citation copied.');
        } catch {
          window.prompt('Copy this citation:', citation);
        }
      }}
    >
      Cite this page ↗
    </button>
  );
}
