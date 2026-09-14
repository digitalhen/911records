# B15 — every suggested question/search must return results

## Files

- `web/scripts/check-suggestions.ts` (`npm run suggestions:check`) — enumerates every suggestion
  the app can show (home page's static questions, the map panel's data-driven chips) and runs each
  through the real router/planner/retrieval/answer code or a direct OpenSearch/Postgres check, no
  dev server needed. Prints a pass/fail table + cost; exits non-zero on any failure. Caches
  model-path (`'auto'`) checks to `scripts/.suggestions-cache.json` (gitignored) by exact question
  text; `--no-cache` forces a fresh run.
- `web/scripts/lib/register-server-only-stub.mjs` — `lib/map/data.ts` imports the bare
  `server-only` specifier, which only Next's webpack config knows how to resolve; this patches
  `Module._load` (loaded via `node --import`, ahead of tsx) so the check script can import that
  file directly under plain `tsx`. See its own header for why a `node:module` `register()` ESM
  hook alone doesn't cover it (tsx's CJS interop path).
- `web/lib/suggestedQuestions.ts` (new) — `SUGGESTED_QUESTIONS`/`SUGGESTED_QUESTION_GROUPS` moved
  out of `components/home/HomePanel.tsx` (which pulls in `home.module.css` — unloadable outside
  Next's bundler) so the check script, `/ask`, and `/search` can all import the plain list without
  pulling in JSX/CSS. `HomePanel.tsx` re-exports `SUGGESTED_QUESTIONS` for anything still importing
  it from there (nothing does anymore — `/ask` and `/search` were repointed at the new module).
- `web/lib/map/types.ts` — added `placeQuestion()`/`substanceQuestion()` so the map panel's two
  data-driven "question" chip templates live in one place, shared by `MapExplorer.tsx` and
  `check-suggestions.ts` (byte-identical, no drift risk).
- `web/lib/ask/answer.ts` — added `validateFollowUps()`: a cheap per-follow-up lexical search
  (same `search()` used by `/search` itself), dropping any with zero hits, capped at 3. Wired into
  `web/app/ask/page.tsx` right after citation validation, before both the insufficient-evidence
  view and `saveAnswer()` — so a follow-up on `/a/[id]` was checked at generation time, not
  per-view (the permalink is frozen anyway).
- `scripts/refresh_daily.sh` — stage 8, `suggestions:check`, after `opensearch_index`. Non-fatal
  (never uses `run_stage`, which would `exit` the whole script). Builds a `DATABASE_URL` from the
  pipeline's `PGHOST`/`PGPORT`/`PGUSER`/`PGDATABASE` (defaults already used above) with **no
  password**, so node-postgres's own `~/.pgpass` fallback resolves it exactly like libpq does for
  the Python stages — verified directly (`pg` Pool connects with `postgres://sept11@127.0.0.1:5433/sept11`
  and no `.env.local` present). `OPENSEARCH_*` pass through unchanged; `ANTHROPIC_API_KEY` reuses
  whatever stage 8's neighbors already exported from `.claudekey`.

## Fix made (real bug, caught by the checker)

`components/map/MapExplorer.tsx`'s per-building chip asked "What was measured at `<address>` **in
October 2001**?" — a fixed date that's usually wrong (sampling ramped up in 2002-2003, not the
attack month), so it regularly produced a 0-sentence "insufficient evidence" dead end for whichever
building happens to have the most test pages that day. Fixed by dropping the invented date
(`placeQuestion()`); verified across three different real top-test-page buildings, all pass
reliably (multiple runs each).

`lib/suggestedQuestions.ts`'s first "For families" question ("Was asbestos found on Liberty Street
in October 2001?") was flaky against the fuller index (passed some runs, failed others — the exact
"insufficient evidence" gap `NOTES-B3.md` already called out on the old partial index). Replaced
with "Was asbestos found at 114 Liberty Street after September 11?" — same theme, verified stable
across 7+ runs.

## Left as-is (already safe)

`components/case/CaseFolderApp.tsx`'s save-a-page suggestions (`/api/case/suggestions`) are pure
more-like-this results from real saved pages — inherently always real rows, no static/invented
copy involved. Not covered by the checker; nothing to fix.
