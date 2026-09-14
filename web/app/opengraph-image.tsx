import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = '9/11 Records — 911records.nyc';

// docs/PLAN.md SEO section: an og-image. No `sharp` in package.json, so this
// is the documented fallback — an SVG-shaped image built with next/og's
// ImageResponse (Satori) rather than a build script, redrawn from
// design/logo/lockup.svg's mark (a plain house-front glyph) rather than
// importing the file, since Satori only supports a small subset of SVG.
// Next wires this into every page's <meta property="og:image"> and
// <meta name="twitter:image"> automatically (root segment, inherited).
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#142c3d',
          color: '#ffffff',
        }}
      >
        <svg width="220" height="93" viewBox="-8 4 686 292" fill="none">
          <path
            d="M0 184 H26 V154 H54 V171 H72 V144 H83 V118 L90 109 V103.5 V109 L97 118 V144 H108 V162 H150 V123 L162 110.1 L174 123 V140 H192 V47.2 H203 V11.2 V47.2 H214 V118 H232 V47.8 H254 V128 A13 8.5 0 0 1 280 128 V160 H306 V147 H324 V165 H352 V102.7 H382 V153 H406 V110 L410 105 L417 96 V91.3 V96 L424 105 L428 110 V137 H444 V106 L447 102 V96 L451 88.8 L455 96 V102 L458 106 V159 H496 V172 H536 V151 H566 V169 H612 V120 H644 V184 H670"
            fill="none"
            stroke="#ffffff"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={7}
          />
        </svg>
        <div style={{ display: 'flex', fontSize: 60, fontWeight: 700, marginTop: 28, letterSpacing: -1 }}>9/11 City Records</div>
        <div style={{ display: 'flex', fontSize: 26, opacity: 0.75, marginTop: 12, letterSpacing: 2 }}>911records.nyc</div>
        <div style={{ display: 'flex', fontSize: 20, opacity: 0.6, marginTop: 20 }}>Independent records explorer</div>
      </div>
    ),
    { ...size },
  );
}
