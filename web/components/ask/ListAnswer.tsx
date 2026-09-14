import Link from 'next/link';
import { AiMark } from '@/components/ui';
import { ListTable } from './ListTable';
import { WhatOthersAreReading } from '@/components/reading/WhatOthersAreReading';
import { FollowUpForm } from './FollowUpForm';
import { searchFallbackUrl } from './shared';
import type { ListResult } from '@/lib/ask/lists';
import styles from './ask.module.css';

/** The "list" plan-kind's answer body (B21, issue #35) — a machine-extracted table instead of a
 *  written, cited paragraph. Used both by the live /ask turn (when it has rows) and the frozen
 *  /a/[id] permalink, so the two never drift apart, matching AnswerBody's own convention. Nothing
 *  here was WRITTEN by the model — only the query plan was; the rows are deterministic SQL over
 *  machine-extracted fields (place_pages/entity_pages/signatories), so the sparkle marks the Ask
 *  flow itself, not the row values (COMMON-web.md: model-derived VALUES get a plain
 *  "machine-extracted" label, never the sparkle). */
export function ListAnswer({ q, result, answerId }: { q: string; result: ListResult; answerId: string }) {
  return (
    <div className="answer-grid">
    <article className="answer-main summary-rule">
      <div className="machine-note">
        <strong>
          Table from the records <AiMark />
        </strong>
        <span>
          {result.title} — every value is machine-extracted from the source pages, not written by a model. Verify
          against the linked pages; this can misread scans and OCR.
        </span>
      </div>
      <h1>{q}</h1>
      <p className="small muted mb-4">
        {result.rows.length} row{result.rows.length === 1 ? '' : 's'} · each name and count links to its source
        pages.
      </p>
      <ListTable rows={result.rows} extraColumnLabels={result.extraColumnLabels} truncated={result.truncated} />
      <section className="followup mt-5">
        <FollowUpForm parentId={answerId} />
        <Link className={`${styles.chip} mt-2`} href={searchFallbackUrl(q)}>
          See every document result instead <span>→</span>
        </Link>
      </section>
    </article>
    <aside className="source-rail"><WhatOthersAreReading /></aside>
    </div>
  );
}
