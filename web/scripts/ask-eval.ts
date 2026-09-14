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
import { planAsk, askConfigured } from '../lib/ask/plan';

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

  console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped (of ${cases.length})`);
  if (fail > 0) process.exit(1);
}

function logResult(c: Case, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.id.padEnd(6)} expect=${c.expect.padEnd(8)} ${detail} — ${JSON.stringify(c.q)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
