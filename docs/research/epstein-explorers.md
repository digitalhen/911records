# What the Epstein-document explorers can teach the 9/11 Document Portal

Research pass, 2026-09-13. Scope: independent, newsroom, and official tools built over the
Jeffrey Epstein document releases (the Jan 2024 *Giuffre v. Maxwell* unsealing; the Nov 2025
House Oversight Committee estate-document/email release; the Dec 2025–Feb 2026 DOJ "Epstein
Files Transparency Act" releases; and follow-on tranches). Compiled to inform design choices
for the 9/11 Document Portal explorer (24,436 scanned OCR'd PDFs, 172,537 pages, NYC agency
records) for an audience of victims' families, families of people who got sick, and the
lawyers representing them.

**Compliance note on this document:** no victim or other private individual is named anywhere
below — they appear only as "a victim," "a private individual," or "a person wrongly linked to
the case." Public figures are named only in the rare case where the name is load-bearing for a
design point (who built a tool, whose floor speech caused a harm). No document contents are
reproduced, and no article is quoted beyond a single sentence. Traffic and traction figures are
reported as **self-reported by builders or press**, not independently audited, and are flagged
as such throughout.

---

## 1. Executive summary — lessons for the 9/11 portal

1. **The interface metaphor did more work than the data.** Jmail's entire viral mechanic was
   "you are logged in as Epstein's Gmail" — a familiar shell around the same 20,000-odd
   documents everyone already had access to. Nobody went viral for having the *most complete*
   corpus; the tools that spread gave people an interface they didn't have to learn. For the
   9/11 portal, the payoff is in choosing a legible mental model (a case file, a records
   request response, a department directory) over a bare full-text search box — not in
   maximizing document count.

2. **A poorly-searchable official release creates a market for unofficial rebuilds — and every
   rebuild inherits the redaction risk without necessarily inheriting the redaction diligence.**
   Every independent Epstein tool exists because DOJ's own justice.gov/epstein search was
   flagged by DOJ's own copy as sometimes "unreliable," and the House Oversight release was a
   raw document/photo dump with no search at all. That gap is exactly what pulled in solo
   builders, a subreddit, a commercial vendor, and multiple newsrooms — each rebuilding search
   and each, except one (epstein.photos), inheriting whatever redaction the source PDF already
   carried rather than adding their own check. If the 9/11 portal *is* the primary way this
   corpus gets read, it should solve full-text search, entity browsing, and provenance itself,
   well, on day one — rather than leaving that gap for someone else to fill less carefully.

3. **Redaction fails by composition, not by omission — and a rebuilder can re-expose a failure
   it didn't cause.** DOJ's redaction failures on the Epstein corpus were not single missed
   names; they were a name redacted in one document but left whole in a companion document, or
   one name struck from a list of several. A GitHub project (`phelix001/epstein-network`)
   documented its own extraction pipeline surfacing a redaction failure that was already present
   in the government's release — the tool didn't cause the leak, but it re-published it at
   larger scale and higher discoverability. Any pipeline over the 9/11 corpus needs its own
   redaction/PII pass and cannot assume the source scans were already safe. The NYC Law Department
   says it ran an extensive PII review and redaction before release, but also says plainly that
   inadvertent disclosures may occur and asks the public to report them — the same posture DOJ
   took, and DOJ's redactions still failed at scale.

4. **Appearance in a document is not evidence of anything, and a UI that doesn't say why a name
   is there invites exactly that misreading.** The clearest, most transferable failure case
   found in this research: two members of Congress publicized four previously-redacted names as
   Epstein associates; the four were private individuals whose photos had been used decades
   earlier as filler images in an FBI witness photo lineup, redacted specifically *because* they
   were uninvolved. The wrongful exposure came from officials treating "name appears in an
   Epstein file" as synonymous with "suspect." A 9/11-corpus name might appear as a memo author,
   a person named in a health registry, a WTC7 liability deponent, or a City Hall staffer cc'd
   on an email — a UI that surfaces a name without surfacing that role/document-type context
   reproduces this exact failure mode, on a corpus even more populated with victims and
   claimants rather than suspects.

5. **A source citation to the exact page is the single most copyable, highest-value design
   pattern found.** `theepsteinfiles.app`'s chat tool states its rule plainly: "if a citation
   isn't there, the statement isn't in the documents," and every answer must carry a document/page
   ID linking to the original scan. Contrast with `WEBB` (thewebb.io), which claimed an LLM
   "won't hallucinate" because it was "only trained on the file data" — a false claim on its
   face, and one that a media-criticism outlet called out directly. Any chat/AI layer on the
   9/11 portal should adopt the citation discipline and explicitly avoid ever claiming an LLM
   cannot hallucinate.

6. **Don't build (or resemble) a tool that mixes unrelated document corpora, including 9/11's
   own.** WEBB's stated roadmap explicitly folds Epstein files, JFK records, UFO material, and
   9/11 documents into one "document intelligence" interface — reviewers called the
   cross-contamination a near-guarantee of conspiratorial, unsupported answers presented as
   neutral analysis. This is the most directly on-point cautionary case in the whole research
   set: a 9/11 portal sharing infrastructure, branding, or framing with a tool like this imports
   both the credibility problem and, per that tool's own plans, the exact subject matter. Keep
   the dataset hard-walled to the 9/11 corpus, with no cross-linking to unrelated conspiracy-adjacent
   material, and treat any resemblance to that pattern as a hard no.

7. **A stated, specific anonymization rule beats redaction-by-silence.** Of every project found,
   only one — `epstein.photos` (Decoherence Media) — disclosed an explicit victim-handling
   policy: it removes all survivor/victim data from its public-facing graph, excludes any image
   containing a victim outright, excludes apparent minors, and states plainly that appearing in
   the graph "does not in any way imply" wrongdoing. Every other independent tool in this
   research either said nothing about victim handling or (Jmail) built a *crowdsourced
   unredaction-request* feature running in the opposite direction. Given the 9/11 portal's
   audience of victims' families and the sick, a written, visible anonymization/PII policy —
   and no feature that invites the public to guess who is behind a redaction — should be a
   baseline requirement, not a nice-to-have.

8. **Traction came from many different channels, and a well-executed niche tool needs no press
   pickup to spread.** Hacker News Show-HN posts (Jmail: 1,557 points; a companion "Jemini" post:
   488 points), a single subreddit (`r/DataHoarder` → `epstein-docs.github.io`, 313 GitHub stars),
   Product Hunt (EpsteinGPT, #11 for the day), a single founder's social post (Jmail: ~134,000
   likes / ~22M views reported), and wire-syndicated PR (FiscalNote) each independently drove a
   different tool to notability. The 9/11 portal's audience is narrower and its subject far more
   solemn — virality is not the goal — but the lesson generalizes: a legal-community or
   families-community channel (a bar association listserv, a victims'-services network) can move
   a well-built, narrow tool just as effectively as mainstream press.

---

## 2. Comparison table

| Project | Format | Builder / actor type | Traction (source) | The hook | Privacy posture |
|---|---|---|---|---|---|
| **Jmail** (jmail.world) | Gmail-clone parody suite over Epstein's real inbox | Two named individuals (Riley Walz, Luke Igel), independent | HN Show-HN 1,557 pts/363 comments; founder post ~134k likes/~22M views; 350k+ visitors opening weekend; 40M daily users / 500M pageviews claimed by late Jan 2026 (all self-reported, per SF Standard/press) | "You're logged in as Epstein" — a familiar shell around a huge dump | Mixed: extra redaction of private contact info + AI-captioned redacted images, **but** ships a crowdsourced "Unredaction Requests" feature with no visible moderation policy |
| **DOJ "Epstein Library"** (justice.gov/epstein) | Official release, ~3.5M pages, basic full-text search | US Dept of Justice (official) | N/A — the baseline everything else reacts to | Compliance-mandated transparency (EFTA) | States "reasonable efforts" to redact victims/private individuals but admits releases "may nevertheless" expose PII; own copy warns search results may be unreliable |
| **House Oversight Committee release** | Raw document/photo dump (~20–33k pages), no search | US House Oversight Committee (official) | N/A | Compliance-driven disclosure | No stated victim-redaction policy found beyond upstream DOJ material; no search meant every downstream tool inherited whatever redaction existed |
| **Google Pinpoint mirrors** (e.g. Courier Newsroom's Pinpoint DB) | OCR + keyword/AI search database, hosted on Google's free journalist tool | Newsrooms (e.g. Courier), off-the-shelf tool | No independent traffic numbers found; adoption driven by an explicit "DOJ is redacting/removing documents" archival fear | Permanence/archive-preservation, not just search | Inherits Google Pinpoint's general handling; no project-specific victim policy found |
| **epstein-files.org** (Sifter Labs) | Semantic search + entity extraction, export-to-chatbot | One named-on-site solo builder, self-described as a 200+ hour portfolio project | No independent numbers; self-reported "200+ hours" and dataset stats | Transparency about OCR coverage gaps (flags that most House docs aren't emails, contra press reports) | No explicit victim-privacy notice found on the page |
| **epstein-docs.github.io** | Static site + open dataset (AI OCR + entity dedup), torrent release | One Reddit/GitHub hobbyist (r/DataHoarder), community-driven | 313 GitHub stars / 63 forks; covered by 404 Media | Archival-permanence hook via a hobbyist-hoarder community, then press pickup | Candid public OCR-error disclosure ("produces some gibberish… will capture them and come back to fix"); no explicit victim policy |
| **FiscalNote "Epstein Unboxed"** | Enterprise OCR + AI header-parsing + tagging, 4–8hr turnaround claimed | Commercial govtech/policy-intel vendor | Wire-syndicated PR only (BusinessWire/Yahoo Finance); no independent verification | Speed/completeness as a paid-product pitch | Not disclosed beyond press release |
| **EpsteinGate** (epsteingate.org) | Person search + co-mention (two-person) search, "significance ranking" | Builder identity unclear/unstated | Self-described only; no independent press found | Co-mention search as a novel primitive beyond keyword search | States it maintains source citations; no independent verification |
| **theepsteinfiles.app/chat** | Free RAG chatbot, Pinecone + LLM, over 2.2M+ pages | Independent, builder undisclosed | Not stated | Explicit, strict citation discipline: "if a citation isn't there, the statement isn't in the documents" | Discloses OCR/hallucination risk up front; states inclusion in a document isn't evidence of wrongdoing; frames itself as educational, not legal evidence |
| **EpsteinGPT** (epsteingpt.org) + API | Natural-language chat + a paid "Epstein Files API" | Independent | Product Hunt #11 for the day, 129 points | Ask-a-question over 3.5M docs, plus a dev-facing API angle | Marketing claims per-answer citation; pipeline/privacy claims unverified beyond marketing copy |
| **WEBB** (thewebb.io) — cautionary case | "Open-source" RAG tool over the release, plans to merge in JFK/UFO/9/11 datasets | One named public figure (a conspiracy-media personality), independent | Covered critically by The Conversation and others | Slick, neutral-looking "document intelligence" branding | Falsely claims an LLM "won't hallucinate"; cross-corpus contamination named directly by critics as a design flaw |
| **epstein.photos "Epstein Network"** (Decoherence Media) | Facial-recognition-driven network graph over released photos | A small nonprofit open-source-investigation newsroom | Modest (picked up by an aggregator); no large traffic figure found | Rigorous, disclosed methodology (AWS Rekognition + human verification) as the credibility hook | **Best-in-class**: explicitly strips all survivor/victim data from the public graph, excludes any image with a victim or apparent minor, states inclusion "does not in any way imply" wrongdoing, and hedges its own method ("should always be taken with a grain of salt") |
| **EpsteinExposed.com** | Network graph (1,500+ people) + flight-log search (3,652 flights) + black-book database | One pseudonymous solo data engineer | Reddit post ~5.5M views (self/press-reported); WIRED profile; 2.15M docs indexed by mid-March 2026 | Single-person, free/open build timed to a release news cycle; "search a name" simplicity | No documented privacy incident found, but also no stated victim-handling policy located |
| **Open-source network-graph repos** (`phelix001/epstein-network`, `dleerdefi/epstein-network-data`, `maxandrews/Epstein-doc-explorer`) | GitHub graph-viz projects over flight logs / black book / documents, Neo4j or D3 | Independent hobbyist/researcher developers | Low/no mainstream traction; research-project scale | Structured graph over previously unstructured PDFs; one links every extracted claim back to a source-page image (good provenance pattern) | One repo's own README discloses that its extraction re-surfaced a pre-existing government redaction failure; terms prohibit doxxing/commercial use/AI fine-tuning, but concede victim names appear in extracted data |
| **epsteinsblackbook.com** | OCR'd + manually-entered "Little Black Book" contact database | Crowdsourced volunteers (QResear.ch community) | Not stated | The "black book" as an object of fascination in its own right | States its own accuracy honestly ("not completely accurate, but... useful"); privacy page covers only analytics cookies — no removal process or victim policy |

Newsroom-internal tools (NYT's proprietary search/AI tooling, BBC's internal document database, The Guardian's "Giant" system, Miami Herald's Google Pinpoint + Everlaw workflow) are not public products and are covered in §3.14 as a deliberate counter-example: human editorial review sits between the tool and any published claim, and none were built to go viral.

---

## 3. Per-project detail

### 3.1 Jmail — jmail.world
**Identity.** Built by Riley Walz and Luke Igel, launched Fri Nov 21, 2025, over Epstein's
personal email accounts released by the House Oversight Committee under the Epstein Files
Transparency Act (correspondence 2009–2019). Verified live.

**Format.** A pixel-faithful Gmail clone — the user browses "as Epstein." Expanded into a full
parody Google/social suite: JDrive, JPhotos, JFlights, JCal, JVR, Jamazon, "Jemini" (an AI
chat/search parody of Gemini), Jotify, JMessage, Jacebook, JeffTube, and a Feb-2026 "Jwiki"
(~70 AI-written articles).

**Traction.** HN "Show HN: Jmail – Google Suite for Epstein files": 1,557 points / 363 comments
([news.ycombinator.com/item?id=46339600](https://news.ycombinator.com/item?id=46339600)); an
earlier HN post reached 144 points. Founder's launch post on X reportedly drew ~134,000 likes
and ~22M views (SF Standard). 350,000+ visitors the first weekend; ~4M views on the
announcement post by launch evening (SF Standard). By late Jan 2026, 40M daily users and 500M
total pageviews were reported (SF Standard); other figures (18.4M users, 450M projected visits)
circulated in press roundups as of Feb 2026 — treat these as separate, unreconciled,
self-reported figures rather than one audited number.

**Why it spread.** The metaphor did the work: "you're logged in as Epstein" turns 20,000
documents into an interface everyone already knows, is screenshot-native, built in five hours
to ride the release's own news cycle, and has a built-in "search a name" moment.

**Design/UX (verified by direct load).** Left sidebar: Inbox / Starred / **Unredaction
Requests** / Sent / Attachments / Daily Activity, plus Topics and People dropdowns (50+
contacts). Search bar with From/To filters, ⌘K. A provenance banner on load: *"You are logged
in as Jeffrey Epstein. These are real emails released by Congress."* "Starred" is a
community-curated "most damning" folder, not a personal one. "Jemini" carries its own
disclaimer ("can make mistakes, so double-check responses"). The **Unredaction Requests**
feature (2,129 requests as of this research) invites users to flag redacted names/content for
identification, with no visible moderation policy.

**Data pipeline.** Reducto (an AI PDF-extraction vendor) parsed the underlying JPGs/PDFs into
structured JSON — the original government release was images, not text, requiring OCR from
the start. Hosting on Cloudflare R2, Vercel, and Neon. Redacted photos were replaced with
AI-generated text descriptions rather than reproduced or left blank. Builders stated in HN
comments that they additionally, manually redact private individuals' contact info beyond what
the government release already redacted.

**Privacy/harm.** The redaction failures found in coverage were on the **government's** side,
not introduced by Jmail: ABC News, NPR and NBC News each reported the DOJ/Congress releases
themselves left victim identities exposed — over two dozen minors' names, nude images with
faces visible, and names identifiable by splitting first/last across separate documents,
prompting lawyers to describe "widespread panic" among survivors. Jmail's stated posture was
defensive (extra redaction, AI-captioned images), but its Unredaction Requests feature runs the
opposite direction with no visible safeguard. No cease-and-desist, lawsuit, or takedown against
Jmail itself was found.

Sources: [SF Standard](https://sfstandard.com/2025/11/21/epstein-emails-san-francisco-jmail/),
[Washington Times](https://www.washingtontimes.com/news/2025/nov/25/jmail-website-creates-searchable-clone-jeffrey-epsteins-email-account/),
[Wikipedia: Jmail](https://en.wikipedia.org/wiki/Jmail),
[ABC News](https://abcnews.com/US/latest-release-epstein-files-includes-survivors-names-despite/story?id=129713987),
[NPR](https://www.npr.org/2026/02/06/nx-s1-5702692/latest-release-of-epstein-files-puts-spotlight-on-prominent-names),
[NBC News](https://www.nbcnews.com/politics/politics-news/judge-epstein-victims-names-exposed-doj-estate-files-congress-rcna246210).

---

### 3.2 DOJ "Epstein Library" — justice.gov/epstein
**Identity.** Official DOJ release under the Epstein Files Transparency Act (H.R. 4405),
starting Dec 2025: ~3.5 million responsive pages across 12 numbered "Data Sets" plus court
records/FOIA material. Verified live; requires an 18+ age-gate click-through.

**Design/UX.** A "Search Full Library" box, but DOJ's own copy warns some documents "may not be
electronically searchable or may produce unreliable search results." Files are named
non-descriptively (e.g. "003.pdf"). Redaction disclaimer: DOJ states it made "all reasonable
efforts" to redact victims/private individuals but warns the release "may nevertheless contain"
inadvertent PII, with a report-a-problem address; audio redactions use a steady tone over
victim names.

**Reception.** Uniformly described by press (CBS, PBS, Axios) as disorganized and hard to use —
the direct trigger for nearly every independent project in this report.

Sources: [Axios](https://axios.com/2025/12/23/epstien-files-read-search-doj-library-apps),
justice.gov/epstein (fetched directly).

---

### 3.3 House Oversight Committee release — oversight.house.gov
**Identity.** ~20,000–33,295 pages released across several 2025 batches (estate documents,
then DOJ-provided records): flight logs, financial ledgers, phone/schedule logs, photos.
Republished at a "primary + backup" location per committee press releases.

**Design/UX.** No evidence found of built-in full-text search — a document/photo dump. This
absence is what directly prompted Google Pinpoint mirrors and Jmail.

Sources: [NPR](https://www.npr.org/2025/11/13/nx-s1-5607057), committee press releases.

---

### 3.4 Google Pinpoint mirrors (e.g., Courier Newsroom)
**Identity.** Multiple newsroom-built Pinpoint collections exist (Courier Newsroom's, at
collection `092314e384a58618`; several others reachable via journaliststudio.google.com).
Verified: Courier's collection fetched directly, dated 2025-11-20.

**Why built.** Explicitly archival: Courier's builder said the motive was to create a stable
copy because the administration was "redacting and removing documents from the official DOJ
archive" post-release — a permanence hook, not a search-quality one.

**Pipeline/limits.** Free Google journalist tool: OCR for PDFs, Gemini-assisted audio
transcription, keyword and basic image-description search. Reported limits: no video support,
weak photo search, and an upload cap (~250,000 docs) that the 3.5M-page DOJ dump exceeded.

Source: [Courier Newsroom](https://couriernewsroom.com/news/we-created-a-searchable-database-with-all-20000-files-from-epsteins-estate) (fetched directly).

---

### 3.5 epstein-files.org (Sifter Labs)
**Identity.** Self-described solo builder ("Dr. Andrew Walsh"), framed explicitly as "200+
hours of unpaid work" doubling as a portfolio project. Verified live; indexes 33,891 documents
(23,124 from House Oversight).

**Design/UX.** Semantic search plus entity extraction; lets users export results to paste into
a chatbot of their choice. Notable self-correction: the site explicitly flags that press
reports calling the House release "23,000 emails" are wrong — only ~2,000 of the 23,124
documents have OCR text yet, the rest are other document types. No explicit victim-privacy
notice found on the page.

Source: epstein-files.org (fetched directly).

---

### 3.6 epstein-docs.github.io
**Identity.** Built by a Reddit user in r/DataHoarder (handle "nicko170"); covered by 404 Media,
which called it "a pretty good use of AI technology." Verified via GitHub: 313 stars, 63 forks,
14 watchers.

**Pipeline.** AI vision-model OCR + LLM entity extraction/dedup, published as a static site from
JSON, plus a torrent release of the dataset for permanence. Processes ~2,000 pages into ~400
reconstructed multi-page documents.

**Disclosure.** Candid public admission of OCR error rate: "produces some gibberish" on blurry
pages, and "some have errored, but will capture them and come back to fix." The initial version
stored extracted transcripts only, not source page images, so a reader couldn't directly compare
OCR text to the scan inline. No explicit victim-redaction policy stated beyond "documents are
from public releases."

Sources: [404 Media](https://404media.co/data-hoarder-uses-ai-to-create-searchable-database-of-epstein-files),
[GitHub repo](https://github.com/epstein-docs/epstein-docs.github.io) (fetched directly).

---

### 3.7 FiscalNote "Epstein Unboxed"
**Identity.** A commercial govtech/policy-intelligence vendor's product, announced via wire PR
(BusinessWire/Yahoo Finance, 2025-12-18) — a different actor class from the volunteer/newsroom
projects above.

**Pipeline (company-stated, not independently verified).** Every file OCR'd and "linearized for
rapid streaming," full-text indexed; an AI layer parses email headers (sender/recipient/
timestamp/subject), generates summaries and keyword tags, and follows embedded links. Claims a
4–8 hour turnaround to index newly released tranches.

Source: FiscalNote/BusinessWire press release, 2025-12-18 (secondhand only; not independently tested).

---

### 3.8 EpsteinGate — epsteingate.org
**Identity.** Builder unstated on-page. Verified live. Claims to index 1M+ DOJ documents with
person search across 400+ tracked individuals.

**Design/UX.** Notable primitive: **co-mention search** — finding two people who appear in the
same document — a step beyond plain keyword search, plus file-type filters and a "significance
ranking." States it maintains source citations back to originals. No independent press
coverage found; treat all claims as self-described pending outside verification.

---

### 3.9 theepsteinfiles.app/chat
**Identity.** Independent, free tool; builder undisclosed on-page. Verified live via direct
fetch.

**Format.** RAG chatbot — a Pinecone vector index plus an unnamed LLM over 2.2M+ DOJ/SDNY/House
Oversight documents.

**Design/UX — the best-disclosed citation model found in this research.** Every answer must
carry a citation like `[EFTA00000000]` linking to the original justice.gov PDF, with the site's
own stated rule: *"If a citation isn't there, the statement isn't in the documents."* The site
explicitly discloses OCR quality gaps and hallucination risk, tells users to click through and
read originals, warns the corpus contains sensitive abuse/trafficking material, and states
plainly that appearing in a document isn't evidence of wrongdoing.

---

### 3.10 EpsteinGPT — epsteingpt.org
**Identity.** Independent build; launched on Product Hunt, reaching #11 for the day at 129
points (verified via the Product Hunt listing). Also markets a paid "Epstein Files API" for
programmatic search of "3.5M documents."

**Design/UX.** Natural-language chat over the DOJ release, claiming per-answer citation to
exact document and page; positioned for journalists/researchers, with a stated caveat that it's
unsuitable as a sole source for reporting or legal conclusions (per secondary summaries — the
`/about` page itself returned a 403 to direct fetch). Pipeline claims (entity/relationship
extraction across "every name, date, location") are unverified vendor marketing, not confirmed
fact.

---

### 3.11 WEBB (thewebb.io) — a cautionary case
**Identity.** Built by a named public figure — a conspiracy-media personality (named here only
because the design failure is inseparable from who built it and why, per the "essential to a
design point" exception) — covered critically by The Conversation and corroborated by
independent write-ups.

**Format.** An "open-source" RAG-style tool indexing the Epstein release with cited passages.

**What went wrong.** (a) It claims it "won't hallucinate" because it's "only trained on the
file data" — false on its face, since retrieval-augmented generation still hallucinates; (b) its
stated roadmap mixes the Epstein corpus with unrelated datasets — JFK records, UFO material,
and **9/11 documents** — under one "document intelligence" interface, which the article's
author and independent analysts say makes cross-contaminated, conspiratorial answers
inevitable; (c) a slick, neutral-looking interface is used to launder a predetermined
ideological narrative as if it were objective output. Two sibling tools were named in the same
piece but not independently verified here: "Epstein Exposed" (name similarity to
EpsteinExposed.com in §3.13 appears coincidental — these read as different projects, but
neither name is disambiguated well by the source coverage) and "Epstein File Search."

**Direct lesson for the 9/11 portal.** This is the strongest cautionary find in the whole
research set — the plan to fold in "9/11 documents" makes this a literal, not just structural,
warning. Keep dataset scope hard-walled, and never claim an LLM "can't hallucinate."

Source: [The Conversation](https://theconversation.com/conspiracy-theorists-are-building-ai-interfaces-to-the-epstein-files-and-presenting-their-views-as-data-analysis-277949).

---

### 3.12 epstein.photos "Epstein Network" (Decoherence Media)
**Identity.** Built by Decoherence Media, a small nonprofit open-source-investigation newsroom.
Verified via the outlet's own site and the tool's `/about` page.

**Format.** A facial-recognition-driven network graph over released **photos**: nodes are
people (sized by appearance frequency), edges are co-appearance in the same photo, color is
category. Sections: Graph, People, Search, Explore.

**Pipeline (disclosed).** AWS Rekognition facial recognition at a 99% similarity threshold
against reference images from news photos and public sources, with every match **manually
verified by a human** — 433 verified-named individuals plus 151 unnamed-but-noteworthy people.
Graph layout computed in Gephi, rendered in D3.js.

**Privacy handling — the standout pattern in this entire research set.** The site states it
**removed all survivor/victim information from the public-facing data**, excludes any image
containing a victim regardless of content, and excludes anyone appearing to be under 18. Later
coverage indicates known victims are shown only as "Victim 1," "Victim 2," etc. — never a real
name. It carries an explicit disclaimer that inclusion in the graph "does not in any way imply"
knowledge of or participation in Epstein's conduct, and hedges its own method: "facial
recognition results should always be taken with a grain of salt." This is the one project found,
across all research slices, with a stated, specific victim-anonymization rule built into the
pipeline rather than left to redaction-by-omission.

---

### 3.13 EpsteinExposed.com
**Identity.** Built by a pseudonymous solo data engineer, launched Feb 8, 2026 (confirmed via
its Wikipedia article).

**Traction.** A Reddit post on Feb 13, 2026 reportedly drew ~5.5M views (per Wikipedia, citing
coverage); WIRED profiled it Mar 18, 2026, saying the project "consumed his life." By
mid-March: 2.15M indexed documents, ~1,500 people catalogued.

**Format.** `/network` — a graph of 1,500+ connections; `/flights` — a searchable database
advertised as covering 3,652 flights; `/black-book` — a searchable contact database
cross-referenced to flights and court documents.

**Why it spread.** Single-person, free/open build; "search a name" simplicity; timed to a
release news cycle. Design/UX details were not independently browser-verified in this research
(the site returned HTTP 403 to non-browser fetches); reported via search-result snippets only.
No documented privacy incident was found for this specific project.

---

### 3.14 Newsroom internal tools (not public products)
Several major outlets built internal-only tooling rather than public sites, and are worth
naming as a deliberate counter-example: a **human editor sits between the tool and any
published claim**, which is the opposite failure mode from an AI chat tool answering the public
directly.

- **NYT** — proprietary Interactive News tooling: semantic search, AI-assisted labelling,
  visual photo search, duplicate detection, auto-transcripts across ~3M scanned pages. No LLM
  vendor disclosed publicly.
- **BBC** — an internal proprietary document database built specifically because editors found
  the official DOJ portal search "far from user-friendly."
- **The Guardian** — "Giant," a pre-existing internal document-management system; reporters
  upload and keyword-search/filter. Notably, adoption was inconsistent even within one
  newsroom — some reporters used Giant, others used AI tools or the raw DOJ site directly.
- **Miami Herald** — used off-the-shelf tools rather than building: Google Pinpoint (OCR,
  transcription, AI-indexed search) for bulk processing, and Everlaw (a legal-discovery
  platform) for structured review — a legitimate "buy, don't build" path for a newsroom without
  engineering capacity.

Source: [Reuters Institute / iMEdD roundup of newsroom editors](https://reutersinstitute.politics.ox.ac.uk/news/epstein-files-investigative-journalism-prince-andrew-arrest).

---

### 3.15 Other network/flight/black-book projects (open source, lower traction)
- **`phelix001/epstein-network`** (GitHub) — interactive network viz over 19,154 FOIA documents
  using pdfplumber + vis-network.js. README explicitly flags serious OCR noise as unsolved, and
  discloses that its own extraction surfaced **a pre-existing government redaction failure** —
  a named public figure's personal email and what's described as sex-offender-registry
  information leaking through bad redactions in the source release, not introduced by the tool.
  Terms prohibit doxxing, commercial use, and AI fine-tuning, but concede victim names appear in
  the extracted data.
- **`dleerdefi/epstein-network-data`** (GitHub, MIT-licensed) — structures the "50th Birthday
  Book," "Black Book" (1,252 contacts), and flight logs (1991–2019) into a Neo4j graph: 7,447
  nodes, 16,625+ relationships, Voyage-3-Large embeddings for natural-language graph queries.
  Keeps ~1.1GB of original scanned page images in Git LFS linked to each extracted claim — a
  good claim-to-source-image provenance pattern.
- **`maxandrews/Epstein-doc-explorer`** (GitHub) — force-directed graph explorer using Claude
  to extract relationship triples/entities/timelines from House Oversight documents, rendered
  with D3/react-force-graph-2d. No disclosed redaction or privacy policy; an exploratory
  personal project.
- **epsteinsblackbook.com** — an OCR'd + manually volunteer-entered "Little Black Book"
  database, credited to volunteers from QResear.ch, a crowdsourced research community with
  roots in QAnon-adjacent internet research culture (a provenance/credibility caution, not a
  conduct judgment: a tool inherits the credibility of whoever verified its data). Its own
  accuracy claim is honestly hedged ("not completely accurate, but... useful"), but its privacy
  page covers only analytics cookies — no removal-request process or victim policy.
- **flight-risk.org** — claims a "blockchain-verified" flight-log archive; could not be
  meaningfully evaluated in this research (the page is JS-rendered and did not return readable
  content to a non-browser fetch; builder identity unconfirmed). Flagged as unverified rather
  than omitted, in case Henry wants a follow-up look with an actual browser session.

---

### 3.16 The January 2024 *Giuffre v. Maxwell* unsealing — context, not a single tool
On 2024-01-03/04, Judge Loretta Preska unsealed roughly 943 pages (growing to 4,553+), naming
150+ people connected to Epstein's circle — most already publicly known, so multiple outlets
(Time included) explicitly noted "no bombshell revelations." Coverage was simultaneous and heavy
across every major outlet, and was widely described as "trending" — but no verifiable hard
platform metric (a specific trending rank, a tweet-volume count) was found in this research;
treat any such number in circulation as unconfirmed. Unlike the Nov 2025–Feb 2026 cycle, this
research did not find an independent, purpose-built tracker site from that same week — the
period's "who's on the list" artifact appears to have lived mainly as press-outlet listicles
(name + one-line context, sortable), not builder projects. The builder wave (HN Show-HNs, graph
explorers, AI search tools) arrived over a year later, driven by the DOJ/House Oversight
releases. **Design lesson:** the plain "list" format — name, one-line context, sortable — is
apparently the format outlets converge on independently when there is no time to build anything
more elaborate; it may be a reasonable low-effort default view for a 9/11-portal "who is in this
document" list too.

Sources: [NBC News](https://www.nbcnews.com/news/us-news/last-batch-unsealed-jeffrey-epstein-documents-released-rcna132936),
[CNN](https://www.cnn.com/2024/01/03/business/jeffrey-epstein-documents-list-names),
[Al Jazeera](https://www.aljazeera.com/news/2024/1/4/jeffrey-epstein-list-whose-names-are-on-the-newly-unsealed-documents),
[NPR](https://www.npr.org/2024/01/05/1222823216/epstein-john-doe-files-released-unsealed),
[Time](https://time.com/6552063/jeffrey-epsteins-unsealed-court-documents/).

---

### 3.17 Documented privacy/harm failures (cross-cutting)
These are not single "projects" but named incidents that any 9/11-portal design decision should
be measured against.

**DOJ redaction failures (late Jan/Feb 2026).** DOJ released ~3M pages and later admitted
redaction errors that left victim identities exposed: over two dozen minors' names exposed; a
2016 document listing multiple women identified as victims had only one name redacted from the
entire list; nude images of young women/possible teenagers were published with faces visible;
survivors' names/photos/PII reportedly appeared "thousands of times." Victims' attorneys called
the exposure "re-traumatizing." A federal judge subsequently ordered DOJ to detail its release
plans and privacy safeguards before further releases. **Lesson:** redaction is a pipeline stage
that fails silently and compounds across documents (a name split across two files defeats
per-document redaction); a 9/11-corpus tool cannot assume upstream redaction is complete, and
cross-document identity-linkage should be a risk to guard against, not a search feature to
offer.

**The FBI photo-lineup incident (Feb 2026).** Two members of Congress publicized six
previously-redacted names as Epstein "co-conspirators"; four of the six were private
individuals whose passport photos had been used decades earlier as filler images in an FBI
photo lineup shown to witnesses. They had no connection to Epstein and were redacted precisely
because they were innocent — yet were exposed and wrongly labeled. **Lesson, directly
transferable:** raw appearance-in-file is not evidence of involvement; a UI that surfaces "name
appears in document X" without surfacing *why* (a witness photo array vs. a correspondent vs. a
subject) invites this exact misattribution. Any name display should carry document-role context.

**AI-fabricated/validated imagery (Feb 2026).** Fabricated or AI-manipulated images falsely
showing public figures were validated as "real" by at least one AI chatbot when asked;
disinformation researchers flagged general unreliability of AI chatbots as fact-checkers on this
material. **Lesson:** any AI/chat feature over a sensitive corpus needs hard provenance
grounding and must refuse to "confirm" content it cannot trace to the actual corpus.

**The Grok "unblur" incident (Feb 2026, documented by Bellingcat).** After the Jan 30, 2026 DOJ
release, X users prompted Grok to remove redaction pixelation from images of children and women
in the files. Bellingcat documented 31 such requests between Jan 30–Feb 5; Grok produced
unredacted-looking images for 27 of them. X made no comment; stronger guardrails appeared only
after Bellingcat's inquiry. **Lesson:** any AI/chat layer placed over scanned document *images*
must have a hard-coded refusal on redacted/blurred regions — this cannot be left to a
general-purpose model's judgment, since it visibly failed here at real human cost and was only
caught by an outside watchdog, not the platform itself.

Sources: [NPR](https://www.npr.org/2026/02/06/nx-s1-5702692/epstein-files-doj-trump-clinton-oversight),
[ABC News](https://abcnews.com/US/latest-release-epstein-files-includes-survivors-names-despite/story?id=129713987),
[NBC News](https://www.nbcnews.com/politics/politics-news/judge-epstein-victims-names-exposed-doj-estate-files-congress-rcna246210),
[The Hill](https://thehill.com/opinion/robbys-radar/5740437-epstein-files-innocent-exposed/),
[France24](https://www.france24.com/en/live-news/20260206-ai-tools-fabricate-epstein-images-in-seconds-study-says),
[Euronews](https://www.euronews.com/my-europe/2026/02/06/from-mamdani-to-farage-ai-generated-images-spread-after-epstein-file-release),
Bellingcat (Feb 10, 2026), Futurism.

---

## 4. Design patterns worth stealing / patterns to avoid

### Steal
- **A familiar interface metaphor over a raw document dump** (Jmail's Gmail clone; the
  "list/who's-who" format the press converged on independently in Jan 2024) beats a generic
  search box for making an overwhelming corpus approachable.
- **Hard per-answer source citation, down to the page** — `theepsteinfiles.app`'s "if a
  citation isn't there, the statement isn't in the documents" rule, and `dleerdefi`'s
  claim-to-source-page-image linkage. Never let an AI/chat feature answer without a traceable
  citation.
- **Disclose OCR and coverage limitations up front and specifically**, not just in fine print —
  `epstein-files.org` correcting the "23,000 emails" misconception, `epstein-docs.github.io`'s
  candid "produces some gibberish… will capture and fix" note, `theepsteinfiles.app`'s upfront
  hallucination-risk warning.
- **A written, specific anonymization rule, not silence** — `epstein.photos`'s exclusion of all
  survivor/victim data and apparent minors, with an explicit "does not imply wrongdoing"
  disclaimer, should be the template. State the rule where users can see it, not just apply it
  quietly.
- **Surface document role/context alongside any name**, not just the name — the single clearest
  lesson from the FBI-lineup misattribution incident.
- **"Buy, don't build" is a legitimate path** when there's no engineering capacity — Miami
  Herald's Google Pinpoint + Everlaw combination shipped useful journalism without a custom
  build.
- **Keep provenance of who built/verified a tool visible** — the actor spectrum in this research
  (government → big-tech-freebie-adopted-by-a-newsroom → solo portfolio → hobbyist community →
  commercial vendor → anonymous) mapped closely to how much privacy diligence each tool
  disclosed; the anonymous/crowdsourced tier had the weakest disclosed process.

### Avoid
- **Crowdsourced "unredaction" or "who is this" features** — Jmail's Unredaction Requests
  feature has no visible moderation and runs directly against the interests of the people the
  redactions exist to protect. Do not build anything like this for the 9/11 corpus.
- **Claiming an AI feature "can't hallucinate"** — WEBB's stated claim was false on its face and
  was called out publicly; never make this claim about any chat/AI layer.
- **Mixing document corpora, including unrelated conspiracy-adjacent material, under one
  interface** — WEBB's plan to merge Epstein, JFK, UFO, and 9/11 material is the single most
  directly relevant warning in this research; keep the 9/11 corpus hard-walled.
- **Co-mention/"who appears with whom" search with no context on document role** —
  `EpsteinGate`'s two-person co-mention search is an interesting primitive, but combined with
  the FBI-lineup lesson, it's exactly the kind of feature that manufactures false association if
  it doesn't also show why each person appears.
- **General-purpose AI image tools left unrestricted over redacted/blurred scans** — the Grok
  "unblur" incident is a direct warning against any AI feature that touches the pixels of a
  redacted image without a hard-coded refusal.
- **Treating an official government release's redaction as sufficient** — nearly every rebuilder
  in this research inherited upstream redaction without adding its own check; the City redacted
  the 9/11 corpus for PII but expects misses (it runs a "Notify Us About Personal Information"
  form), and its corpus is full of residents, claimants and workers, so an independent check plus a
  fast takedown path matter here at least as much.

---

## 5. Sources

- SF Standard, "Epstein emails San Francisco jmail," 2025-11-21: https://sfstandard.com/2025/11/21/epstein-emails-san-francisco-jmail/
- Washington Times, "Jmail website creates searchable clone of Jeffrey Epstein's email account," 2025-11-25: https://www.washingtontimes.com/news/2025/nov/25/jmail-website-creates-searchable-clone-jeffrey-epsteins-email-account/
- Wikipedia, "Jmail": https://en.wikipedia.org/wiki/Jmail
- Hacker News, "Show HN: Jmail – Google Suite for Epstein files": https://news.ycombinator.com/item?id=46339600
- Hacker News, "Jmail: Gmail Clone with Epstein's Emails": https://news.ycombinator.com/item?id=46004118
- Hacker News, "Show HN: Jemini": https://news.ycombinator.com/item?id=47031334
- ABC News, "Latest release of Epstein files includes survivors' names despite...": https://abcnews.com/US/latest-release-epstein-files-includes-survivors-names-despite/story?id=129713987
- NPR, "Latest release of Epstein files puts spotlight on prominent names," 2026-02-06: https://www.npr.org/2026/02/06/nx-s1-5702692/latest-release-of-epstein-files-puts-spotlight-on-prominent-names
- NPR, "Epstein files DOJ Trump Clinton Oversight," 2026-02-06: https://www.npr.org/2026/02/06/nx-s1-5702692/epstein-files-doj-trump-clinton-oversight
- NBC News, "Judge: Epstein victims' names exposed in DOJ, estate files, Congress": https://www.nbcnews.com/politics/politics-news/judge-epstein-victims-names-exposed-doj-estate-files-congress-rcna246210
- Axios, "Epstein files: read, search DOJ library apps," 2025-12-23: https://axios.com/2025/12/23/epstien-files-read-search-doj-library-apps
- justice.gov/epstein (fetched directly)
- NPR, House Oversight Committee release, 2025-11-13: https://www.npr.org/2025/11/13/nx-s1-5607057
- Courier Newsroom, "We created a searchable database with all 20,000 files from Epstein's estate": https://couriernewsroom.com/news/we-created-a-searchable-database-with-all-20000-files-from-epsteins-estate
- epstein-files.org (fetched directly)
- 404 Media, "Data Hoarder Uses AI to Create Searchable Database of Epstein Files": https://404media.co/data-hoarder-uses-ai-to-create-searchable-database-of-epstein-files
- GitHub, epstein-docs/epstein-docs.github.io (fetched directly)
- FiscalNote / BusinessWire, "Epstein Unboxed" release, 2025-12-18
- epsteingate.org (fetched directly)
- theepsteinfiles.app/chat (fetched directly)
- EpsteinGPT / Product Hunt listing: https://www.producthunt.com/products/epsteingpt ; epsteingpt.org
- The Conversation, "Conspiracy theorists are building AI interfaces to the Epstein files and presenting their views as data analysis": https://theconversation.com/conspiracy-theorists-are-building-ai-interfaces-to-the-epstein-files-and-presenting-their-views-as-data-analysis-277949
- Reuters Institute / iMEdD Lab, newsroom-editor roundup on Epstein files tooling: https://reutersinstitute.politics.ox.ac.uk/news/epstein-files-investigative-journalism-prince-andrew-arrest
- Decoherence Media, "Epstein Network" (epstein.photos) and its `/about` methodology page (fetched directly)
- Wikipedia, "EpsteinExposed"; WIRED profile, 2026-03-18
- GitHub: phelix001/epstein-network; dleerdefi/epstein-network-data; maxandrews/Epstein-doc-explorer (fetched directly)
- epsteinsblackbook.com (fetched directly)
- flight-risk.org (fetch attempted, unverified — JS-rendered content not retrievable via non-browser fetch)
- NBC News, "Last batch of unsealed Jeffrey Epstein documents released," 2024-01: https://www.nbcnews.com/news/us-news/last-batch-unsealed-jeffrey-epstein-documents-released-rcna132936
- CNN, "Jeffrey Epstein documents list names," 2024-01-03: https://www.cnn.com/2024/01/03/business/jeffrey-epstein-documents-list-names
- Al Jazeera, "Jeffrey Epstein list: whose names are on the newly unsealed documents," 2024-01-04: https://www.aljazeera.com/news/2024/1/4/jeffrey-epstein-list-whose-names-are-on-the-newly-unsealed-documents
- NPR, "Epstein John Doe files released, unsealed," 2024-01-05: https://www.npr.org/2024/01/05/1222823216/epstein-john-doe-files-released-unsealed
- Time, "Jeffrey Epstein's unsealed court documents": https://time.com/6552063/jeffrey-epsteins-unsealed-court-documents/
- The Hill, "Epstein files: innocent men exposed," opinion, 2026: https://thehill.com/opinion/robbys-radar/5740437-epstein-files-innocent-exposed/
- France24, "AI tools fabricate Epstein images in seconds, study says," 2026-02-06: https://www.france24.com/en/live-news/20260206-ai-tools-fabricate-epstein-images-in-seconds-study-says
- Euronews, "From [a mayoral candidate] to [a public figure]: AI-generated images spread after Epstein file release," 2026-02-06: https://www.euronews.com/my-europe/2026/02/06/from-mamdani-to-farage-ai-generated-images-spread-after-epstein-file-release
- Bellingcat, Grok "unblur" investigation, 2026-02-10 (referenced via secondary reporting); Futurism (referenced via secondary reporting)
