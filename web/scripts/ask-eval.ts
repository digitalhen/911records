// `npm run ask:eval` — runs web/lib/ask/refusals.test-cases.json through the
// real router (lib/ask/router.ts) and, for cases that reach the model, the
// real plan call (lib/ask/plan.ts). Model cases are skipped (reported, not
// failed) when ANTHROPIC_API_KEY is unset, so this runs in CI with no key.
//
// Case taxonomy matches what a typed query actually resolves to end to end
// (mirrors app/ask/page.tsx's own branching, so a case here is a direct
// assertion about production behavior, not an abstraction over it):
//   doc      - a Bates number; router resolves it and the page redirects
//              straight to the document, no model call.
//   search   - a keyword string; router short-circuits to /search, no model
//              call. (Also covers the router's own degenerate inputs: an
//              empty/whitespace-only query becomes an empty keyword search.)
//   question - reaches the model; plan.kind === 'question'.
//   offtopic - reaches the model; plan.kind === 'offtopic'.
//   refuse   - reaches the model; plan.kind === 'refuse'.
//
// Run with tsx (devDependency) rather than plain node: the lib/ask/*.ts
// files use extensionless relative imports (the project's normal TS/Next
// convention), which tsx's esbuild-based loader resolves but Node's own
// --experimental-strip-types does not.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { routeAsk } from '../lib/ask/router';
import { planAsk, planFollowUp, askConfigured, type AskPlan } from '../lib/ask/plan';

const __dirname = dirname(fileURLToPath(import.meta.url));

type Expect = 'doc' | 'search' | 'question' | 'offtopic' | 'refuse';

interface Case {
  id: string;
  q: string;
  expect: Expect;
  /** Only for expect: 'doc' — the canonical Bates id routeAsk must resolve to. */
  expectTop?: string;
  note?: string;
}

/** What a case actually resolved to, resolved the same way app/ask/page.tsx branches. */
interface Classification {
  /** null only when the case needs the model and no key is configured. */
  category: Expect | null;
  detail: string;
  /** routeAsk's resolved Bates id, when category is 'doc'. */
  top?: string;
}

async function classify(q: string, hasKey: boolean): Promise<Classification> {
  const route = routeAsk(q);

  if (route.kind === 'bates') {
    return { category: 'doc', detail: `router: bates -> ${route.bates}`, top: route.bates };
  }
  if (route.kind === 'keyword') {
    return { category: 'search', detail: 'router: keyword (no model call)' };
  }
  // route.kind === 'model' from here.
  if (!hasKey) {
    return { category: null, detail: 'router: model (needs ANTHROPIC_API_KEY to check plan.kind)' };
  }
  const { plan } = await planAsk(q);
  return { category: plan.kind, detail: `plan: ${plan.kind}${plan.refuseReason ? ` (${plan.refuseReason})` : ''}` };
}

async function main(): Promise<void> {
  const casesPath = join(__dirname, '..', 'lib', 'ask', 'refusals.test-cases.json');
  const cases = JSON.parse(readFileSync(casesPath, 'utf8')) as Case[];
  const hasKey = askConfigured();
  if (!hasKey) {
    console.log('ANTHROPIC_API_KEY not set — model-path cases will be skipped, not failed.\n');
  }

  let pass = 0;
  let fail = 0;
  let skipped = 0;

  for (const c of cases) {
    let result: Classification;
    try {
      result = await classify(c.q, hasKey);
    } catch (err) {
      console.log(`ERROR ${c.id.padEnd(6)} ${JSON.stringify(c.q)} — ${err instanceof Error ? err.message : err}`);
      fail++;
      continue;
    }

    if (result.category === null) {
      console.log(`SKIP  ${c.id.padEnd(6)} ${JSON.stringify(c.q)} — ${result.detail}`);
      skipped++;
      continue;
    }

    let ok = result.category === c.expect;
    let detail = result.detail;
    if (ok && c.expectTop !== undefined) {
      const topOk = result.top === c.expectTop;
      ok = topOk;
      detail += topOk ? ` top=${result.top}` : ` top=${result.top} (expected ${c.expectTop})`;
    }
    logResult(c, ok, detail);
    ok ? pass++ : fail++;
  }

  const followUpResult = await runFollowUpCases(hasKey);
  pass += followUpResult.pass;
  fail += followUpResult.fail;
  skipped += followUpResult.skipped;

  console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped (of ${cases.length + FOLLOW_UP_CASES.length})`);
  if (fail > 0) process.exit(1);
}

function logResult(c: Case, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.id.padEnd(6)} expect=${c.expect.padEnd(8)} ${detail} — ${JSON.stringify(c.q)}`);
}

