// The no-model half of Ask (docs/PLAN.md "Ask" paragraph): decides, with zero
// tokens spent, whether a typed query is a Bates number, a short keyword
// search, or something that needs the model's plan. Mirrors the routing the
// design's static mockup approximates client-side (design/astra/home.html's
// inline script) — this is the real, server-side version.
import { normalizeBates } from '../bates';

export type AskRoute =
  | { kind: 'bates'; bates: string }
  | { kind: 'keyword'; q: string }
  | { kind: 'model'; q: string };

// A bare run of digits with no letters — "058160" or "58160" — stands in for
// a Bates number "with or without the prefix" (team brief). 6-9 digits
// matches normalizeBates's own tolerance for a partial number.
const BARE_DIGITS_RE = /^\d{6,9}$/;

// Question/auxiliary/pronoun words (team brief, B11): a string carrying any
// of these is never a bare keyword search, no matter how short — it reads as
// a question or chit-chat and must go through the planner (which now has a
// kind: 'offtopic' for the chit-chat case — see lib/ask/plan.ts). This is
// deliberately broader than scripts/search/opensearch.py's "english" analyzer
// stopword list used by lib/opensearch.ts's own stripping (item 3 there) —
// the two lists serve different jobs: this one decides ask-routing, that one
// decides what survives into a search query.
const FLAGGED_WORDS = new Set([
  'do', 'does', 'did', 'is', 'are', 'was', 'were', 'can', 'could', 'should', 'would', 'will',
  'what', 'who', 'whom', 'why', 'how', 'when', 'where', 'which', 'like', 'you', 'your', 'i', 'me', 'my', 'we',
]);

/** Strips leading/trailing punctuation so "jesus?" / "DEP's" compare cleanly against FLAGGED_WORDS. */
function bareWord(token: string): string {
  return token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
}

// issue #32 item 5: a garbled OCR-style input ("wat caused the collapse",
// "wher testing occurred") carries no literal "?" and its question/aux word
// is itself misspelled, so it matched none of FLAGGED_WORDS and — as long as
// it stayed at or under MAX_KEYWORD_TOKENS — fell through to a plain keyword
// search instead of the planner. `isCloseMatch` accepts one edit (a single
// substitution, insertion, deletion, or adjacent transposition) so a token
// that's *almost* a flagged word still routes to the model. Deliberately not
// a general spellchecker: length capped to short flagged words only (typos
// of "you"/"your"/pronouns are still allowed through as plain search terms;
// this is about the words that decide "is this a question", not fidelity to
// every flagged word).
function isCloseMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let i = 0;
    while (i < la && a[i] === b[i]) i++;
    let j = la - 1;
    while (j >= 0 && a[j] === b[j]) j--;
    if (j < i) return true; // identical (shouldn't happen, a!==b already excluded)
    if (j - i === 0) return true; // single substitution
    return j - i === 1 && a[i] === b[j] && a[j] === b[i]; // adjacent transposition
  }
  const [shorter, longer] = la < lb ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
    } else if (!skipped) {
      skipped = true;
      j++;
    } else {
      return false;
    }
  }
  return true; // one insertion/deletion accounted for the length difference
}

/** True when `token` is a one-edit typo of some word in FLAGGED_WORDS. Only
 *  attempted for tokens of 3+ letters (matching FLAGGED_WORDS entries of 3+
 *  letters) — fuzzy-matching 1-2 letter tokens produces far more false
 *  positives than it catches. */
function isFlaggedTypo(token: string): boolean {
  if (token.length < 3) return false;
  for (const w of FLAGGED_WORDS) {
    if (w.length < 3) continue;
    if (isCloseMatch(token, w)) return true;
  }
  return false;
}

// Kept from the original router: a keyword search reads as a short typed
// phrase, not a sentence. Without this, a long flagged-word-free sentence
// like "Identify the private individual referenced in this letter." would
// short-circuit straight to /search and skip the model's refuse check
// entirely (confirmed by ask:eval — r06/r10 regressed without this).
const MAX_KEYWORD_TOKENS = 4;

/**
 * A string is a keyword search only if it's short, has no question/
 * auxiliary/pronoun word anywhere in it (not just as the first word — "tell
 * me a joke" and "do you like jesus" both fail this) and has at least one
 * content term left over. Anything else goes to the planner.
 */
function isKeywordQuery(q: string): boolean {
  if (q.includes('?')) return false;
  const tokens = q.split(/\s+/).filter(Boolean).map(bareWord).filter(Boolean);
  if (tokens.length === 0 || tokens.length > MAX_KEYWORD_TOKENS) return false;
  let hasContentTerm = false;
  for (const t of tokens) {
    const low = t.toLowerCase();
    if (FLAGGED_WORDS.has(low) || isFlaggedTypo(low)) return false;
    hasContentTerm = true;
  }
  return hasContentTerm;
}

/**
 * Routes a typed Ask query. Order matters: a Bates number always wins (even
 * a 6-9 digit number that also happens to look like a short keyword string),
 * then the keyword short-circuit, then everything else goes to the model's
 * plan (lib/ask/plan.ts).
 */
export function routeAsk(raw: string): AskRoute {
  const q = raw.trim();
  if (!q) return { kind: 'keyword', q: '' };

  const bates = normalizeBates(q);
  if (bates) return { kind: 'bates', bates };
  if (BARE_DIGITS_RE.test(q)) return { kind: 'bates', bates: `NYC-WTC_${q.padStart(9, '0')}` };

  if (isKeywordQuery(q)) return { kind: 'keyword', q };
  return { kind: 'model', q };
}
