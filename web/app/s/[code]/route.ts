import { decodeDocumentCode, SITE_ORIGIN } from '@/lib/shortlinks/paths';
import { resolveStoredCode } from '@/lib/shortlinks/store';

export const dynamic = 'force-dynamic';
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  try {
    const target = decodeDocumentCode(code) ?? await resolveStoredCode(code);
    if (!target) return new Response('Shortlink not found.', { status: 404 });
    // Redirect through the ordinary viewer so removed-document checks still apply.
    return new Response(null, { status: 302, headers: { Location: SITE_ORIGIN + target, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  } catch { return new Response('Shortlink temporarily unavailable.', { status: 503 }); }
}
