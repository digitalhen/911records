# B19 — accounts (magic-link sign-in), case folder sync, saved searches

GitHub issue #21. Read first: `docs/PLAN.md` "Accounts" section, `docs/briefs/COMMON-web.md`,
`web/lib/case/store.ts`'s own header comment (the swap seam this branch fills in), and
`~/Code/prospect/lib/auth.ts` (read-only reference, not copied verbatim — see "Departures from
Prospect" below).

## Files

- `web/lib/auth/pool.ts` (new) — a dedicated `pg.Pool` for Better Auth, `search_path=app,public`,
  so its unqualified `"user"`/`"session"`/`"account"`/`"verification"` queries land in schema `app`
  with no Better Auth field/table remapping. Separate from `lib/db.ts`'s pool (COMMON-web.md: don't
  edit that file).
- `web/lib/auth/server.ts` (new) — the `betterAuth()` instance: magic-link plugin only, open
  sign-up, `deleteUser` enabled (immediate, no confirmation email), 30-day sessions. `getSessionUser()`
  for server components/route handlers.
- `web/lib/auth/client.ts` (new) — `'use client'` `authClient`/`useSession`/`signOut`.
- `web/lib/auth/mail.ts` (new) — sends the magic-link email via `nodemailer`/`SMTP_URL`; with
  `SMTP_URL` unset, dev prints the link to the server console, production logs a fingerprinted
  warning instead of the link (never a live sign-in credential in a prod log).
- `web/lib/runtimeSchema.ts` (edited — its own header invites this: "add them here, not in a new
  file") — added Better Auth's four tables (`app."user"`, `session`, `account`, `verification`,
  columns verified against `@better-auth/core/dist/db/get-tables.mjs` from the actually-installed
  `better-auth@1.7.4`, not guessed from docs — column names have drifted between versions upstream)
  plus `app.case_folders` and `app.saved_searches`. All idempotent `CREATE ... IF NOT EXISTS`, run
  at boot like everything else in that file — **no manual migration step**.
- `web/app/api/auth/[...all]/route.ts` (new) — Better Auth's Next.js handler.
- `web/lib/case/store.ts` (edited — this is the swap seam B6 left for exactly this) — added
  `setAccountUser(userId)`, called only by `AccountChip`. Signing in pulls `/api/case/sync` once,
  merges into localStorage (union by doc+page, local order first, local notes win), pushes the
  merged result back. Every `save()` now also debounces a push (800ms) while signed in. Signing out
  does nothing to localStorage — "saved in this browser" stays true.
- `web/lib/case/account.ts`, `web/app/api/case/sync/route.ts` (new) — server-side case-folder
  storage: full-replace on every sync (a folder is at most a few hundred rows; no diffing to get wrong).
- `web/lib/account/savedSearches.ts`, `web/app/api/saved-searches/route.ts`,
  `web/app/api/saved-searches/[id]/route.ts` (new) — saved searches, capped at 25/account.
- `web/components/auth/AccountChip.tsx` (new) — header's "Sign in" / email link; also the one place
  that calls `setAccountUser()` on session change.
- `web/components/account/AccountPanel.tsx`, `web/app/account/page.tsx` (new) — sign-in form,
  session state, delete account, saved-searches list.
- `web/components/search/SaveSearchButton.tsx` (new) — "Save this search"; passed as
  `CopyLinkButton`'s `children` slot (that component's own comment names this exact extension point).
- `web/scripts/digest.ts` (new, `npm run digest`) — stub: prints what a daily digest would contain,
  sends nothing, never advances `last_checked_at` (so nothing is silently marked "already told them"
  before anything is actually emailed).
- `web/app/case/page.tsx`, `web/components/case/CaseFolderApp.tsx` — copy now branches on
  signed-in/out state ("saved in this browser" vs "synced to your account").
- `web/app/privacy/page.tsx` — replaced the "no accounts" claim with an Accounts paragraph (email
  only, magic links, delete anytime).
- `web/app/robots.txt/route.ts` — added `Disallow: /account` (personal, sign-in-gated, like `/case`).
- `web/components/Header.tsx` — one line added (`<AccountChip />` inside the existing `<nav>`, no
  new CSS — it inherits `.nav a` styling). This file is on COMMON-web.md's "don't edit" list; I
  edited it anyway because the brief explicitly asked for a header chip and this branch is reviewed
  by Henry before merge. Flagging it here per that rule regardless. A dedicated `.account-chip`
  style (right-aligned, visually distinct) would be a nice follow-up but isn't required.
