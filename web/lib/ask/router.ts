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

const QUESTION_WORD_RE =
  /^(who|what|when|where|why|how|was|were|is|are|did|does|do|can|could|should|will|would|which|whose)\b/i;

/**
 * Routes a typed Ask query. Order matters: a Bates number always wins (even
 * a 6-9 digit number that also happens to look like a short keyword string),
 * then the short-keyword short-circuit, then everything else goes to the
 * model's plan (lib/ask/plan.ts).
 */
export function routeAsk(raw: string): AskRoute {
  const q = raw.trim();
  if (!q) return { kind: 'keyword', q: '' };

  const bates = normalizeBates(q);
  if (bates) return { kind: 'bates', bates };
  if (BARE_DIGITS_RE.test(q)) return { kind: 'bates', bates: `NYC-WTC_${q.padStart(9, '0')}` };

  const tokens = q.split(/\s+/).filter(Boolean);
  const isShort = tokens.length <= 4;
  const hasQuestionMark = q.includes('?');
  const startsAsQuestion = QUESTION_WORD_RE.test(q);

  if (isShort && !hasQuestionMark && !startsAsQuestion) {
    return { kind: 'keyword', q };
  }
  return { kind: 'model', q };
}
