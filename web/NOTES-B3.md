# B3 — Ask anything: implementation notes

## Files

- `web/lib/ask/router.ts` — no-model routing: Bates (with/without prefix) → doc/page, ≤4-token
  non-question string → keyword search, else → model.
- `web/lib/ask/plan.ts` — first Haiku call: `AskPlanSchema` (zod, structured output via
  `zodOutputFormat`), `kind: search|question|refuse`, `terms`, `filters` (all-string sentinels,
  Prospect's convention), `refuseReason`. Model `ASK_MODEL` env, default `claude-haiku-4-5`
  (undated, per docs/PLAN.md — the brief said `-20251001`; kept undated per the claude-api skill's
  "never append date suffixes" rule and PLAN.md's own default).
- `web/lib/ask/retrieve.ts` — OpenSearch hybrid search (`lib/opensearch.ts`) + excerpt building from
  `site.page_text` (`lib/site.ts`). See "Filter fragility" below — only `contaminant` is a hard
  OpenSearch filter; `address`/`agency`/`lab`/dates are folded into the query text instead.
- `web/lib/ask/answer.ts` — second Haiku call: `AskAnswerSchema` (`sentences[{text,cites}]`,
  `notEstablished`, `followUps`), plus `validateAnswer()` — the server-side citation check that
  drops any sentence whose cites aren't all in the retrieved set.
- `web/lib/ask/spend.ts` — Haiku pricing → USD estimate from `usage`; `app.ask_spend` daily total;
  `ASK_DAILY_USD_CAP` (default 5). Documented as per-replica/best-effort, not a hard ceiling (see
  the file's header comment — no atomic reserve-then-spend).
- `web/lib/ask/rateLimit.ts` — in-memory 20/hour per IP, **per process**; two Dokploy replicas mean
  up to ~40/hour cluster-wide, and it resets on every deploy/restart. Documented in the file.
- `web/lib/ask/store.ts` — `app.answers` reads/writes (permalinks); only a validated, non-empty
  answer is ever stored.
- `web/lib/ask/refusals.test-cases.json` + `web/scripts/ask-eval.ts` (`npm run ask:eval`, run with
  `tsx`) — 20 cases (10 refuse / 10 allow), run against the real router + plan; skips model cases
  when `ANTHROPIC_API_KEY` is unset. **20/20 pass** with the key set (see below).
- `web/components/ask/CitationLink.tsx` — client component, hover/focus reveals a `.source-peek`
  panel with the page **thumbnail** (not a tight crop — see Known gaps).
- `web/components/ask/shared.tsx` — `AnswerBody`/`SourceRail`/`MachineNote`, shared by the live
  `/ask` turn and the frozen `/a/[id]` permalink so they can never render differently.
- `web/lib/runtimeSchema.ts` (edited, allowed per its own header/README) — added `app.answers` and
  `app.ask_spend` DDL.
- `web/package.json` (edited, per COMMON-web's "except a dependency you truly need" carve-out) —
  added `@anthropic-ai/sdk`, `zod` (deps) and `tsx` (devDep, to run the eval script — it needs
  esbuild-style extensionless-relative-import resolution that plain Node's `--experimental-strip-types`
  doesn't do), plus the `ask:eval` script.

## Routes

- `/ask?q=` — server-rendered (no streaming, per the brief). Routes via `router.ts`; for the model
  path: refuse → renders inline; search → redirects to `/search?...` with filters as query params;
  question → retrieves, answers, validates, and either redirects to `/a/<id>` (success) or renders
  the insufficient-evidence view inline (no permalink for a non-answer). No key / rate-limited /
  over daily cap / a failed model call all degrade to `/search?q=...&note=...`.
- `/a/[id]` — frozen permalink, renders exactly what was stored; never re-runs retrieval or the
  model.

## The 5 test outcomes (dev server, port 3104, real `ANTHROPIC_API_KEY` sourced from
`~/Code/prospect/.env.local` into the shell only — never written to a file)

Corpus caveat: the local `site`/OpenSearch dev data is a **partial** mirror (10,595 of 24,436
pages have text/are indexed), so a couple of these came back "insufficient evidence" — that's the
citation-discipline path working correctly on thin data, not a bug (confirmed by hand: the model's
top-12 retrieved pages genuinely didn't contain an October 2001 asbestos reading, though 28 other
indexed pages elsewhere in the corpus do — a retrieval-ranking gap on this partial index, not a
plan/answer bug).

| # | Question | Outcome | Plan usage (in/out) | Answer usage (in/out) | Est. cost |
|---|---|---|---|---|---|
| 1 | "Was asbestos found in buildings on Liberty Street in October 2001?" | `question` → 12 pages retrieved → 0 sentences survived validation → **insufficient-evidence view**, with an honest "what is missing" explanation | 1116/77 | 3176/153 | ~$0.0028 |
| 2 | "What did DEP measure at 130 Liberty Street?" | `question` → 12 pages retrieved → 0 sentences survived → **insufficient-evidence view** | 1112/78 | 2987/120 | ~$0.0025 |
| 3 | "Who is behind the redaction on this page?" | `refuse` → **refusal view**, correct reason text, no retrieval/answer call made | 1110/74 | — | ~$0.0011 |
| 4 | `NYC-WTC_000003413` (a real Bates number in this dataset) | router `bates` → **307 to `/doc/NYC-WTC_000003413`**, no model call at all | — | — | $0 |
| 5 | "asbestos liberty" (two-word keyword) | router `keyword` → **307 to `/search?q=asbestos%20liberty`**, no model call at all | — | — | $0 |
| bonus | "What did DEP say about the asbestos clean-up at 114 Liberty Street?" (chosen to hit well-covered content) | `question` → 12 pages → 6 sentences survived validation → **saved to `app.answers`, 307 to `/a/<id>`**; permalink verified: citations render, source rail shows the 3 actually-cited pages, one citation's `/doc/.../p/2` link resolves 200 | 1120/73 | 2983/443 | ~$0.0066 |

Total across the full eval run (20 cases) + these 6 live requests: **$0.045, 20 calls** recorded in
`app.ask_spend` for today — comfortably under the $5 default cap. `npm run ask:eval` output: **20/20
pass** (the "official capacity" case, `a03`, false-refused once before a prompt tweak — see below).

## Fixes made while testing (not just written blind)

1. **Haiku 4.5 rejects `output_config.effort`** (400 `invalid_request_error`) — removed it from both
   model calls; Haiku has no thinking/effort knob at all for this task shape.
2. **A false refusal**: "Who signed the inspection report as the DEP inspector of record?" was
   initially refused. The privacy rule (officials named by role are fine) was in the prompt but too
   weak against the identity-question examples next to it; strengthened with an explicit
   NOT-a-refusal paragraph. Re-ran the eval: 20/20.
3. **Filter fragility (real bug, fixed)**: the model's `address`/`agency`/`lab` filter values
   ("Liberty Street", "DEP") don't equal the index's exact keyword-field strings ("114 LIBERTY
   STREET", "Environmental Protection, Dept. of") — a hard OpenSearch `term` filter on them
   silently returned **zero hits** every time, even when the corpus had clearly relevant pages
   (verified directly against OpenSearch). Fixed in `retrieve.ts`: only `contaminant` (a short,
   reliably-lowercased vocabulary) is a hard filter; the rest are folded into the free-text query
   as a soft relevance signal instead. This is `/search`'s facet UI never hits, because a facet
   value comes *from* the index; Ask's model-generated value doesn't have that guarantee.

## Known gaps / left undone

- **Citation hover preview shows the full page thumbnail, not a tight crop** around the cited span.
  A real crop needs the excerpt's matched character offsets mapped onto the page's word boxes
  (`lib/boxes.ts` gives word-level boxes, not char offsets) — nontrivial matching problem, left as
  a follow-up.
- **No "you might not know to look for" discovery section** on the answer page (design shows one).
  Not in the B3 task list item-by-item; `lib/opensearch.ts`'s `moreLikePage()` would be the cheap
  way to add it later (zero extra model cost).
- **`bin` filter** (building id) has no field in the OpenSearch mapping yet — dropped; belongs with
  A2/B5's place-resolution work.
- **Daily spend cap and per-IP rate limit are both best-effort**, not hard ceilings — see the
  header comments in `spend.ts` and `rateLimit.ts` for exactly why (two Dokploy replicas, no atomic
  reserve step, in-memory-per-process counters).
- Prompt caching never engaged in testing (`cache_write=0`/`cache_read=0` throughout) — the system
  prompts are well under Haiku's minimum cacheable-prefix size for this short a turn; not a bug,
  just not worth chasing at this token volume.

## For the coordinator

- **Nav**: confirmed nothing links to `/ask` yet (as flagged). I reused `Header active="/search"`
  for all Ask views, same as `/search` itself — there's no dedicated "Ask" nav entry, matching the
  design's single "Ask & search" tab.
- **Home page search form**: `components/SearchBox.tsx` (shared, outside my allowed paths — I did
  not edit it) still does a plain GET to `/search` for everything. For Ask to be reachable from
  `/`, it needs to post to `/ask` instead (or add client-side routing: a Bates number / short
  keyword still short-circuits identically inside `/ask` itself, so pointing the form at `/ask`
  unconditionally is safe and simplest — `/ask` does the same router.ts dispatch either way).
  Small patch, one `action="/search"` → `action="/ask"` plus copy tweak ("Search →" / "Ask →" per
  the design's home vs. results forms) — didn't make it since `SearchBox.tsx` is shared, not under
  `components/ask/`.
- **`web/.env.local`** in this worktree already had `OPENSEARCH_URL`/`USER`/`PASSWORD` populated
  (presumably from an earlier session) — I didn't need to add anything there. `ANTHROPIC_API_KEY`
  was sourced into the shell only for local runs, per instructions; nothing was written to disk.
