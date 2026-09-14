'use client';

import { Button } from '@/components/ui';

export function CiteButton({ citation }: { citation: string }) {
  return (
    <Button
      variant="primary"
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
    </Button>
  );
}
