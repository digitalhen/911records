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
import { answerQuestion, validateAnswer, validateFollowUps, type AskAnswer } from '@/lib/ask/answer';
import { runList } from '@/lib/ask/listExec';
import { underDailyCap, recordSpend, estimateCostUsd } from '@/lib/ask/spend';
import { allowAskRequest, clientIp } from '@/lib/ask/rateLimit';
import { FollowUpForm } from '@/components/ask/FollowUpForm';
import { saveAnswer, getAnswer, markSuperseded, citedBatesPages, EMPTY_ASK_ANSWER } from '@/lib/ask/store';
import { Callout } from '@/components/ui';

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

function RefusalView({ q, reason }: { q: string; reason: string }) {
  return (
    <>
      <Header active="/ask" />
      <main id="main">
        <AskAgainForm q={q} />
        <article className="answer-main summary-rule">
          <MachineNote />
          <div className="citation-rule">
            <h2 className="mb-2">Identity questions are refused</h2>
            <p>
              {reason ||
                'This tool cannot help identify a redacted or private person. You can ask about building conditions, test results, dates, offices and officials’ actions on the records instead.'}
            </p>
          </div>
        </article>
        <aside className="source-rail source-rail-top">
          <h2>City 9/11 records only</h2>
          <p>
            This service covers the City&apos;s 9/11 records only. No people browser, no co-mention search, no
            network graph of people. See <Link href="/personal-information">the personal-information policy</Link>.
          </p>
          <div className="mt-5"><WhatOthersAreReading /></div>
        </aside>
      </main>
      <Footer />
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
              <Link key={i} className="question-link" href={`/ask?q=${encodeURIComponent(s)}`}>
                {s} <AiMark /> <span>→</span>
              </Link>
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
  parentId,
  refreshOf,
}: {
  q: string;
  pages: RetrievedPage[];
  notEstablished: string[];
  followUps: string[];
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
              <h1>
                These records are not enough
                <br />
                to answer that question.
              </h1>
            </div>
            <div className="citation-rule">
              <b>If a sentence has no page citation, it is not in the records.</b>
              <br />
              This summary can misread scans and OCR. The page is the authority.
            </div>
            {notEstablished.length > 0 && (
              <section className="limits">
                <h2>What is missing from the pages read</h2>
                <ul>
                  {notEstablished.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </section>
            )}
            <p className="small muted mt-6">
              A gap in these pages is not proof that a record does not exist elsewhere. This tool does not determine
              medical causation or claim eligibility.
            </p>
            <section className="followup">
              {followUps.length > 0 && (
                <>
                  <h2>A narrower question these pages might support</h2>
                  {followUps.map((f, i) => (
                    <Link key={i} className="question-link" href={`/ask?q=${encodeURIComponent(f)}`}>
                      {f} <AiMark /> <span>→</span>
                    </Link>
                  ))}
                </>
              )}
              <FollowUpForm parentId={parentId} />
            </section>
          </article>
          <SourceRail pages={pages} q={q} emptyNote="none supported a citeable sentence for this question" />
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
  opts: { parentId?: string; boostPages?: PageRef[]; refreshedFrom?: string } = {},
) {
  if (plan.kind === 'refuse') {
    return <RefusalView q={q} reason={plan.refuseReason} />;
  }

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
      return <ListEmptyView q={q} title={listResult.title} parentId={opts.parentId} refreshOf={opts.refreshedFrom} />;
    }
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

  // plan.kind === 'question'
  const pages = await retrieveForQuestion(plan.terms.length ? plan.terms : [q], plan.filters, opts.boostPages ?? []);
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
        planUsage = result.usage as unknown as Record<string, unknown>;
        void recordSpend(estimateCostUsd(result.usage));
      } catch (err) {
        console.error('[ask] follow-up plan call failed', err);
        redirect(searchFallbackUrl(q, 'ask-failed'));
      }

      const citedSet = new Set(parentCited);
      const boostPages = parentRow.cites.filter((c) => citedSet.has(c.batesPage));
      return renderPlanOutcome(q, plan, planUsage, { parentId: parentRow.id, boostPages });
    }
    // Unknown/expired parent id: fall through and treat this as a root question.
  }

  // /search's "Ask this as a question →" link (B11, "combine search and ask
  // into one, like Prospect"): forces the planner even for a string the
  // router would otherwise short-circuit to a Bates lookup or a keyword
  // search — the user has already seen the plain search results and
  // explicitly asked for the model instead. It never forces plan.kind
  // itself; the planner can still come back 'search'/'refuse'/'offtopic'.
  const forceQuestion = getStr(sp, 'mode') === 'question';
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
    planUsage = result.usage as unknown as Record<string, unknown>;
    void recordSpend(estimateCostUsd(result.usage));
  } catch (err) {
    console.error('[ask] plan call failed', err);
    redirect(searchFallbackUrl(q, 'ask-failed'));
  }

  return renderPlanOutcome(q, plan, planUsage);
}
