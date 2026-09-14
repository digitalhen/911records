import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SearchBox } from '@/components/SearchBox';
import { MachineNote, SourceRail, searchFallbackUrl } from '@/components/ask/shared';
import { getStr, type SearchParamsInput } from '@/lib/searchUrl';
import { getPageByBates } from '@/lib/site';
import { findExactBates } from '@/lib/opensearch';
import { routeAsk } from '@/lib/ask/router';
import { askConfigured, planAsk, type AskPlan } from '@/lib/ask/plan';
import { retrieveForQuestion, type RetrievedPage } from '@/lib/ask/retrieve';
import { answerQuestion, validateAnswer, type AskAnswer } from '@/lib/ask/answer';
import { underDailyCap, recordSpend, estimateCostUsd } from '@/lib/ask/spend';
import { allowAskRequest, clientIp } from '@/lib/ask/rateLimit';
import { saveAnswer } from '@/lib/ask/store';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: 'Ask anything — 9/11 City Records', robots: { index: false } };
}

function AskAgainForm({ q }: { q: string }) {
  return (
    <>
      <SearchBox q={q} compact />
      <p className="small muted" style={{ marginBottom: 14 }}>
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
            <h2 style={{ marginBottom: 8 }}>Identity questions are refused</h2>
            <p>
              {reason ||
                'This tool cannot help identify a redacted or private person. You can ask about building conditions, test results, dates, offices and officials’ actions on the records instead.'}
            </p>
          </div>
        </article>
        <aside
          className="source-rail"
          style={{ marginTop: 24, borderLeft: 0, borderTop: '1px solid var(--line)', paddingLeft: 0, paddingTop: 24 }}
        >
          <h2>City 9/11 records only</h2>
          <p>
            This service covers the City&apos;s 9/11 records only. No people browser, no co-mention search, no
            network graph of people. See <Link href="/personal-information">the personal-information policy</Link>.
          </p>
        </aside>
      </main>
      <Footer />
    </>
  );
}

function InsufficientView({
  q,
  pages,
  notEstablished,
  followUps,
}: {
  q: string;
  pages: RetrievedPage[];
  notEstablished: string[];
  followUps: string[];
}) {
  return (
    <>
      <Header active="/ask" />
      <main id="main">
        <AskAgainForm q={q} />
        <div className="answer-grid">
          <article className="answer-main">
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
            <p className="small muted" style={{ marginTop: 24 }}>
              A gap in these pages is not proof that a record does not exist elsewhere. This tool does not determine
              medical causation or claim eligibility.
            </p>
            {followUps.length > 0 && (
              <section className="followup">
                <h2>A narrower question these pages might support</h2>
                {followUps.map((f, i) => (
                  <Link key={i} className="question-link" href={`/ask?q=${encodeURIComponent(f)}`}>
                    {f} <span>→</span>
                  </Link>
                ))}
              </section>
            )}
          </article>
          <SourceRail pages={pages} q={q} emptyNote="none supported a citeable sentence for this question" />
        </div>
      </main>
      <Footer />
    </>
  );
}

export default async function AskPage({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const sp = await searchParams;
  const q = (getStr(sp, 'q') || '').trim();
  if (!q) redirect('/search');

  const route = routeAsk(q);

  if (route.kind === 'bates') {
    const found = (await getPageByBates(route.bates)) ?? (await findExactBates(route.bates));
    if (found) redirect(found.page > 1 ? `/doc/${found.doc}/p/${found.page}` : `/doc/${found.doc}`);
    redirect(searchFallbackUrl(q, 'bates-not-found'));
  }

  if (route.kind === 'keyword') {
    redirect(`/search?q=${encodeURIComponent(route.q)}`);
  }

  // route.kind === 'model' from here: ANTHROPIC_API_KEY unset -> degrade to
  // search with a note (docs/PLAN.md: "with no key, Ask degrades to search").
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

  if (plan.kind === 'refuse') {
    return <RefusalView q={q} reason={plan.refuseReason} />;
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

  // plan.kind === 'question'
  const pages = await retrieveForQuestion(plan.terms.length ? plan.terms : [q], plan.filters);
  if (pages.length === 0) {
    return <InsufficientView q={q} pages={[]} notEstablished={[]} followUps={[]} />;
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
  const validated = validateAnswer(answer, retrievedBatesPages);

  if (validated.sentences.length === 0) {
    return (
      <InsufficientView q={q} pages={pages} notEstablished={validated.notEstablished} followUps={validated.followUps} />
    );
  }

  const id = await saveAnswer({
    q,
    plan,
    answer: validated,
    pages,
    model,
    usage: { plan: planUsage, answer: answerUsage },
  });
  redirect(`/a/${id}`);
}
