# B4 — discovery handoff

Implemented `/entities`, `/api/entities/suggest?q=`, `/entity/[type]/[slug]`,
`/signatory/[slug]`, `/topics`, `/topics/[id]`, and `/entities/sitemap.xml?chunk=0`.
No dependencies added; no shared files edited; no commits or production build.

## Coordinator: viewer mounts and versions route

The brief explicitly prohibits editing `web/app/doc/**`; the versions implementation is
ready in `components/discovery/VersionsPage.tsx`. Create `web/app/doc/[doc]/versions/page.tsx`:

```tsx
export const dynamic = 'force-dynamic';
export { default, generateMetadata } from '@/components/discovery/VersionsPage';
```

In `components/DocumentViewer.tsx`, import the named server components
`RelatedRecords` and `MoreLikePage` from `components/discovery/RelatedRecords` and
`components/discovery/MoreLikePage`. Inside the available-document branch only,
after the viewer/metadata grid and before the end of `<main>`, mount:

```tsx
<RelatedRecords doc={doc} />
<MoreLikePage doc={doc} page={page} />
<Link href={`/doc/${encodeURIComponent(doc)}/versions`}>Compare copies and versions →</Link>
```

Keep these after the existing removed-document early return. Both components independently
check authoritative Postgres availability before exposing records. Versions redirects removed
primary records to the existing viewer notice; removed copies get only the Bates link and notice.
The viewer currently returns HTTP 200 for its removal notice (foundation README gap); coordinator
must implement the promised 410 and protect `/files/*` separately. This feature does not fix that.

## Coordinator: sitemap index

README mentions future sitemap lines but exposes no callable registration hook. The new
`lib/discovery/sitemap.ts` exports `discoverySitemapCount()` and
`discoverySitemapPaths(offset, limit)`. `/entities/sitemap.xml?chunk=N` serves up to 5,000
entity, official-signatory and topic paths, plus the two landing pages in chunk zero.
In `app/sitemap.xml/route.ts`, import `discoverySitemapCount`, calculate
`Math.max(1, Math.ceil((await discoverySitemapCount()) / 5000))`, and append a `<sitemap>`
entry for each `${SITE_URL}/entities/sitemap.xml?chunk=${i}` to the existing index.
Paths are encoded, XML escaped, entity types allowlisted, and removed-only entities excluded.

## Data and product limits

- `pages` has no extracted date column. Histogram joins entity occurrences to `pages` and
  corresponding `place_pages.dates`, counting distinct pages in each extracted month.
  Undated pages remain accessible. For complete coverage, add a page-level extracted dates
  table/column and provenance/confidence; do not substitute catalog capture dates.
- `first_date`/`last_date` are pipeline document-date spans, not dated entity occurrences.
  They have no source-specific confidence; displayed as unavailable. Aggregate counts likewise
  have no calibrated confidence. Regex occurrence scores are shown as stored, with a caveat.
- Entity suggestion counts and detail counts use available source pages, not stale total counts.
  Topic sizes/spreads are stored pipeline aggregates and can include subsequently removed records;
  available topic document listings filter removals and paginate 50 at a time.
- Entity suggestions use lab, contaminant and address search filters. Agency entities represent
  *mentioned* agencies, while the current agency facet is the *filing* agency, so no misleading
  agency token is emitted. Wanted search filters: `agency_mentioned`, `contractor`, official action.
- Names occur only on official signatory pages beside their title, organization and source records.
  Suggestions show roles; raw page text, folder labels and person entity types are never shown.
  Topic labels/terms use the pipeline subject-label contract, never OCR snippets.
- Topic bars scale to pages within siblings; children are nested and navigable. Spread counts
  link to the topic record list. Copy comparison makes no claims about chronology or differences.
- Shared OpenSearch transport is private and `getIndexedPage` strips the vector. The new helper
  uses the same environment/auth settings, gets `_source.vector`, runs filtered k-NN excluding
  the source document, then checks every returned page against Postgres. Scores are not probabilities.

## Verification

- `cd web && npx tsc --noEmit`: passed.
- `npm run dev -- -p 3102`: attempted; sandbox rejects listening with `EPERM` on port 3102.
- Read-only Postgres probe also blocked by sandbox (`EPERM` to local database).
- `node lib/discovery/checks.cjs` (from `web/`): passed privacy/removal guards,
  missing-vector handling, source-document exclusion, date parsing and safe URL checks.
- Curls to `http://localhost:3102` all returned HTTP 000 / exit 7 (no listener):
  `/entities`, `/entities?q=asbestos`, `/api/entities/suggest?q=asbestos`,
  `/entity/substance/asbestos`, `/entity/person/private-name`, `/signatory/official-role`,
  `/topics`, `/topics/0`, `/topics/not-an-id`, `/entities/sitemap.xml?chunk=0`,
  `/doc/NYC-WTC_000000001/versions`. Dynamic IDs here are smoke-test inputs, not verified rows.
- Live query correctness, populated rendering, page images and browser interaction need a rerun
  outside this restricted session. Versions route and viewer mounts require coordinator edits above.
