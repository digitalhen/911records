import { ADSENSE_CLIENT } from '@/lib/brand';

// Authorized-sellers file for the AdSense publisher in lib/brand.ts; empty when ads are off.
export function GET() {
  const pub = ADSENSE_CLIENT.replace(/^ca-/, '');
  const body = pub ? `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n` : '';
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
}
