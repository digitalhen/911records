import Link from 'next/link';
import { CitationLink } from './CitationLink';
import { FollowUpForm } from './FollowUpForm';
import { pageImagePath } from '@/lib/files';
import { SaveToCaseButton } from '@/components/case/SaveToCaseButton';
import { AiMark, ButtonLink, Panel, PanelBody } from '@/components/ui';
import type { AskAnswer } from '@/lib/ask/answer';

/** A page this answer cited, or was retrieved for — the minimal shape
 *  AnswerBody/InsufficientView need, satisfied by both lib/ask/retrieve.ts's
 *  RetrievedPage (live turn) and lib/ask/store.ts's StoredCite (permalink). */
export interface CiteLike {
  doc: string;
  page: number;
  batesPage: string;
  agency: string | null;
  volume: string | null;
  box: string | null;
  folder: string | null;
}

/** /ask's fallback link when a note is worth carrying to /search (docs/PLAN.md
 *  degrade-to-search behavior: no key, rate-limited, over the daily cap, a
 *  failed model call, or a Bates number with no match). */
export function searchFallbackUrl(q: string, note?: string): string {
  const params = new URLSearchParams({ q });
  if (note) params.set('note', note);
  return `/search?${params.toString()}`;
}

export function docHref(doc: string, page: number, hl?: string): string {
  const base = page > 1 ? `/doc/${doc}/p/${page}` : `/doc/${doc}`;
  return hl ? `${base}?hl=${encodeURIComponent(hl)}` : base;
}

export function citationLabel(p: { folder: string | null; box: string | null }): string {
  return [p.folder, p.box ? `Box ${p.box}` : null].filter(Boolean).join(' · ') || 'City record';
}

/** The shared machine-note strip every Ask output carries (docs/PLAN.md rule 2:
 *  never claim the AI can't be wrong; the page image is the authority — no
 *  "verified"/"hallucination-free" language, no AI badge aesthetic). */
export function MachineNote() {
  return (
    <div className="machine-note">
      <strong>
        Machine-written summary <AiMark />
      </strong>
      <span>Verify against the cited pages. This can misread scans and OCR — the page image is the authority.</span>
    </div>
  );
}

export function SourceRail({ pages, q, emptyNote }: { pages: CiteLike[]; q: string; emptyNote?: string }) {
  const docCount = new Set(pages.map((p) => p.doc)).size;
  return (
    <aside className="source-rail">
      <h2>
        Pages read <span className="count">{pages.length}</span>
      </h2>
      <p>
        {docCount} document{docCount === 1 ? '' : 's'}
        {emptyNote ? ` · ${emptyNote}` : ' · every cited page is listed here'}.
      </p>
      {pages.slice(0, 12).map((p) => (
        <div className="source-item" key={p.batesPage}>
          <h3>{citationLabel(p)}</h3>
          <a className="bates" href={docHref(p.doc, p.page)}>
            {p.batesPage} ↗
          </a>
          <div className="mt-2">
            <SaveToCaseButton
              small
              item={{ doc: p.doc, page: p.page, batesPage: p.batesPage, label: p.folder || p.doc, box: p.box, agency: p.agency, volume: p.volume }}
            />
          </div>
        </div>
      ))}
      <ButtonLink variant="secondary" href={searchFallbackUrl(q)} className="mt-5">
        View document results →
      </ButtonLink>
    </aside>
  );
}

/** One ancestor turn in a follow-up thread (B17, issue #23), rendered
 *  compactly above the current answer on /a/[id]: the question asked and
 *  the first sentence of what was answered, linking to that turn's own
 *  frozen permalink so the thread stays independently shareable turn by
 *  turn. */
export function PriorTurn({ id, q, firstSentence }: { id: string; q: string; firstSentence: string }) {
  return (
    <Panel className="mb-4">
      <PanelBody>
        <p className="small muted mb-2">Earlier in this thread</p>
        <Link href={`/a/${id}`} className="question-link">
          <span>
            {q}
            {firstSentence ? ` — ${firstSentence}` : ''}
          </span>
          <span>→</span>
        </Link>
      </PanelBody>
    </Panel>
  );
}

/** The rendered answer body — used both by the live /ask turn and the frozen
 *  /a/[id] permalink, so the two never drift apart. `answerId` (B17) is this
 *  turn's own stored id, so the "Ask a follow-up" box under it can thread a
 *  new turn on — /a/[id] is the only caller and always has one. */
export function AnswerBody({
  q,
  answer,
  pages,
  answerId,
}: {
  q: string;
  answer: AskAnswer;
  pages: CiteLike[];
  answerId: string;
}) {
  const byBates = new Map(pages.map((p) => [p.batesPage, p]));
  const citedPages = [
    ...new Map(answer.sentences.flatMap((s) => s.cites).map((c) => [c, byBates.get(c)])).values(),
  ].filter((p): p is CiteLike => !!p);

  return (
    <div className="answer-grid">
      <article className="answer-main summary-rule">
        <MachineNote />
        <h1>{q}</h1>
        <div className="citation-rule">
          <b>If a sentence has no page citation, it is not in the records.</b>
          <br />
          This summary can misread scans and OCR. The page is the authority. Unsupported answer sentences are not
          shown.
        </div>
        <div className="answer-copy">
          {answer.sentences.map((s, i) => (
            <p key={i}>
              {s.text}{' '}
              {s.cites.map((c) => {
                const p = byBates.get(c);
                if (!p) return null;
                return (
                  <CitationLink
                    key={c}
                    batesPage={c}
                    href={docHref(p.doc, p.page)}
                    thumbSrc={pageImagePath(p.agency || '', p.volume || '', p.doc, p.page, true)}
                    label={citationLabel(p)}
                  />
                );
              })}
            </p>
          ))}
        </div>
        {answer.notEstablished.length > 0 && (
          <section className="limits">
            <h2>What these records do not establish</h2>
            <ul>
              {answer.notEstablished.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </section>
        )}
        <section className="followup">
          {answer.followUps.length > 0 && (
            <>
              <h2>Continue from the evidence</h2>
              {answer.followUps.map((f, i) => (
                <Link key={i} className="question-link" href={`/ask?q=${encodeURIComponent(f)}`}>
                  {f} <AiMark /> <span>→</span>
                </Link>
              ))}
            </>
          )}
          <FollowUpForm parentId={answerId} />
          <Link className="question-link mt-2" href={searchFallbackUrl(q)}>
            See every document result instead <span>→</span>
          </Link>
        </section>
      </article>
      <SourceRail pages={citedPages} q={q} />
    </div>
  );
}
