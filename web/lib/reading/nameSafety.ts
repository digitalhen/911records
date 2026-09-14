// A conservative port of scripts/embed/topics.py's TitleCase-pair name check
// (RE_TITLECASE_PAIR / ALLOWED_PLACE_WORDS / title_violates) used to keep the
// pipeline's topic titles name-safe. web/scripts/seed-reading.ts uses this to
// refuse to seed "What others are reading" with any document whose folder
// label reads as a private individual's name — COMMON-web.md's hard privacy
// rule ("no private individual's name is ever rendered by anything you
// build"). This is a heuristic, not a name detector: it flags an unexplained
// two-word TitleCase phrase (the shape "John Smith") that isn't a known NYC
// place name, a street-suffix phrase ("Chambers Street") or an
// organization-shaped phrase ("Bovis Contracting"), and also flags the
// ALL-CAPS "LAST, FIRST" convention seen on some claims-box folder labels
// (issue #30). False positives (rejecting a safe folder) are the acceptable
// failure mode here, never the reverse.

const ALLOWED_PLACE_WORDS = new Set([
  'liberty', 'broadway', 'battery', 'manhattan', 'world', 'trade', 'center', 'brooklyn',
  'hudson', 'east', 'river', 'ground', 'zero', 'staten', 'island', 'fresh', 'kills',
  'chambers', 'vesey', 'greenwich', 'church', 'fulton', 'wall', 'canal', 'bowery', 'trinity',
  'city', 'hall', 'park', 'national', 'september', 'wtc', 'lower', 'downtown', 'financial',
  'district', 'new', 'york', 'jersey', 'west', 'south', 'north', 'building', 'tower', 'plaza',
]);

const STREET_OR_ORG_WORDS = new Set([
  // Street suffixes.
  'street', 'st', 'avenue', 'ave', 'place', 'pl', 'lane', 'slip', 'road', 'rd',
  'boulevard', 'blvd', 'drive', 'way', 'terrace', 'square', 'sq', 'broadway',
  // Organization/company shapes.
  'inc', 'llc', 'corp', 'co', 'company', 'associates', 'contracting', 'environmental',
  'laboratory', 'laboratories', 'labs', 'services', 'group', 'consulting', 'engineering',
  'testing', 'abatement', 'construction', 'industries', 'industrial', 'remediation',
  'systems', 'partners', 'office', 'division', 'department', 'agency', 'authority',
  'bureau', 'institute', 'consultants', 'enterprises', 'management', 'restoration',
  'demolition', 'inspections', 'associates,',
]);

const RE_TITLECASE_PAIR = /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g;

// "SMITH, JOHN" or "SMITH JOHN Q" — the all-caps claims-box convention.
const RE_ALLCAPS_LAST_FIRST = /^[A-Z][A-Z.'-]{1,},?\s+[A-Z][A-Z.'-]{1,}(?:\s+[A-Z]\.?)?$/;

// A middle-initial-plus-surname shape — "M. Gilsenan" — which RE_TITLECASE_PAIR misses entirely
// (a bare initial+period has no lowercase letters to match [A-Z][a-z]+). Issue #37 follow-up,
// Henry's literal example: "E-mails 2003 M. Gilsenan" surfaced as a reading-list title. Flagged
// unconditionally (no allowlist exemption) — a real place/org name is never written as "M. <Word>".
const RE_INITIAL_SURNAME = /\b[A-Z]\.\s*[A-Z][a-z]+\b/;

