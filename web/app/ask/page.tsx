import { WhatOthersAreReading } from '@/components/reading/WhatOthersAreReading';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SearchBox } from '@/components/SearchBox';
import { MachineNote, SourceRail, searchFallbackUrl } from '@/components/ask/shared';
import { SUGGESTED_QUESTIONS } from '@/lib/suggestedQuestions';
import { AiMark } from '@/components/ui';
import { getStr, type SearchParamsInput } from '@/lib/searchUrl';
import { socialMeta } from '@/lib/seo/social';
import { getPageByBates } from '@/lib/site';
import { findExactBates } from '@/lib/opensearch';
import { routeAsk } from '@/lib/ask/router';
import { askConfigured, planAsk, planFollowUp, ASK_MODEL, type AskPlan } from '@/lib/ask/plan';
import { retrieveForQuestion, type PageRef, type RetrievedPage } from '@/lib/ask/retrieve';
import { placePagesForQuestion } from '@/lib/ask/placeBoost';
import { answerQuestion, validateAnswer, validateFollowUps, type AskAnswer } from '@/lib/ask/answer';
import { runList } from '@/lib/ask/listExec';
import { underDailyCap, recordSpend, estimateCostUsd } from '@/lib/ask/spend';
import { allowAskRequest, clientIp } from '@/lib/ask/rateLimit';
import { FollowUpForm } from '@/components/ask/FollowUpForm';
import { saveAnswer, getAnswer, findRecentAnswer, markSuperseded, citedBatesPages, EMPTY_ASK_ANSWER } from '@/lib/ask/store';
import { Callout } from '@/components/ui';
import { EvidenceSummary } from '@/components/ask/EvidenceSummary';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  // Root layout's title template already appends " · 9/11 City Records".
  const title = 'Ask anything';
  const description = "Ask a question and get a cited answer from New York City's released 9/11 records.";
  return { title, description, robots: { index: false }, ...socialMeta(title, description, '/ask') };
}

function AskAgainForm({ q }: { q: string }) {
  return (
    <>
      <SearchBox q={q} compact />
      <p className="small muted mb-4">
        Questions get a cited answer built from the mirrored records. Keywords and Bates numbers go straight to
        search.
      </p>
    </>
  );
}


function OfftopicView({ q }: { q: string }) {
  const suggestions = SUGGESTED_QUESTIONS.slice(0, 3);
  return (
    <>
      <Header active="/ask" />
      <main id="main">
        <AskAgainForm q={q} />
        <article className="answer-main summary-rule">
          <MachineNote />
          <div className="citation-rule">
            <h2 className="mb-2">City records only</h2>
            <p>This tool answers only from the City&apos;s released 9/11 records. Try:</p>
          </div>
          <section className="followup">
            {suggestions.map((s, i) => (
              <a key={i} className="question-link" href={`/ask?q=${encodeURIComponent(s)}&mode=question`}>
                {s} <AiMark /> <span>→</span>
              </a>
            ))}
          </section>
        </article>
      </main>
      <Footer />
    </>
  );
}

/** B24: the shared "a refresh landed here instead of a new permalink" note — InsufficientView and
 *  ListEmptyView both render it when `refreshOf` (the OLD answer's id) is set, so the person who
 *  clicked "Refresh this answer" knows the old page is untouched rather than silently vanishing. */
function RefreshFailedNote({ refreshOf }: { refreshOf: string }) {
  return (
    <Callout tone="info" className="mb-4">
      This refresh did not find enough support in the current records to write a new answer. The earlier answer is
      unchanged — <Link href={`/a/${refreshOf}`}>view the earlier version →</Link>
    </Callout>
  );
}

