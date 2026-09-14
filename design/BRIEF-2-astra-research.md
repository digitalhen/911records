# Brief, round 2 — fold in what the Epstein-records explorers taught

Apply this on top of `design/astra/BRIEF.md` and the screens you already produced. Revise in place
inside `design/astra/`; keep the same file set, update `NOTES.md` with what changed and why.
Same hard rules as before (no real private names, fixtures only, no network, work only in this directory).

Source: `docs/research/epstein-explorers.md` (read it if your sandbox allows reading
`../../docs/research/`; otherwise the points below are sufficient).

## What to change

1. **Citation discipline is the product.** Adopt a rule and print it where the answer appears, in
   plain words: if a sentence has no page citation, it is not in the records. Every answer sentence
   links to a Bates page; unsupported sentences are not rendered at all. Show the page image crop
   beside the quoted line on hover/tap (a claim-to-source-image link), not just a link.
2. **Never imply the AI cannot be wrong.** Copy near the answer says it can misread scans and
   OCR, and that the page is the authority. No "grounded", "hallucination-free", "verified" language.
3. **Role next to every name-like thing.** Wherever a person, office or company appears in an answer
   or in extracted entities, show *why* it appears (author / recipient / cc / named in a complaint /
   inspector of record / signatory / listed on a form). A bare "appears in 14 documents" list is
   not allowed — that pattern wrongly branded innocent people in the Epstein releases.
4. **People appear only in an official or professional capacity, always with their role.** Henry
   wants to search by the people who **signed, authored, approved, analyzed, inspected or
   certified** records, alongside labs, agencies, contractors and buildings. So: a person is
   searchable only as a *role on a record* — "Commissioner, DEP — signed 41 memos", "Analyst,
   [lab] — certified 212 sample reports", "Inspector of record — 18 inspections" — and every
   appearance shows the role and the document. **Private individuals are never surfaced**:
   residents, complainants, patients, claimants, and workers' personal or medical details get no
   entity pages, no search, no suggestions. Still no co-mention ("who appears with whom") search
   and no social/network graph of people — relationships shown are person → role → record only.

11. **Search by entity.** Design an entity-search experience next to Ask anything:
    - typeahead that recognises entity types as you type (lab, agency/office, contractor, building
      or address, substance, signatory-by-role, date range, Bates number) and turns them into
      removable filter tokens alongside free text (e.g. `lab: [a testing laboratory]` ·
      `substance: asbestos` · `address: Liberty St` · `signed by role: DEP commissioner`);
    - **entity pages** for labs, agencies/offices, contractors, buildings/addresses and substances:
      counts, activity over time, the boxes/folders they appear in, top related topics, documents
      grouped by the role the entity plays (issued, analyzed, received, inspected, mentioned);
    - **signatory pages** (official capacity only): role/title, agency, date span, documents grouped
      by action (signed / approved / analyzed / certified / cc'd), with every item linking to the
      page where the signature block is, shown as an image crop;
    - every entity value is marked machine-extracted with its extraction confidence, and every
      count links to the underlying pages, so a lawyer can check it.
    Use obviously generic fixture names for labs, contractors and officials (e.g. "Harbor Analytical
    Laboratory", "Commissioner, Dept. of Environmental Protection") — no real people's names.
5. **A visible, specific personal-information policy** page and a short statement on the document
   viewer: what we remove or hide, how to report a miss, how fast we act, and that appearing in a
   record implies nothing about anyone. Never offer anything resembling "request unredaction" or
   "who is behind this redaction". The AI must refuse questions that try to identify redacted people.
6. **Say where the scans are weak, specifically.** On results and answers, disclose coverage: e.g.
   "about 1 in 10 small documents is an image-only scan with no searchable text; those pages are
   OCR'd by us and marked." Show an OCR-quality indicator per page in the viewer.
7. **Hard-walled scope.** The product covers only the City's 9/11 records. No links, tabs or
   suggestions pointing to other document sets; no "conspiracy"/"cover-up" framing anywhere.
8. **A familiar metaphor, chosen for this audience.** The viral tools won with an interface people
   already knew (an email client). For families and lawyers, the familiar object is a **case file /
   binder with exhibit tabs** and a **records-request response**. Consider making the case folder a
   first-class, always-present workspace (not a buried feature), and consider a shareable, stable
   permalink for every page and every answer (with its citations frozen at the time asked).
9. **Permanence.** Show when a document was captured, whether the City has since removed or
   re-redacted it, and keep citations resolvable (our mirror + the official URL) — archival
   permanence was a key reason people used independent mirrors.

10. **Discovery is a headline feature: help people find what they don't know exists.** Henry's
    words. We compute embeddings for every page and document, topic clusters, related documents and
    near-duplicates. Make that visible and useful throughout — not a gimmick panel, and never styled
    as "AI magic". Design at least these:
    - **Related records on every document and page**, ranked by similarity, each with a one-line
      reason drawn from what they share (same building, same contaminant, same week, same lab
      method, same memo thread) and grouped so the *unexpected* ones stand out: related records
      from a **different box, agency or collection** than the one you are in ("filed elsewhere").
    - **More like this page** on any page or any highlighted passage.
    - **Topic map**: the whole collection laid out by what the records are about (clusters such as
      building-by-building asbestos sampling, GC-MS lab runs, air monitoring logs, re-occupancy
      memos, EPA/DEP coordination, correspondence) — a way in for someone who does not know what
      to ask. Zoomable from topic → sub-topic → documents; sized by pages; shows how each topic
      spreads across boxes and time. This is a map of *subjects*, never of people.
    - **"You might not know to look for"** on the answer page: clusters and documents semantically
      close to the question that the keyword/answer path did not use, with why.
    - **Near-duplicates and versions**: the same form or memo filed in several boxes, drafts vs final,
      re-scans — collapsed in results with "3 copies" and viewable side by side.
    - **Building / address pages**: everything about one address across all boxes (samples,
      readings over time, complaints, re-occupancy decisions), because families and lawyers
      start from "the building I lived or worked in".
    - **Case-folder suggestions**: from the pages saved in a case folder, suggest records that fill
      gaps (similar pages not yet saved, other dates for the same building), each with a reason.
    Discovery must obey items 3–4: suggestions are about records, places, substances, offices and
    dates — never "people like this person".

12. **A map that links to the tests.** Add `map.html` (desktop) and a map frame in `mobile.html`.
    Lower Manhattan, 2001–2003: every building that appears in the records, as a footprint or dot,
    resolved from the Building Identification Number, tax block/lot or street address on the pages.
    Clicking a building opens a side panel: its address, how many records and pages mention it, a
    **timeline of tests** (sample date, substance — asbestos, lead, dust, PCBs, particulates —
    result with units, lab, and whether the page itself says above/below a stated limit), each
    row linking straight to the Bates page with the reading highlighted, plus related memos and
    re-occupancy decisions for that building. Controls: substance, date slider (Sept 2001 → 2003),
    record type (lab result, inspection, complaint, memo), and "only buildings with results".
    Encoding must never imply a health verdict the records do not state: colour by *what exists*
    (has test results / has inspections / mentioned only) or by the record's own stated
    above/below-limit result, with the limit and its source shown — never a red "danger" heat map.
    Show the WTC site and the zones named in the records as reference outlines. Every extracted
    reading is marked machine-extracted with a link to verify. Residences are shown as buildings,
    never as named households. Fixture readings and labs only.

When finished, print the files changed and a 3–5 sentence summary of the revision.