// A bare single ALL-CAPS word — the shape of a surname alone on a claims-box folder label
// (issue #37 follow-up, Henry: "NADLER" surfaced as a reading-list title). Flagged unless it's a
// recognized place/street/org word (this file's own allowlists) or a generic folder/document word
// common in this corpus (GENERIC_SINGLE_WORDS below) or a well-known agency acronym. False
// positives (rejecting a safe one-word label) are fine, per this file's own rule above.
const RE_BARE_ALLCAPS_WORD = /^[A-Z][A-Z'.-]{1,19}$/;
const KNOWN_ACRONYMS = new Set([
  'epa', 'dep', 'osha', 'fema', 'niosh', 'atsdr', 'cdc', 'doh', 'dohmh', 'nysdec', 'nysdoh',
  'usace', 'ddc', 'dcas', 'fdny', 'nypd', 'dob', 'oem', 'doris', 'lmdc', 'hpd', 'dsny', 'wtc',
  'nyc', 'acp', 'acp7', 'plm', 'tem', 'qa', 'qc', 'llc',
]);
const GENERIC_SINGLE_WORDS = new Set([
  'asbestos', 'lead', 'mold', 'demolition', 'abatement', 'inspection', 'inspections', 'permit',
  'permits', 'correspondence', 'reports', 'report', 'samples', 'sample', 'testing', 'invoice',
  'invoices', 'memos', 'memo', 'photos', 'photo', 'miscellaneous', 'misc', 'various', 'unknown',
  'untitled', 'pending', 'confidential', 'general', 'notices', 'notice', 'contracts', 'contract',
  'complaints', 'complaint', 'violations', 'violation', 'applications', 'application', 'forms',
  'form', 'claims', 'claim', 'litigation', 'settlement', 'settlements', 'environmental', 'air',
  'water', 'dust', 'debris', 'monitoring', 'results', 'analysis', 'analyses', 'data', 'field',
  'notes', 'note', 'transcripts', 'transcript', 'exhibits', 'exhibit', 'schedule', 'schedules',
]);

// The City portal's watermark line (present on every scanned page — scripts/embed/doctypes.py's
// WATERMARK_RE), which a page-1-first-line fallback can pick up as a document's "title" when page
// 1 has nothing else machine-readable before it — not a name, but just as useless a title.
const RE_PORTAL_WATERMARK = /^\s*NYC\s*9[/\s]*1+1?\s*Public\s*Portal\s*Document\s*$/i;

export function isPortalWatermarkText(label: string | null | undefined): boolean {
  return !!label && RE_PORTAL_WATERMARK.test(label.trim());
}

/**
 * True when `label` looks like it names a private individual rather than a
 * place, organization, agency or generic folder description. Intended for
 * short folder-style labels, not full sentences or page text.
 */
export function looksLikePersonalName(label: string | null | undefined): boolean {
  if (!label) return false;
  const trimmed = label.trim();
  if (!trimmed) return false;
  if (RE_ALLCAPS_LAST_FIRST.test(trimmed)) return true;
  if (RE_INITIAL_SURNAME.test(trimmed)) return true;

  RE_TITLECASE_PAIR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RE_TITLECASE_PAIR.exec(trimmed))) {
    const w1 = (match[1] ?? '').toLowerCase();
    const w2 = (match[2] ?? '').toLowerCase();
    if (ALLOWED_PLACE_WORDS.has(w1) && ALLOWED_PLACE_WORDS.has(w2)) continue;
    if (STREET_OR_ORG_WORDS.has(w1) || STREET_OR_ORG_WORDS.has(w2)) continue;
    return true;
  }

  if (RE_BARE_ALLCAPS_WORD.test(trimmed)) {
    const w = trimmed.toLowerCase();
    if (!ALLOWED_PLACE_WORDS.has(w) && !STREET_OR_ORG_WORDS.has(w) && !KNOWN_ACRONYMS.has(w) && !GENERIC_SINGLE_WORDS.has(w)) {
      return true;
    }
  }
  return false;
}

/**
 * The combined check used wherever a machine-resolved TITLE (not just a raw folder label) is about
 * to be shown in the reading lists (issue #37 follow-up): a private individual's name (see
 * looksLikePersonalName above) OR the portal's own watermark line, which is not a name but is
 * exactly as useless — and exactly what a page-1-first-line fallback can surface.
 */
export function isUnsafeReadingTitle(title: string | null | undefined): boolean {
  return looksLikePersonalName(title) || isPortalWatermarkText(title);
}