function InsufficientView({
  q,
  pages,
  notEstablished,
  followUps,
  evidenceSummary = [],
  parentId,
  refreshOf,
}: {
  q: string;
  pages: RetrievedPage[];
  notEstablished: string[];
  followUps: string[];
  evidenceSummary?: AskAnswer['evidenceSummary'];
  /** B17: set when this insufficient turn was itself a follow-up — keeps the
   *  thread's own follow-up box chained onto the last turn that actually
   *  saved an answer, since a non-answer never gets its own permalink. */
  parentId?: string;
  /** B24: set when this insufficient turn was a refresh attempt of an existing answer — that old
   *  answer's id, so RefreshFailedNote can link back to it. */
  refreshOf?: string;
}) {
  return (
    <>
      <Header active="/ask" />
      <main id="main">
        <AskAgainForm q={q} />
        <div className="answer-grid">
          <article className="answer-main">
            {refreshOf && <RefreshFailedNote refreshOf={refreshOf} />}
            <div className="empty-note">
              <MachineNote />
              <h1>{q}</h1>
            </div>
            {evidenceSummary.length > 0 ? <EvidenceSummary sentences={evidenceSummary} pages={pages} /> : (
              <p>{pages.length === 0
                ? 'This search did not retrieve any pages to review. That leaves the question unresolved; it does not show that the event did not happen or that no relevant record exists in the collection.'
                : `The search retrieved ${pages.length} page excerpts, but no description of their contents passed the citation checks for this summary. You can inspect the retrieved pages alongside this explanation.`}</p>
            )}
            {notEstablished.length > 0 && (
              <section className="limits">
                <h2>Why the question remains unresolved</h2>
                  {notEstablished.map((n, i) => (
                    <p key={i}>{n}</p>
                  ))}
              </section>
            )}
            <p className="small muted mt-6">
              {pages.length > 0 && `This review covers ${pages.length} retrieved page excerpts, not every record in the collection. `}
              Missing details in these excerpts do not establish that an event did not happen. Relevant records may use different wording or may not have been retrieved.
            </p>
            <section className="followup">
              {followUps.length > 0 && (
                <>
                  <h2>A narrower question these pages might support</h2>
                  {followUps.map((f, i) => (
                    <a key={i} className="question-link" href={`/ask?q=${encodeURIComponent(f)}&mode=question`}>
                      {f} <AiMark /> <span>→</span>
                    </a>
                  ))}
                </>
              )}
              <FollowUpForm parentId={parentId} />
            </section>
          </article>
          <SourceRail pages={pages} q={q} emptyNote="retrieved for this question; not a complete review of the collection" />
        </div>
      </main>
      <Footer />
    </>
  );
}

/** B21 (issue #35): a "list" plan that resolved to zero rows — a model slip (an address/lab/role
 *  the records don't mention) or a genuinely empty result. No permalink, same rule as
 *  InsufficientView: there is nothing frozen worth a stable URL for. */
function ListEmptyView({
  q,
  title,
  parentId,
  refreshOf,
}: {
  q: string;
  title: string;
  parentId?: string;
  /** B24: see InsufficientView's own refreshOf. */
  refreshOf?: string;
}) {
  return (
    <>
      <Header active="/ask" />
      <main id="main">
        <AskAgainForm q={q} />
        <article className="answer-main">
          {refreshOf && <RefreshFailedNote refreshOf={refreshOf} />}
          <div className="empty-note">
            <MachineNote />
            <h1>
              No rows matched
              <br />
              that table.
            </h1>
          </div>
          <div className="citation-rule">
            <b>{title}</b> — nothing in the records matched. A gap here is not proof a record does not exist
            elsewhere.
          </div>
          <section className="followup">
            <FollowUpForm parentId={parentId} />
          </section>
        </article>
      </main>
      <Footer />
    </>
  );
}

/**
 * The tail shared by a root question and a follow-up merge alike, once a
 * plan (AskPlan) is in hand: render/redirect on refuse|offtopic|search, else
 * retrieve → answer → validate → save|insufficient. `opts.parentId` (B17)
 * is the answer row this plan's turn was asked from, if any — threaded into
 * the saved row and into InsufficientView's own follow-up box; `opts.boostPages`
 * is that parent's cited pages, passed to retrieveForQuestion's should-boost.
 * `opts.refreshedFrom` (B24) is the OLD answer row id being refreshed, if
 * any: threaded into the new row's own refreshed_from column, and — only
 * once a new permalink is actually saved — used to mark that old row
 * superseded_by the new one. A refresh that lands on an insufficient/empty
 * view instead never reaches saveAnswer, so the old row is left untouched,
 * exactly like an ordinary non-refresh turn that doesn't validate.
 */
