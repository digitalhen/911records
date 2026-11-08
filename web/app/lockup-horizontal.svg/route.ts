import { SITE_NAME } from '@/lib/brand';

// The header logo: the mark, "9/11 Records", and this copy's name under it (lib/brand.ts).
// Generated rather than a static file so a self-hosted copy shows its own address.
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function GET() {
  const name = esc(SITE_NAME);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 56" role="img" aria-label="9/11 Records, ${name}">
  <title>9/11 Records, ${name}</title>
  <path transform="translate(2 4)" d="M3 42H11V12H15V3V12H19V31H25V13.5H33V26L37 21.5L41 26V42H45.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.75"/>
  <text x="62" y="30" fill="currentColor" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" letter-spacing="-0.2">9/11 Records</text>
  <text x="62" y="47" fill="currentColor" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="11.5" letter-spacing="1" opacity="0.72">${name}</text>
</svg>
`;
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
}
