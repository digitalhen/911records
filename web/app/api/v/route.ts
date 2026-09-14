// View-count beacon for "What others are reading" (B22, issue #36). The
// document page fires one navigator.sendBeacon('/api/v', doc) per load (see
// components/reading/ViewBeacon.tsx) — no cookies, no session id, no IP
// stored, sampled 1-in-1 (every load counts once). This increments
// app.doc_views for today only; bot/crawler user agents are ignored
// (lib/reading/isBot.ts). robots.txt already disallows /api/ entirely.
//
// Always answers 204 with no body, including on a rejected or failed write —
// a beacon has no reader on the other end, so there is nothing to report to.
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { ensureRuntimeSchema } from '@/lib/runtimeSchema';
import { normalizeBates } from '@/lib/bates';
import { isBot } from '@/lib/reading/isBot';

const NO_CONTENT = () => new NextResponse(null, { status: 204 });

export async function POST(req: NextRequest) {
  if (isBot(req.headers.get('user-agent'))) return NO_CONTENT();

  let raw = '';
  try {
    raw = await req.text();
  } catch {
    return NO_CONTENT();
  }
  // sendBeacon's payload arrives as plain text (the common case here) or, if
  // ever sent as a Blob with a JSON type, a JSON string — accept either.
  let candidate = raw.trim();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as { doc?: unknown }).doc === 'string') {
      candidate = (parsed as { doc: string }).doc;
    }
  } catch {
    // not JSON — use the raw text as-is
  }
  const doc = normalizeBates(candidate);
  if (!doc) return NO_CONTENT();

  try {
    await ensureRuntimeSchema();
    await query(
      `INSERT INTO app.doc_views (doc, day, views) VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (doc, day) DO UPDATE SET views = app.doc_views.views + 1`,
      [doc],
    );
  } catch (err) {
    console.warn('[api/v] view beacon write failed', err instanceof Error ? err.message : err);
  }
  return NO_CONTENT();
}