async function renderPlanOutcome(
  q: string,
  plan: AskPlan,
  planUsage: Record<string, unknown>,
  opts: { parentId?: string; boostPages?: PageRef[]; refreshedFrom?: string; parentTerms?: string[] } = {},
) {
  // 2026-09-14: the planner refused "Who was the contractor hired to clean 114 Liberty Street
  // apartments?" as an identity question. A question whose answer is an organisation is never
  // about a private person — the prompt now says so, and this guard catches the planner anyway.
  // Henry, 2026-09-14 (checked with counsel): the City redacted these records before release, so
  // there is nothing for an identity question to unmask — Ask answers every question from what
  // the City published and never refuses. The answer model still never guesses a redacted name.
  if (plan.kind === 'refuse') plan = { ...plan, kind: 'question' };

  if (plan.kind === 'offtopic') {
    return <OfftopicView q={q} />;
  }

  if (plan.kind === 'search') {
    const params = new URLSearchParams();
    params.set('q', plan.terms.filter(Boolean).join(' ') || q);
    if (plan.filters.contaminant) params.set('contaminant', plan.filters.contaminant);
    if (plan.filters.address) params.set('address', plan.filters.address);
    if (plan.filters.agency) params.set('agency', plan.filters.agency);
    if (plan.filters.lab) params.set('lab', plan.filters.lab);
    const year = plan.filters.dateFrom?.slice(0, 4) || plan.filters.dateTo?.slice(0, 4);
    if (year) params.set('year', year);
    redirect(`/search?${params.toString()}`);
  }

  if (plan.kind === 'list') {
    const listResult = await runList(plan);
    if (listResult.rows.length === 0) {
      // 2026-09-14: "Which labs analysed asbestos samples from 90 West Street?" planned as a
      // labs_by_building table and matched no structured rows — the reader saw "No rows matched
      // that table" although the pages exist. Fall through to the written, cited answer instead;
      // the empty-table view is only for a question with nothing to retrieve either.
      plan = { ...plan, kind: 'question' };
    } else {
    const id = await saveAnswer({
      q,
      plan,
      answer: EMPTY_ASK_ANSWER,
      pages: [],
      model: ASK_MODEL,
      usage: { plan: planUsage },
      parentId: opts.parentId ?? null,
      listResult,
      refreshedFrom: opts.refreshedFrom ?? null,
    });
    if (opts.refreshedFrom) await markSuperseded(opts.refreshedFrom, id);
    redirect(`/a/${id}`);
    }
  }

  // plan.kind === 'question'
  // Parent-turn citations first, then the named building's own attributed pages (folder
  // attribution is invisible to text search — lib/ask/placeBoost.ts), deduped by Bates page.
  const placeBoost = await placePagesForQuestion(plan.filters, q, plan.terms, opts.parentTerms ?? []);
  const boost: PageRef[] = [];
  const seenBates = new Set<string>();
  // Building-scoped hits for THIS question go first: on a follow-up the parent's cited pages can
  // fill every retrieval slot on their own (12 of 12 on 2026-09-14), pushing out the pages that
  // actually answer the new question.
  for (const ref of [...placeBoost.refs, ...(opts.boostPages ?? [])]) {
    if (seenBates.has(ref.batesPage)) continue;
    seenBates.add(ref.batesPage);
    boost.push(ref);
  }
  const pages = await retrieveForQuestion(plan.terms.length ? plan.terms : [q], plan.filters, boost);
  // A folder-attributed page rarely spells the address the question used (the folder is
  // labelled "30 WEST BROADWAY; 1001414" for 235-247 Greenwich St) — tell the answer model
  // how the City filed it, so it can cite the building's own records.
  const placeBates = new Set(placeBoost.refs.map((r) => r.batesPage));
  for (const p of pages) {
    if (placeBates.has(p.batesPage)) p.excerpt = `[BUILDING RECORD: this page is one of the City's records for the building at ${placeBoost.label}${p.folder ? `, filed in the folder "${p.folder}"` : ''} — the folder is the same building under another address/BIN, so this page IS a record for ${placeBoost.label}.] ${p.excerpt}`;
  }
  if (pages.length === 0) {
    return (
      <InsufficientView q={q} pages={[]} notEstablished={[]} followUps={[]} parentId={opts.parentId} refreshOf={opts.refreshedFrom} />
    );
  }

  let answer: AskAnswer;
  let answerUsage: Record<string, unknown>;
  let model = 'unknown';
  try {
    const result = await answerQuestion(q, pages);
    answer = result.answer;
    answerUsage = result.usage as unknown as Record<string, unknown>;
    model = result.model;
    void recordSpend(estimateCostUsd(result.usage));
  } catch (err) {
    console.error('[ask] answer call failed', err);
    redirect(searchFallbackUrl(q, 'ask-failed'));
  }

  const retrievedBatesPages = new Set(pages.map((p) => p.batesPage));
  const citeValidated = validateAnswer(answer, retrievedBatesPages);
  // B15: a follow-up the model wrote from the excerpts isn't guaranteed to
  // match the corpus's own wording — check each against a cheap lexical
  // search before it's ever rendered or stored, so a follow-up link never
  // leads to an empty results page (see validateFollowUps's header).
  const followUps = await validateFollowUps(citeValidated.followUps);
  const validated = { ...citeValidated, followUps };

  if (validated.sentences.length === 0) {
    return (
      <InsufficientView
        q={q}
        pages={pages}
        notEstablished={validated.notEstablished}
        evidenceSummary={validated.evidenceSummary}
        followUps={validated.followUps}
        parentId={opts.parentId}
        refreshOf={opts.refreshedFrom}
      />
    );
  }

  const id = await saveAnswer({
    q,
    plan,
    answer: validated,
    pages,
    model,
    usage: { plan: planUsage, answer: answerUsage },
    parentId: opts.parentId ?? null,
    refreshedFrom: opts.refreshedFrom ?? null,
  });
  if (opts.refreshedFrom) await markSuperseded(opts.refreshedFrom, id);
  redirect(`/a/${id}`);
}

