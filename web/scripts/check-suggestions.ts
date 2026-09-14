// `npm run suggestions:check` — B15 ("every suggested question/search must
// return results"). Enumerates every suggestion the app can surface to a
// visitor with no prior interaction — the home page's static questions
// (reused verbatim by /ask's off-topic note and /search's "no searchable
// terms" note), and the map panel's data-driven chips (lib/map/data.ts) —
// and runs each one through the SAME functions the pages call (router ->
// planner -> retrieval/answer, or a direct OpenSearch/Postgres check), against
// whatever OpenSearch/Postgres this process is pointed at. No dev server
// needed; no page is rendered.
//
// Pass criteria (team brief):
//   - a keyword-routed or search-planned string:  >=1 lexical hit
//   - a question-planned string:                  planner kind 'question' AND
//                                                  an answer with >=1 sentence
//                                                  surviving citation validation
//   - a Bates/building/page link:                 the target row/page exists
// A planner 'refuse'/'offtopic' verdict on a suggestion we authored ourselves
// is always a failure — a suggested question should never trip either gate.
//
// Model calls (only for the handful of question-shaped static suggestions)
// are cached to disk by exact question text (scripts/.suggestions-cache.json,
// gitignored) so repeat runs during development don't re-spend; delete that
// file (or pass --no-cache) to force a fresh run, e.g. after editing prompts.
//
// Run with tsx (see scripts/ask-eval.ts's header for why) plus the
// server-only stub (scripts/lib/register-server-only-stub.mjs — see its
// header) so lib/map/data.ts, which is otherwise never imported outside
// Next's own bundler, can be required directly. Both are wired into the
// `suggestions:check` npm script; run it directly rather than invoking this
// file with plain `tsx`.
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { SUGGESTED_QUESTIONS } from '../lib/suggestedQuestions';
import { routeAsk } from '../lib/ask/router';
import { askConfigured, planAsk } from '../lib/ask/plan';
import { retrieveForQuestion } from '../lib/ask/retrieve';
import { answerQuestion, validateAnswer } from '../lib/ask/answer';
import { estimateCostUsd } from '../lib/ask/spend';
import { search } from '../lib/opensearch';
import { getSuggestions, getPlaceFile } from '../lib/map/data';
import { buildingUrl, pageUrl, placeQuestion, substanceQuestion } from '../lib/map/types';
import { getPage } from '../lib/site';

const MIN_SENTENCES = 3; // a suggested question must yield a real answer, not a one-liner
const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '.suggestions-cache.json');
const NO_CACHE = process.argv.includes('--no-cache');

interface Suggestion {
  text: string;
  source: string;
  /** How to check it. 'auto' walks the real router (used for anything a
   *  visitor would type into the Ask box); 'keyword'/'page' are direct
   *  checks for a data-driven chip that never goes through the router. */
  check: 'auto' | { keyword: string } | { page: { doc: string; page: number } } | { building: string };
}

interface Outcome {
  ok: boolean;
  detail: string;
  costUsd: number;
}

type CacheEntry = Outcome & { checkedAt: string };

function loadCache(): Record<string, CacheEntry> {
  if (NO_CACHE) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as Record<string, CacheEntry>;
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, CacheEntry>): void {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('[suggestions:check] could not write cache', err);
  }
}

async function checkKeyword(q: string): Promise<Outcome> {
  const r = await search({ q, pageSize: 1 });
  if (r.error) return { ok: false, detail: `search error: ${r.error}`, costUsd: 0 };
  if (r.noSearchableTerms) return { ok: false, detail: 'no searchable terms', costUsd: 0 };
  if (r.noLexicalMatch || r.total === 0) return { ok: false, detail: 'no lexical hit', costUsd: 0 };
  return { ok: true, detail: `${r.total} lexical hits`, costUsd: 0 };
}

async function checkPage(doc: string, page: number): Promise<Outcome> {
  const row = await getPage(doc, page);
  return row
    ? { ok: true, detail: `page exists (${doc} p${page})`, costUsd: 0 }
    : { ok: false, detail: `page not found (${doc} p${page})`, costUsd: 0 };
}

async function checkBuilding(id: string): Promise<Outcome> {
  const file = await getPlaceFile(id);
  return file
    ? { ok: true, detail: `building resolves (${file.place.label})`, costUsd: 0 }
    : { ok: false, detail: `building does not resolve (id=${id})`, costUsd: 0 };
}

