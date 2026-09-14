# B2 integration and verification

- B5: import `{ HomePanel, HomePanelFallback }` from `@/components/home/HomePanel`.
  Mount `<HomePanel />` in the home side panel / mobile sheet; it handles database failures.
  Mount `<AdUnit />` from `@/components/ads/AdUnit` once below home content, outside the map
  overlay. The panel itself does not contain an ad. B2 did not edit `/`.
- Ads on browse and changes are wired. `NEXT_PUBLIC_ADS=off` renders nothing; set at build time.
  Publisher/slot and ads.txt match the holding page. Coordinator must verify the existing
  AdSense account's consent-message configuration before relying on the carried-over consent copy.
- Browse uses `/browse/<agency>/<volume>/<box>/<folder>` and `?source=<City collection>`.
  Each path level is optional from the right. `~` means missing metadata, `~e` an empty label;
  actual tildes are doubled. All City labels are preserved; descriptions are not inferred.
  Documents and changes paginate at 100 rows, with stable Bates ordering.
- Existing README has no extensible sitemap hook (only document chunks). B6/coordinator:
  include `informationSitemapPaths()` from `web/lib/info/sitemap.ts` in the shared sitemap.
- The shared runtime helper has no report table helper. `lib/info/reports.ts` uses primary-only
  `withTransaction`, an advisory lock and first-use DDL for `app.reports` (UUID id, created_at,
  bates_page, location, note, status). Move its DDL to the shared runtime migration when ready.
  Reports are private and never echoed publicly. No email or automatic restriction is implemented.
  Coordinator must assign manual report review/restriction to meet the policy's response standard.
- Foundation issue remains: removed viewer notices return HTTP 200, not 410 (README known gap).
  B2 never links removed change/browse rows to the viewer, including historical added entries.
- Verified: `npx tsc --noEmit`; offline SSR/API assertions covering removed-link suppression,
  unavailable home fallback, segment round trips, report validation/origin/body limits,
  mocked report success/failure and no-JS redirect, exact ads.txt and ads-off rendering.
  Harness: `/tmp/b2-check.cjs`; no live reports inserted.
- Runtime blocked by sandbox: `npm run dev -- -p 3101` fails `listen EPERM`.
  Localhost curl attempts cannot connect. Live PostgreSQL, runtime routes, report persistence,
  AdSense fill and visual checks at 360/390 px remain unverified. Responsive feature CSS is scoped.
- No dependencies added, no shared files edited, no build or commit run.
