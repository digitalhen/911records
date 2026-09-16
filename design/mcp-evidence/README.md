# Evidence in context — design review

The job: understand what the records say about a question, judge the strength of that evidence, and open the original when needed.

Open http://127.0.0.1:3142 while the preview server is running, or serve this directory. Design only; no new production changes. The earlier generic-summary implementation remains unfinished and is not this design.

## Experience

- A concise native chat answer synthesizes the findings and uncertainty.
- At most one optional evidence panel per answer, with a few chosen source pages, not every research result.
- Each source pairs a question-specific interpretation with its original scan and exact-page link. Explain what it establishes and, when relevant, the key limit. Do not force a negative caveat for every kind of question.
- Citation and source buttons switch the existing panel. Scan enlargement is a local dialog; the primary action opens the full record on the site at the cited page.
- Exact wording is secondary disclosure. No OCR wall, search toolbar, directory sidebar, or document-wide summary in the default view.
- Mobile stacks meaning above scan. Answer-only and missing-scan states are included. The preview can collapse to its compact brand row.

## Evidence used

Real public document NYC-WTC_000150782: page 1 identifies building exteriors cleaned by NYC DEP; page 11 lists Pearl Street entries. Both scans are saved locally, unchanged. The example answer is limited to these selected pages, not an exhaustive asbestos search or a medical conclusion. Interpretations are written for the review, not dynamically generated. Highlight boxes are manually positioned for the prototype, not production validated word geometry.

## Implementation boundary

This is an interaction proposal, not a claim that the current MCP contract supports it. The current five tools cannot accept a question-specific explanation plus a curated multi-document evidence set. A follow-up implementation must resolve that data handoff explicitly. Keep existing endpoints; do not pretend generic database summaries know the question. Research tools should stay data-only. Rendering once is preferable to trying to merge independent host iframes. Native chat citation buttons controlling the panel depend on host support; within-panel source controls must work independently. If host citation routing is unavailable, native citations should link to the exact site page instead.

Reuse site typography (Arial/Helvetica and monospace Bates identifiers), navy rules, blue links, restrained controls, gray hairlines and pale olive highlights. Desktop and mobile preview controls live outside the proposed product.
