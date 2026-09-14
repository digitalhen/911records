// `npm run ask:eval` — runs web/lib/ask/refusals.test-cases.json through the
// real router (lib/ask/router.ts) and, for cases that reach the model, the
// real plan call (lib/ask/plan.ts). Model cases are skipped (reported, not
// failed) when ANTHROPIC_API_KEY is unset, so this runs in CI with no key.
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

interface Case {
  id: string;
  q: string;
  expect: 'refuse' | 'allow' | 'offtopic' | 'keyword' | 'question';
  note?: string;
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
    const route = routeAsk(c.q);

    // 'keyword' cases are a pure router assertion — checkable with zero
    // model calls regardless of ANTHROPIC_API_KEY, and the whole point of
    // B11's router fix is that these short-circuit before ever reaching it.
    if (c.expect === 'keyword') {
      const ok = route.kind === 'keyword';
      logResult(c, ok, `router: ${route.kind} (no model call)`);
      ok ? pass++ : fail++;
      continue;
    }

    if (route.kind !== 'model') {
      // Bates/keyword short-circuits never reach the model, so only an
      // "allow" expectation can be correct here — 'refuse'/'offtopic'/
      // 'question' all require the planner to have actually run.
      const ok = c.expect === 'allow';
      logResult(c, ok, `router: ${route.kind} (no model call)`);
      ok ? pass++ : fail++;
      continue;
    }

    // From here, the router correctly sent it to the model (checkable
    // without a key); whether the *plan* itself is right needs one.
    if (!hasKey) {
      console.log(`SKIP ${c.id.padEnd(4)} ${c.q} — router: model (needs ANTHROPIC_API_KEY to check plan.kind)`);
      skipped++;
      continue;
    }
    try {
      const { plan } = await planAsk(c.q);
      const ok =
        c.expect === 'refuse'
          ? plan.kind === 'refuse'
          : c.expect === 'offtopic'
            ? plan.kind === 'offtopic'
            : c.expect === 'question'
              ? plan.kind === 'question'
              : plan.kind !== 'refuse' && plan.kind !== 'offtopic'; // 'allow'
      logResult(c, ok, `plan: ${plan.kind}${plan.refuseReason ? ` (${plan.refuseReason})` : ''}`);
      ok ? pass++ : fail++;
    } catch (err) {
      console.log(`ERROR ${c.id.padEnd(4)} ${c.q} — ${err instanceof Error ? err.message : err}`);
      fail++;
    }
  }

  console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped (of ${cases.length})`);
  if (fail > 0) process.exit(1);
}

function logResult(c: Case, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.id.padEnd(4)} expect=${c.expect.padEnd(6)} ${detail} — "${c.q}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
