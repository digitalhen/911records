export const BATES_RE = /NYC-(?:W|VV)TC[ _]?(\d{6,9})/i;

/** Normalizes free text like "NYC-WTC_900058160" to the canonical dashed, 9-digit form. */
export function normalizeBates(raw: string): string | null {
  const m = BATES_RE.exec(raw.trim());
  if (!m) return null;
  return `NYC-WTC_${m[1]!.padStart(9, '0')}`;
}
