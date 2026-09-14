// `[- ]` after "NYC" (not just "-"): QA eval (web/lib/ask/refusals.test-cases.json,
// case b3) found "NYC WTC 058160" — a space where OCR/typing drops the dash — fell
// through to a keyword search instead of resolving as a Bates lookup. One extra
// separator option, no looser on the digit run, so this stays a narrow fix.
export const BATES_RE = /NYC[- ](?:W|VV)TC[ _]?(\d{6,9})/i;

/** Normalizes free text like "NYC-WTC_900058160" to the canonical dashed, 9-digit form. */
export function normalizeBates(raw: string): string | null {
  const m = BATES_RE.exec(raw.trim());
  if (!m) return null;
  return `NYC-WTC_${m[1]!.padStart(9, '0')}`;
}