/** Walks the exact same router -> planner -> retrieve/answer path app/ask/page.tsx uses. */
async function checkAsQuestion(q: string): Promise<Outcome> {
  const route = routeAsk(q);

  if (route.kind === 'bates') {
    // A suggestion that happens to look like a Bates number: the router
    // sends it straight to the document, matching /ask's own short-circuit.
    return { ok: true, detail: 'routes to a Bates page (no model call)', costUsd: 0 };
  }
  if (route.kind === 'keyword') {
    const out = await checkKeyword(route.q);
    return { ...out, detail: `router: keyword — ${out.detail}` };
  }

  // route.kind === 'model'
  if (!askConfigured()) return { ok: false, detail: 'ANTHROPIC_API_KEY not set — cannot check the model path', costUsd: 0 };

  const planResult = await planAsk(q);
  const plan = planResult.plan;
  let cost = estimateCostUsd(planResult.usage);

  if (plan.kind === 'refuse') {
    return { ok: false, detail: `planner refused a suggested question (${plan.refuseReason})`, costUsd: cost };
  }
  if (plan.kind === 'offtopic') {
    return { ok: false, detail: 'planner judged a suggested question off-topic', costUsd: cost };
  }
  if (plan.kind === 'search') {
    const terms = plan.terms.filter(Boolean).join(' ') || q;
    const out = await checkKeyword(terms);
    return { ok: out.ok, detail: `plan: search "${terms}" — ${out.detail}`, costUsd: cost };
  }

  // plan.kind === 'question'
  const pages = await retrieveForQuestion(plan.terms.length ? plan.terms : [q], plan.filters);
  if (!pages.length) return { ok: false, detail: 'plan: question — 0 pages retrieved', costUsd: cost };

  const answerResult = await answerQuestion(q, pages);
  cost += estimateCostUsd(answerResult.usage);
  const validated = validateAnswer(answerResult.answer, new Set(pages.map((p) => p.batesPage)));
  if (!validated.sentences.length) {
    return { ok: false, detail: `plan: question — ${pages.length} pages retrieved, 0 sentences survived validation`, costUsd: cost };
  }
  if (validated.sentences.length < MIN_SENTENCES) {
    return { ok: false, detail: `plan: question — only ${validated.sentences.length} sentence(s) survived (need ${MIN_SENTENCES})`, costUsd: cost };
  }
  return {
    ok: true,
    detail: `plan: question — ${pages.length} pages retrieved, ${validated.sentences.length} sentences survived`,
    costUsd: cost,
  };
}

async function buildSuggestions(): Promise<Suggestion[]> {
  const out: Suggestion[] = SUGGESTED_QUESTIONS.map((q) => ({ text: q, source: 'home:SUGGESTED_QUESTIONS', check: 'auto' }));

  // Map panel chips (lib/map/data.ts's getSuggestions()) — the exact query
  // MapExplorer.tsx uses to build its starter chips. Mirrors that
  // component's own guards (a fallback, non-address label makes no sensible
  // question — see its comment) so we check exactly what a visitor can see.
  const s = await getSuggestions();
  if (s.place) {
    out.push({ text: `Building chip: ${buildingUrl(s.place)}`, source: 'map:getSuggestions().place', check: { building: s.place.id } });
    out.push({ text: `Building-source page: ${pageUrl(s.place)}`, source: 'map:getSuggestions().place source link', check: { page: { doc: s.place.doc, page: s.place.page } } });
    const placeLabel = /^\d/.test(s.place.label) ? s.place.label : null;
    if (placeLabel) {
      out.push({ text: placeQuestion(placeLabel), source: 'map:MapExplorer question chip', check: 'auto' });
    }
  }
  if (s.substance) {
    out.push({ text: s.substance, source: 'map:getSuggestions().substance (keyword chip)', check: { keyword: s.substance } });
    out.push({ text: substanceQuestion(s.substance), source: 'map:MapExplorer relatedQuestion chip', check: 'auto' });
  }
  if (s.substanceSource) {
    out.push({
      text: `Substance-source link: ${pageUrl(s.substanceSource)}`,
      source: 'map:getSuggestions().substanceSource',
      check: { page: { doc: s.substanceSource.doc, page: s.substanceSource.page } },
    });
  }
  return out;
}

async function main(): Promise<void> {
  const suggestions = await buildSuggestions();
  const cache = loadCache();
  const rows: { suggestion: Suggestion; outcome: Outcome; cached: boolean }[] = [];
  let totalCost = 0;

  for (const suggestion of suggestions) {
    // Only the 'auto' (model) path is cached — a keyword/page/building check
    // is a single cheap live-data query and the corpus grows daily, so it's
    // always worth re-running rather than risking a stale pass/fail.
    const cacheKey = `${suggestion.source}::${suggestion.text}`;
    const cached = suggestion.check === 'auto' ? cache[cacheKey] : undefined;
    const outcome = cached ?? (await runCheck(suggestion));
    if (suggestion.check === 'auto' && !cached) {
      cache[cacheKey] = { ...outcome, checkedAt: new Date().toISOString() };
    }
    if (!cached) totalCost += outcome.costUsd; // a cache hit spent nothing this run
    rows.push({ suggestion, outcome, cached: !!cached });
  }

  saveCache(cache);

  const widths = { text: 60, source: 34 };
  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
  console.log(`${pad('Suggestion', widths.text)} ${pad('Source', widths.source)} Outcome`);
  console.log('-'.repeat(widths.text + widths.source + 40));
  let failures = 0;
  for (const { suggestion, outcome, cached } of rows) {
    if (!outcome.ok) failures++;
    const status = outcome.ok ? 'PASS' : 'FAIL';
    const cacheTag = cached ? ' (cached)' : '';
    console.log(`${pad(suggestion.text, widths.text)} ${pad(suggestion.source, widths.source)} ${status}${cacheTag} — ${outcome.detail}`);
  }
  console.log('-'.repeat(widths.text + widths.source + 40));
  console.log(
    `${rows.length - failures}/${rows.length} passed · est. cost this run $${totalCost.toFixed(4)}` +
      (NO_CACHE ? ' (--no-cache)' : ''),
  );
  if (failures > 0) {
    console.error(`\n${failures} suggestion(s) failed — see FAIL rows above.`);
    process.exit(1);
  }
}

async function runCheck(suggestion: Suggestion): Promise<Outcome> {
  if (suggestion.check === 'auto') return checkAsQuestion(suggestion.text);
  if ('keyword' in suggestion.check) return checkKeyword(suggestion.check.keyword);
  if ('building' in suggestion.check) return checkBuilding(suggestion.check.building);
  return checkPage(suggestion.check.page.doc, suggestion.check.page.page);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
