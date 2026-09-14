# Design brief — 9/11 City Records explorer (redesign)

You are designing the front end for an independent explorer over New York City's newly released
9/11 records. Produce **static, self-contained HTML/CSS mockups** in this directory
(`design/astra/`). Work only inside this directory; do not read, create or modify anything
else in the repository (other agents are working in it), do not commit, and do not access the
network. Google Fonts `<link>`s are the only external reference allowed; everything else is
inline.

## Why a redesign

A first design exists (built by another model). Henry, the owner, says it **"feels very AI-like."**
It had: warm cream "paper" ground, Source Serif headings with Source Sans body, rounded cards,
a dashed ochre chip on every machine-derived value, oxblood accents, sticky-note annotations,
a centered hero with a big search box and three equal "evidence task" tiles, plain-language
helper paragraphs everywhere. Treat that as the thing to move away from. Specifically avoid the
tells of generated UI:

- beige/cream + serif + rounded-card grids; equal-weight three-tile feature rows; centered heroes
- pastel pills/chips sprinkled on everything; gradients; glassmorphism; drop shadows as decoration
- sparkle ✨ / magic-wand "AI" iconography, robot or brain icons, "Powered by AI" badges
- generic copy ("Unlock insights", "Explore the archive", "Your journey"), emoji, exclamation marks
- decoration that carries no data; symmetric layouts chosen because they are symmetric

Aim instead for something that looks **made by a small, serious team for people doing real work**:
an instrument, not a landing page. Think of the lineage of court and archive tools
(docket systems, finding aids, newsroom document tools, a well-set legal brief, a transit or
financial terminal's information density) — but make your own call; do not copy any product.
Typography, grid, rhythm and restraint should do the work. Real-looking data, dense where density
helps, calm where people will be reading hard material.

## Who it is for

- **9/11 families** and **families of people who got sick** after the attacks, many pursuing
  compensation (World Trade Center Health Program, the Victim Compensation Fund) — often
  non-lawyers, often reading painful material.
- **Lawyers** pursuing compensation or suing the City — they need exhibits, precise citations
  and speed.

Their core jobs: *what was measured where and when* (asbestos, lead, dust, air readings by building
and date); *what the City knew and when* (memos, liability discussions, re-occupancy decisions);
*proof for a claim* (records placing conditions at a building or presence at a site); and keeping
up as the City releases more records monthly (and sometimes removes or re-redacts them).

Tone: respectful and plain. No sensationalism. Never cute.

## The headline change: "Ask anything"

The primary search field becomes a single **"Ask anything"** input that accepts both a natural
question ("Was asbestos found in buildings on Liberty Street in October 2001?") and plain keywords
or a Bates number (`NYC-WTC_000058160`). Design both outcomes, and make the difference legible:

1. **AI answer** (for questions): a short answer written only from the records, where **every
   sentence carries citations to specific Bates pages** you can open; a visible list of the
   documents/pages it read; what the records do *not* establish; ways to narrow or follow up;
   and a one-click switch to the underlying document results. It must be obvious this is a
   machine-written summary to verify against the pages — say so in plain words, without an "AI"
   badge aesthetic. It never shows private individuals' names.
2. **Document results** (keywords, filters): hit-highlighted snippets, facets (collection, agency,
   box, folder, production volume, derived year, contaminant, address), result counts, sort.

Also show the empty state (suggested questions for families and for lawyers), a loading/"reading
records" state, and an answer where the records are insufficient.

## Screens to produce

Create `index.html` (a contents page linking every screen with one line on each) plus:

1. `home.html` — Ask anything, what the collection is, recent releases/changes, entry into browsing.
2. `answer.html` — an AI answer to a realistic question, with citations and the switch to results.
3. `results.html` — keyword search results with facets.
4. `document.html` — document viewer: page image placeholder beside OCR text, hits within the
   document, Bates page stamps, metadata, machine-derived facts (dates, addresses, contaminants,
   readings) distinguished from the City's own metadata, "cite this page", link to the official
   City PDF, "report personal information that should have been redacted".
5. `browse.html` — the physical order: collection → box → folder → documents.
6. `case.html` — a case folder: saved pages with notes, exhibit order, export an exhibit list
   (Bates ranges + official URLs).
7. `changes.html` — release and change log (added / removed / re-redacted), with saved-search alerts.
8. `mobile.html` — phone-width frames (≈390px) of Ask + answer and the document page, side by side.

Plus `NOTES.md` (≤300 words): the direction, type and colour choices and why, and how the AI answer
earns trust. Keep screens consistent as one system (shared `style.css` is fine).

## The data — be faithful, do not invent fields

- 24,436 PDF documents, 172,537 pages, released 2026-09-08 by the NYC Law Department; more monthly.
- Identifiers: Bates numbers `NYC-WTC_000000001` style; each document is a Bates range, one number
  per page. Official PDF URL: `https://sept11documents.cityofnewyork.us/apps/content/September11_MD/<Bates>.pdf`.
- Collections (source): "DEP Hard Copies (68 Boxes)" 21,392 docs · "WTC 7" 3,023 · "DORIS Giuliani" 21.
- Agencies: Environmental Protection 21,392 · Citywide Administrative Services 2,915 · Fire
  Department 96 · Records and Information Services 21 · Design and Construction 9 · Buildings 3.
- 74 boxes (e.g. "DEP Box 57"), 4,172 hand-written folder labels. Many DEP folders are organised by
  downtown building address (Liberty, Cedar, Pine, Broadway, Beaver, Gold Streets) and lab analyses
  (GC-MS results), plus correspondence and EPA/DEP coordination.
- Per document the City provides: Bates start/end, collection, agency, box, folder label, production
  volume (NYC-WTC0001–0007), page count, file size. **Not provided:** document date, type, author,
  title — anything like that is machine-derived from OCR text and must look derived.
- OCR is imperfect; about 1 in 10 small documents is an image-only scan with no text layer.
- Documents can be removed or re-redacted by the City; the explorer keeps a change log.

## Hard rules

- **No real names of private individuals anywhere.** Use roles ("Resident, Liberty St.",
  "Inspector") or `[redacted]`. Public offices ("Office of the Mayor", "Corporation Counsel") are fine.
- All document text, snippets, readings and answers are **plausible fixtures**, clearly generic
  (air-monitoring logs, asbestos sampling results, inter-agency memos). Do not claim they are real.
- US English. No "draft", "mockup" or "lorem ipsum" markers inside the screens themselves.
- Must work at desktop (1440px) and not break at phone width.
- When finished, print a short summary: the files written and the design direction in 3–5 sentences.