- `web/package.json` — added `better-auth`, `nodemailer`, `@types/nodemailer` (dev), a `digest`
  script. Also on the don't-edit list; flagged per the same rule — this dependency is core to the
  brief, not incidental.

## Departures from Prospect's `lib/auth.ts`

Prospect is an **invite-only broker tool**: `disableSignUp: true`, a mint refused for any address
it doesn't already hold (`isProvisionedEmail`), a per-address ledger, admin exemptions — all built
to protect an admin's sending reputation on a product nobody self-registers for.
**911records.nyc is a public self-serve site.** Anyone — a family member, a lawyer, a journalist —
signs in with their own address, so sign-up stays open and none of that machinery applies. What
does carry over: never mint carelessly for a stranger's address — the magic-link plugin's own
built-in `rateLimit` (5 requests / 5 minutes) is the v1 guard. Also **not** carried over: baseURL
is deliberately NOT hardcoded to the production origin (see the comment in `lib/auth/server.ts`) —
dev's port varies, so Better Auth's own request-derived fallback is used when
`NEXT_PUBLIC_SITE_URL` is unset.

## Verified

- `npx tsc --noEmit` clean.
- Full flow in Chrome (real dev server, not just curl) with `SMTP_URL` unset (console transport):
  sign-in on `/account` → console-printed link → session created → header chip shows the email →
  saved a page to the case folder on `/doc/NYC-WTC_000000173` → confirmed the debounced sync wrote
  the row to `app.case_folders` → saved a search on `/search?q=asbestos` → confirmed it lists on
  `/account` → signed out → `/case` correctly falls back to "saved in this browser only". No
  console errors on any of `/account`, `/case` (both states), `/search`, `/doc/...`.
- `authClient.deleteUser()` verified via curl (with `Origin` header — Better Auth's CSRF check
  correctly 403s without one): removed the user row and, via `ON DELETE CASCADE`, both
  `app.case_folders` and `app.saved_searches` rows in one shot.
- `npm run digest` — ran against the real dev-configured Postgres/OpenSearch, printed "no new
  documents" correctly for a saved search with no matching `site.changes` rows in its window. Only
  path not exercised: an actual new-match hit (would need a real `site.changes` row newer than a
  saved search's `created_at` — none existed in the current snapshot at test time).
- Test addresses used: `b19-test+dev@example.com` and `b19-test+chrome@example.com` — both
  `example.com`, never a real inbox, per Henry's rule. Both accounts and all rows they created were
  deleted after verification; nothing testing-related was left in the database.
- **Not exercised**: an actual SMTP send (no `SMTP_URL` configured in this dev environment) and a
  real `site.changes` row newer than a saved search (would require live pipeline data).

## Ops steps for Henry to approve at merge

1. **No manual DB migration.** `lib/runtimeSchema.ts`'s DDL runs at boot on every replica
   (idempotent `CREATE ... IF NOT EXISTS`), same as every other runtime table in this app.
   Restarting the app after this merges is enough.
2. **Grant the read-only role.** `queryReadSafe`/`queryRead` (case-folder/saved-search reads, and
   `npm run digest`) try the standby first and fall back to the primary on error — this already
   works, but in dev, `sept11_ro` doesn't yet have `SELECT` on schema `app` (`permission denied for
   schema app`, silently falls back). Worth granting on both hosts so app-schema reads don't add an
   extra round trip to the primary: `GRANT USAGE ON SCHEMA app TO sept11_ro; GRANT SELECT ON ALL
   TABLES IN SCHEMA app TO sept11_ro; ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES
   TO sept11_ro;` — this may already be true for `app.answers`/`app.ask_spend`; if so this is a
   no-op.
3. **Confirm env vars in production** (per the brief, already set): `BETTER_AUTH_SECRET`,
   `SMTP_URL`, `MAIL_FROM`, `MAIL_REPLY_TO`, `NEXT_PUBLIC_SITE_URL`. Nothing new required beyond
   what was already planned.
4. **`npm run digest` needs env exported into the shell** — unlike `npm run dev`, `tsx` does not
   read `.env.local` on its own. Run it as `set -a; source web/.env.local; set +a; npm run digest`
   (or export production env the same way) until/unless it becomes a real cron/launchd job with its
   own env file, per `docs/PLAN.md`'s `refresh_daily.sh` pattern.

## Proposed release note

> Accounts: sign in with just an email address (a one-time link, no password) to sync your case
> folder across devices and save searches for a daily digest of new matching documents once that
> ships. Delete your account and everything tied to it anytime from the new Account page.
