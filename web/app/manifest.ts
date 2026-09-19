import type { MetadataRoute } from 'next';

// Next.js file-convention metadata (app/manifest.ts is auto-discovered and
// linked from every page's <head> — no import in app/layout.tsx needed,
// which keeps this change out of that file per docs/briefs/COMMON-web.md's
// do-not-edit list). Icons referenced here are the PNGs generated alongside
// app/favicon.ico and app/apple-icon.png (also auto-discovered) from
// design/logo/mark-compact.svg — see web/NOTES-B27.md.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '911records.org',
    short_name: '911records.org',
    description: "Search and read New York City's released 9/11 records.",
    start_url: '/',
    display: 'browser',
    background_color: '#ffffff',
    theme_color: '#214fbb',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
