/**
 * Version and release history for /releases — plain typed constants, no database, client-safe.
 * Rule (CLAUDE.md): every merge to main that changes what a visitor can see or do bumps APP_VERSION
 * and prepends a RELEASES entry. Notes are user-facing only — features, behaviour, visible fixes —
 * in plain language; never internal work.
 * The footer renders the version as the link to /releases; /api/health reports it.
 */
export const APP_VERSION = '0.14.1';

export type Release = { version: string; date: string; notes: string[] };

export const RELEASES: Release[] = [
  {
    version: '0.14.1',
    date: '2026-09-14',
    notes: [
      'Suggested questions on the map always return a cited answer instead of bouncing to a document search.',
      'Search filters for addresses, labs and agencies now match regardless of capitalisation, so a filtered search no longer comes back empty.',
    ],
  },
  {
    version: '0.14.0',
    date: '2026-09-14',
    notes: [
      'Every document in a folder now counts toward the folder\'s building: the map and building pages show whole folders, not just the pages that mention an address (the map went from about 550 to about 900 buildings).',
      'Every document has a plain-language title and summary, shown in search results, topic and reading lists, related records and comparisons.',
      'Cover-sheet pages list the records in their folder.',
      'A proper site icon for browser tabs, bookmarks and home screens.',
    ],
  },
  {
    version: '0.13.1',
    date: '2026-09-14',
    notes: [
      'Building, organisation and official pages show a compact monthly activity chart instead of a long list of dates.',
      'Cleaner answer pages (inline refresh control, natural-width follow-up links), "what others are reading" as tiles, no stray rules on the home panel, and a topic map that stays inside its box.',
      'Lab and contractor office addresses outside Manhattan (for example DEP\'s Queens office) no longer appear as buildings on the map.',
      'More buildings carry present-day details from prospect.nyc, now including landmark and historic-district status.',
      'Reading lists use document titles, never a bare name or a portal cover page.',
    ],
  },
  {
    version: '0.13.0',
    date: '2026-09-14',
    notes: ['Documents show a plain-language title and a short summary wherever they are listed — search, topics, browse, related records, buildings and the case folder — so you can tell what a record is without opening it. Rolling out across the collection.'],
  },
  {
    version: '0.12.1',
    date: '2026-09-14',
    notes: ['The map panel shows the collection title and document counts at the top again, directly above "Start with a question".'],
  },
  {
    version: '0.12.0',
    date: '2026-09-14',
    notes: ['You can refresh an answer page to get an updated version from the latest records; the original stays online and each version links to the other.'],
  },
  {
    version: '0.11.3',
    date: '2026-09-14',
    notes: ['Small buttons, map controls and the A–Z rail are easier to tap on phones.'],
  },
  {
    version: '0.11.2',
    date: '2026-09-14',
    notes: ['"What others are reading" now appears beside every answer on the Ask page.'],
  },
  {
    version: '0.11.1',
    date: '2026-09-14',
    notes: ['"Start with a question" now sits at the top of the home panel.'],
  },
  {
    version: '0.11.0',
    date: '2026-09-14',
    notes: ['Ask can now answer with a table: try "which buildings were tested for asbestos" or "which labs tested 114 Liberty Street" — sortable, exportable as CSV, and savable to your case folder.'],
  },
  {
    version: '0.11.0',
    date: '2026-09-14',
    notes: ['Ask can now answer with a table: try "which buildings were tested for asbestos" or "which labs tested 114 Liberty Street" — sortable, exportable as CSV, and savable to your case folder.'],
  },
  {
    version: '0.10.0',
    date: '2026-09-14',
    notes: ['"What others are reading": notable records picked out, plus what people are actually opening, on the home page and a new /reading page; documents show "Others also read".'],
  },
  {
    version: '0.9.4',
    date: '2026-09-14',
    notes: ['Topic pages no longer spill off the side of the screen on phones.'],
  },
  {
    version: '0.9.3',
    date: '2026-09-14',
    notes: [
      'The Ask button on the map matches the one on the Ask page.',
      'Suggested questions now each lead to a full cited answer (at least three supported sentences), and two weak ones were replaced.',
    ],
  },
  {
    version: '0.9.2',
    date: '2026-09-14',
    notes: ['The topic map is readable on phones again: each subject is a full-width row with its title, page count and a proportional bar.'],
  },
  {
    version: '0.9.1',
    date: '2026-09-14',
    notes: [
      'Search results now explain when a question could not be answered and was searched instead.',
      'Ask and Search share a quick Answer / Documents switch and show your saved-page count.',
      'Browse records is organised by collection and box, with agency and volume as filters; existing links keep working.',
      'Slightly garbled questions (scan-style typos) still reach the answer path.',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-09-14',
    notes: ['Topic map: a zoomable visual map of subjects across the collection, sized by how many pages are about each one — click a topic to zoom into its sub-topics, then into its documents. Each topic page shows which boxes and agencies it spans.'],
  },
  {
    version: '0.9.0',
    date: '2026-09-14',
    notes: ['Topic map: a zoomable visual map of subjects across the collection, sized by how many pages are about each one — click a topic to zoom into its sub-topics, then into its documents. Each topic page shows which boxes and agencies it spans.'],
  },
  {
    version: '0.8.1',
    date: '2026-09-14',
    notes: ['While an answer is being written, the Ask box now says the records are being read and roughly how long it takes, instead of appearing to do nothing.'],
  },
  {
    version: '0.8.0',
    date: '2026-09-14',
    notes: ['Ask now supports follow-up questions: refine an answer or ask something new about the same pages, and the whole conversation is saved as one shareable, permanent link with its citations.'],
  },
  {
    version: '0.7.4',
    date: '2026-09-14',
    notes: ['The home map, entity index, topic map, building pages and browse load noticeably faster.'],
  },
  {
    version: '0.7.3',
    date: '2026-09-14',
    notes: ['Typing a Bates number with a space (for example "NYC WTC 058160") now takes you straight to the record.'],
  },
  {
    version: '0.7.2',
    date: '2026-09-14',
    notes: ['Suggested questions on the home page and map now consistently return an answer instead of occasionally hitting a dead end; follow-up questions are only offered when the records can answer them.'],
  },
  {
    version: '0.7.2',
    date: '2026-09-14',
    notes: ['Suggested questions on the home page and map now consistently return an answer instead of occasionally hitting a dead end; follow-up questions are only offered when the records can answer them.'],
  },
  {
    version: '0.7.1',
    date: '2026-09-14',
    notes: [
      'Folder cover sheets (one-page separators with an address, block, lot and BIN) are labelled as such, with links to the folder, the next record in it and the building.',
      'Documents show a type where it can be read from the page — memo or letter, form, lab report, invoice, permit application, chain of custody, sign-in sheet — marked as machine-extracted.',
      'Cover sheets rank below content in search and are not used to write answers.',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-09-14',
    notes: [
      'Consistent look across the site: the same buttons, fields, panels and tables everywhere, and every page uses the same content width.',
      'The 3D/flat toggle sits with the map controls at the bottom left.',
      'A small star marks the buttons and links where an AI model will write or interpret the response (Ask, suggested questions, follow-ups) so it is always clear when you are reading a machine-written summary.',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-09-14',
    notes: [
      'Entity pages (labs, agencies, contractors, substances, addresses, officials) redesigned: key facts up top, documents grouped by the role the entity plays, where it appears, related organisations, buildings and substances, and a building file for addresses.',
      'Alternative spellings read from the scans are listed as "also read as" so nothing is hidden.',
      'Addresses that misread in the scans (for example "Latsyeiie" for Lafayette) are now grouped under the correct street.',
    ],
  },
  {
    version: '0.5.1',
    date: '2026-09-14',
    notes: ['Building pages, the map panel and document building links now show the street address (for example 77 Pearl Street) instead of a bare building number.'],
  },
  {
    version: '0.5.0',
    date: '2026-09-14',
    notes: [
      'One "Ask" control: a Bates number opens the document, keywords search, a question gets a cited answer; off-topic questions get a plain note.',
      'Topics are named in plain English (63 subjects under 8 groups), generated from the records and reviewed for names.',
      'OCR spellings of the same address, lab or contractor collapse into one entity; variants are kept as evidence.',
      'Building pages show present-day building details (year built, floors, units, class) provided by prospect.nyc.',
      'Entities index redesigned as panels per type with live filtering and A–Z listings.',
      'Search no longer returns look-alike results for words that appear nowhere in the records.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-09-14',
    notes: [
      'Case folder: save pages from the viewer or any citation, add notes, order exhibits, export an exhibit list.',
      'Related records, more-like-this-page and buildings on every document; copies and versions side by side.',
      'Removed documents answer 410 with a notice; sitemaps for documents, entities, buildings and topics; per-page social cards.',
      'Google Analytics with disclosure on the privacy page; www redirects to the apex.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-09-14',
    notes: ['Ask anything: cited answers from retrieved pages, every sentence linked to a Bates page; identity questions refused; permalinks.'],
  },
  {
    version: '0.2.0',
    date: '2026-09-14',
    notes: [
      'Home is a 3D map of lower Manhattan; buildings that appear in the records are lit; land, water and shoreline drawn from the borough outlines.',
      'Browse the physical order (collection → agency → volume → box → folder), releases and changes, entities and topics, personal-information policy.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-09-14',
    notes: ['First public version replacing the holding page: search with facets, document viewer with page images and OCR text, served from two hosts.'],
  },
];