// --- Follow-up merge cases (B17, issue #23) -------------------------------
// planFollowUp is a separate model call from planAsk (given a PRIOR PLAN as
// JSON + the parent's cited page ids + a new sentence, never prose history —
// see lib/ask/plan.ts), so it needs its own fixtures here rather than a slot
// in refusals.test-cases.json (which only carries a bare query string). Each
// case supplies a fixed parent plan mirroring exactly what app/ask/page.tsx
// hands the model for a real follow-up. Assertions are deliberately loose
// (Haiku's exact wording varies run to run) — they check the MERGE itself:
// the right `kind`, and that fields the follow-up didn't touch survive while
// the field it did touch changed.
interface FollowUpCase {
  id: string;
  note: string;
  parentCited: string[];
  q: string;
  assert: (plan: AskPlan) => string | null; // null = pass, else the failure reason
}

const PARENT_PLAN: AskPlan = {
  kind: 'question',
  terms: ['asbestos', '114 Liberty Street'],
  filters: { contaminant: 'asbestos', address: '114 Liberty Street', agency: '', lab: '', dateFrom: '', dateTo: '', bin: '' },
  refuseReason: '',
};

const FOLLOW_UP_CASES: FollowUpCase[] = [
  {
    id: 'f01',
    note: 'narrow by date — stays "question", adds a date, keeps the address',
    parentCited: ['NYC-WTC_000058160'],
    q: 'Only the results from October 2001.',
    assert: (p) => {
      if (p.kind !== 'question') return `kind=${p.kind}, expected question`;
      if (!p.filters.dateFrom) return 'dateFrom not set';
      if (!p.filters.address) return 'address filter was dropped';
      return null;
    },
  },
  {
    id: 'f02',
    note: 'switch address — address filter changes, contaminant carries forward',
    parentCited: ['NYC-WTC_000058160'],
    q: 'What about 90 West Street instead?',
    assert: (p) => {
      if (p.kind !== 'question') return `kind=${p.kind}, expected question`;
      if (!p.filters.address || p.filters.address === PARENT_PLAN.filters.address)
        return `address not updated (${JSON.stringify(p.filters.address)})`;
      if (!p.filters.contaminant) return 'contaminant filter was dropped';
      return null;
    },
  },
  {
    id: 'f03',
    note: 'ask for the lab — new angle on the same scope, address survives',
    parentCited: ['NYC-WTC_000058160'],
    q: 'Which lab performed the testing?',
    assert: (p) => {
      if (p.kind !== 'question') return `kind=${p.kind}, expected question`;
      if (!p.filters.address) return 'address filter was dropped';
      return null;
    },
  },
  {
    id: 'f04',
    note: 'request documents instead — switches kind to search',
    parentCited: ['NYC-WTC_000058160'],
    q: 'Just show me the underlying documents instead of a written summary.',
    assert: (p) => (p.kind === 'search' ? null : `kind=${p.kind}, expected search`),
  },
];

async function runFollowUpCases(hasKey: boolean): Promise<{ pass: number; fail: number; skipped: number }> {
  console.log('\n-- Follow-up merge cases (B17) --');
  if (!hasKey) {
    console.log('ANTHROPIC_API_KEY not set — follow-up cases skipped.');
    return { pass: 0, fail: 0, skipped: FOLLOW_UP_CASES.length };
  }
  let pass = 0;
  let fail = 0;
  for (const c of FOLLOW_UP_CASES) {
    try {
      const { plan } = await planFollowUp(PARENT_PLAN, c.parentCited, c.q);
      const failure = c.assert(plan);
      const ok = failure === null;
      const summary = JSON.stringify({ kind: plan.kind, filters: plan.filters });
      console.log(`${ok ? 'PASS' : 'FAIL'} ${c.id.padEnd(6)} ${c.note} — ${summary}${failure ? ` — ${failure}` : ''}`);
      ok ? pass++ : fail++;
    } catch (err) {
      console.log(`ERROR ${c.id.padEnd(6)} ${c.note} — ${err instanceof Error ? err.message : err}`);
      fail++;
    }
  }
  return { pass, fail, skipped: 0 };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