/**
 * B24 ("Refresh this answer", issue "Ask: refresh a frozen answer"): /a/[id]'s
 * "Refresh this answer" control links here as /ask?refresh=<old answer id> —
 * a plain GET, no `q`, since the question comes from the frozen row itself
 * rather than user input. Re-runs the SAME question against the current
 * index: if the old row had a parent turn, as a follow-up of that same
 * parent (planFollowUp again, exactly like a live follow-up, so the thread
 * context survives); otherwise by re-executing the row's own saved plan
 * as-is (no re-classification — "same list plan kind or prose path"),
 * skipping a second planning call entirely. The spend cap and rate limit
 * apply here exactly as they do to any other model-backed turn. Returns null
 * for an unknown/expired refresh id so the caller can fall through to the
 * ordinary q flow.
 */
async function handleRefresh(oldId: string) {
  const oldRow = await getAnswer(oldId).catch(() => null);
  if (!oldRow) return null;

  if (!askConfigured()) {
    redirect(searchFallbackUrl(oldRow.q, 'ask-unavailable'));
  }
  const hdrs = await headers();
  const ip = clientIp(hdrs);
  if (!allowAskRequest(ip)) {
    redirect(searchFallbackUrl(oldRow.q, 'ask-rate-limited'));
  }
  if (!(await underDailyCap())) {
    redirect(searchFallbackUrl(oldRow.q, 'ask-daily-cap'));
  }

  if (oldRow.parent_id) {
    const parentRow = await getAnswer(oldRow.parent_id).catch(() => null);
    if (parentRow) {
      const parentCited = citedBatesPages(parentRow);
      let plan: AskPlan;
      let planUsage: Record<string, unknown>;
      try {
        const result = await planFollowUp(parentRow.plan, parentCited, oldRow.q);
        plan = result.plan;
        planUsage = result.usage as unknown as Record<string, unknown>;
        void recordSpend(estimateCostUsd(result.usage));
      } catch (err) {
        console.error('[ask] refresh follow-up plan call failed', err);
        redirect(searchFallbackUrl(oldRow.q, 'ask-failed'));
      }

      const citedSet = new Set(parentCited);
      const boostPages = parentRow.cites.filter((c) => citedSet.has(c.batesPage));
      return renderPlanOutcome(oldRow.q, plan, planUsage, {
        parentId: parentRow.id,
        boostPages,
        refreshedFrom: oldRow.id,
      });
    }
    // Parent row gone (deleted/expired): fall through and refresh as a root turn below.
  }

  return renderPlanOutcome(oldRow.q, oldRow.plan, { reused: true, refreshedFrom: oldRow.id }, { refreshedFrom: oldRow.id });
}

