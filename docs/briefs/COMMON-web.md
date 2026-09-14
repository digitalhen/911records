# Common rules for every web/ feature brief (B2–B6)

You are working in a git worktree of `github.com/digitalhen/911records` on your own branch. The
app is `web/` (Next.js 15, App Router, TypeScript, plain CSS ported from `design/astra/style.css`).
Read, in this order: `docs/PLAN.md` (architecture, URL scheme, schema `site`), `web/README.md`
(conventions, env, how data flows), then the existing routes and `web/lib/*` so you reuse the
db, OpenSearch and files helpers rather than inventing new ones. The design you are implementing
is in `design/astra/` — open the named `.html` files in a browser or read them; match their
structure, copy, density and restraint. Fixture names there are fictional; the app shows real
data from Postgres (schema `site`) and OpenSearch.

Rules:
- Work only inside `web/app/<your routes>`, `web/components/<your feature>/` and new files under
  `web/lib/<your feature>/`. **Do not edit** `web/app/layout.tsx`, the nav, `web/app/globals.css`,
  `web/lib/db.ts`, `web/lib/opensearch.ts`, `web/lib/files.ts`, `next.config.ts`, `package.json`
  (except to add a dependency you truly need — say so in your notes) or the Dockerfile. If a
  shared change is needed, write it as a small patch description in `web/NOTES-<brief id>.md` and
  code around it for now.
- Server components read the database with the helpers in `web/lib/db.ts` (reads go to the
  read URL). Never import `web/lib/db.ts` from a `'use client'` file.
- Privacy rules are hard: no private individual's name is ever rendered by anything you build;
  people appear only as `signatories` rows (official capacity) with their role and the record;
  no co-mention or "who appears with whom" feature; no network graph of people. Machine-derived
  values show a "machine-extracted" label and a link to the page. Never claim the AI cannot be
  wrong. Removed documents (`documents.status = 'removed'`) are never served: link targets for
  them go to the 410 notice the viewer already returns.
- SEO: every page you add exports `generateMetadata` (title pattern from PLAN, description,
  canonical) and, for entity/building/topic pages, adds its URLs to the sitemap hook described in
  `web/README.md`.
- Do not commit. Do not run `npm run build` (it fights other agents); verify with
  `npx tsc --noEmit` and `npm run dev -- -p <your port>` plus `curl` of each route you added.
- End with a report under 30 lines: routes added, files, what you verified with which URLs,
  anything left undone, and any shared change you need from the coordinator.
