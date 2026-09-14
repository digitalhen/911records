# Brief B4 — entities, signatories, topics, related records, versions

Read `docs/briefs/COMMON-web.md` first. Dev port: **3102**.

Design sources: `design/astra/entities.html`, `entity.html`, `signatory.html`, `topics.html`,
`versions.html`, and the "related records" and "more like this page" panels in `document.html`.
Data: schema `site` tables `entities`, `entity_pages`, `signatories`, `signatory_pages`,
`topics`, `doc_topics`, `related`, `near_dupes`, `documents`, `pages`; plus the OpenSearch k-NN
helper in `web/lib/opensearch.ts` if one exists for "more like this" (if not, write
`web/lib/discovery/moreLikeThis.ts` that takes a page's vector from OpenSearch (`vector` field,
`_source`) and runs a k-NN query excluding the same document; the README says how the client
is configured).

## Routes

1. `/entities` — entity search: a text box with typeahead over `site.entities` (server action or
   `/api/entities/suggest?q=`), grouped by type (lab, agency, contractor, substance, address,
   signatory-by-role), each result with counts and a link. The design's filter-token idea
   (`lab: …`, `substance: …`) is rendered as links into `/search?q=&lab=…` style filters — use
   whatever filter params `/search` already supports (read `web/app/search`); do not add new
   filters to `/search` yourself; list wanted ones in your notes.
2. `/entity/[type]/[slug]` — counts, date span (`first_date`/`last_date`), activity over time (a
   simple inline SVG histogram by month from `entity_pages` joined to `pages`/dates — no chart
   library), the boxes/folders it appears in, documents grouped by the role the entity plays
   (`entity_pages.role`), every count linking to the pages behind it, and the
   "machine-extracted, confidence N" label on every value.
3. `/signatory/[slug]` — official capacity only (the table already contains only official rows):
   name, title, org, date span, documents grouped by action (`signatory_pages.action`: signed,
   approved, analyzed, certified, cc'd, …), each item linking to `/doc/<doc>/p/<page>` where the
   signature block is. Copy near the top: why this person appears (their role on records), and
   that appearance implies nothing about anyone. No "appears with" of any kind.
4. `/topics` and `/topics/[id]` — the topic map: topics sized by pages, parent → child, with the
   distinctive terms, spread across boxes and agencies (from the `boxes`/`agencies` JSON columns),
   and the documents in a topic (`doc_topics` ordered by prob). Rendered as an inline SVG
   treemap or nested list; zoomable by clicking a topic; subjects only — labels come from
   `topics.label`/`terms`, never from page text.
5. `/doc/[doc]/versions` — near-duplicates and copies of a document (`near_dupes`), shown side by
   side (two viewer frames using the existing page image URLs), with the score and where each copy
   is filed.
6. Components for the existing viewer, delivered as drop-in components the coordinator will mount
   (do not edit `web/app/doc/**` yourself): `components/discovery/RelatedRecords.tsx` (server
   component: props `{doc}`; ranks `related` rows, splits "filed elsewhere" (`cross = 1`) from
   same-box, gives each a one-line reason from shared entities/topic/box — computed from
   `entity_pages` overlap and `doc_topics`) and `components/discovery/MoreLikePage.tsx` (props
   `{doc, page}`; k-NN over pages). Write `web/NOTES-B4.md` saying exactly where to mount them.
