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
    if (FLAGGED_WORDS.has(t.toLowerCase())) return false;
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
