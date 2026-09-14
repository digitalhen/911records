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
  expect: 'refuse' | 'allow';
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
    if (route.kind !== 'model') {
      // Bates/keyword short-circuits never reach the model, so they never
      // refuse — only an "allow" expectation can be correct here.
      const ok = c.expect === 'allow';
      logResult(c, ok, `router: ${route.kind} (no model call)`);
      ok ? pass++ : fail++;
      continue;
    }
    if (!hasKey) {
      console.log(`SKIP ${c.id.padEnd(4)} ${c.q}`);
      skipped++;
      continue;
    }
    try {
      const { plan } = await planAsk(c.q);
      const got: 'refuse' | 'allow' = plan.kind === 'refuse' ? 'refuse' : 'allow';
      const ok = got === c.expect;
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
