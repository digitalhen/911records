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

  RE_TITLECASE_PAIR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RE_TITLECASE_PAIR.exec(trimmed))) {
    const w1 = (match[1] ?? '').toLowerCase();
    const w2 = (match[2] ?? '').toLowerCase();
    if (ALLOWED_PLACE_WORDS.has(w1) && ALLOWED_PLACE_WORDS.has(w2)) continue;
    if (STREET_OR_ORG_WORDS.has(w1) || STREET_OR_ORG_WORDS.has(w2)) continue;
    return true;
  }
  return false;
}