export default async function AskPage({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const sp = await searchParams;

  // B24: /ask?refresh=<old answer id> — handled before the `q` requirement
  // below, since a refresh URL carries no q of its own.
  const refreshId = (getStr(sp, 'refresh') || '').trim();
  if (refreshId) {
    const refreshed = await handleRefresh(refreshId);
    if (refreshed) return refreshed;
    // Unknown/expired refresh id with no q: falls through to redirect('/search') below, same as
    // any other empty-q request.
  }

  const q = (getStr(sp, 'q') || '').trim();
  if (!q) redirect('/search');

  // B17 (issue #23), "Ask a follow-up": /ask?parent=<answer id>&q=<sentence>.
  // A follow-up always needs the model — it's meaningless as a Bates/keyword
  // short-circuit and needs the parent's plan as context — so it skips
  // routeAsk entirely and goes straight to the merge call (lib/ask/plan.ts's
  // planFollowUp: PARENT PLAN JSON + parent's cited page ids + this new
  // sentence, never prose history). An unknown/expired parent id degrades to
  // an ordinary root question below rather than erroring.
  const parentId = (getStr(sp, 'parent') || '').trim();
  const forceQuestion = getStr(sp, 'mode') === 'question';
  if (parentId) {
    const parentRow = await getAnswer(parentId).catch(() => null);
    if (parentRow) {
      if (!askConfigured()) {
        redirect(searchFallbackUrl(q, 'ask-unavailable'));
      }
      const hdrs = await headers();
      const ip = clientIp(hdrs);
      if (!allowAskRequest(ip)) {
        redirect(searchFallbackUrl(q, 'ask-rate-limited'));
      }
      if (!(await underDailyCap())) {
        redirect(searchFallbackUrl(q, 'ask-daily-cap'));
      }

      const parentCited = citedBatesPages(parentRow);
      let plan: AskPlan;
      let planUsage: Record<string, unknown>;
      try {
        const result = await planFollowUp(parentRow.plan, parentCited, q);
        plan = result.plan;
        // "Continue from the evidence" chips (2026-09-14): they read "…at this building" and only
        // make sense with the parent's filters merged in, and they are AI-marked — so a follow-up
        // the planner labels 'search' still gets a written answer.
        if (forceQuestion && plan.kind === 'search') plan = { ...plan, kind: 'question' };
        planUsage = result.usage as unknown as Record<string, unknown>;
        void recordSpend(estimateCostUsd(result.usage));
      } catch (err) {
        console.error('[ask] follow-up plan call failed', err);
        redirect(searchFallbackUrl(q, 'ask-failed'));
      }

      const citedSet = new Set(parentCited);
      const boostPages = parentRow.cites.filter((c) => citedSet.has(c.batesPage));
      return renderPlanOutcome(q, plan, planUsage, { parentId: parentRow.id, boostPages, parentTerms: parentRow.plan.terms });
    }
    // Unknown/expired parent id: fall through and treat this as a root question.
  }

  // /search's "Ask this as a question →" link (B11, "combine search and ask
  // into one, like Prospect"): forces the planner even for a string the
  // router would otherwise short-circuit to a Bates lookup or a keyword
  // search — the user has already seen the plain search results and
  // explicitly asked for the model instead. It never forces plan.kind
  // itself; the planner can still come back 'search'/'refuse'/'offtopic'.
  // Already answered recently (a suggested question, a shared link typed again): open the stored
  // permalink at once — no planner, no retrieval, no model call. Its "Refresh this answer"
  // control is the way to a fresh one.
  const recent = await findRecentAnswer(q).catch(() => null);
  if (recent) redirect(`/a/${recent}`);

  const route = routeAsk(q);

  if (!forceQuestion && route.kind === 'bates') {
    const found = (await getPageByBates(route.bates)) ?? (await findExactBates(route.bates));
    if (found) redirect(found.page > 1 ? `/doc/${found.doc}/p/${found.page}` : `/doc/${found.doc}`);
    redirect(searchFallbackUrl(q, 'bates-not-found'));
  }

  if (!forceQuestion && route.kind === 'keyword') {
    redirect(`/search?q=${encodeURIComponent(route.q)}`);
  }

  // route.kind === 'model' (or mode=question forcing it) from here:
  // ANTHROPIC_API_KEY unset -> degrade to search with a note (docs/PLAN.md:
  // "with no key, Ask degrades to search").
  if (!askConfigured()) {
    redirect(searchFallbackUrl(q, 'ask-unavailable'));
  }

  const hdrs = await headers();
  const ip = clientIp(hdrs);
  if (!allowAskRequest(ip)) {
    redirect(searchFallbackUrl(q, 'ask-rate-limited'));
  }

  if (!(await underDailyCap())) {
    redirect(searchFallbackUrl(q, 'ask-daily-cap'));
  }

  let plan: AskPlan;
  let planUsage: Record<string, unknown>;
  try {
    const result = await planAsk(q);
    plan = result.plan;
    // mode=question (AI-marked chips, "Ask this as a question"): the visitor asked for a cited
    // answer, so a planner that comes back 'search' is overridden to 'question' — refuse/offtopic
    // still stand. (2026-09-14: a map chip bounced to an empty document search instead.)
    if (forceQuestion && plan.kind === 'search') plan = { ...plan, kind: 'question' };
    planUsage = result.usage as unknown as Record<string, unknown>;
    void recordSpend(estimateCostUsd(result.usage));
  } catch (err) {
    console.error('[ask] plan call failed', err);
    redirect(searchFallbackUrl(q, 'ask-failed'));
  }

  return renderPlanOutcome(q, plan, planUsage);
}
