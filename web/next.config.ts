import type { NextConfig } from 'next';

const FILES_URL = process.env.FILES_URL || 'http://127.0.0.1:8911';

const nextConfig: NextConfig = {
  output: 'standalone',
  // `pg` ships some optional native/CJS-only paths (pg-native, pg-cloudflare)
  // that webpack/turbopack shouldn't try to bundle — same reasoning as
  // prospect's serverExternalPackages: ['pg'].
  serverExternalPackages: ['pg'],
  async rewrites() {
    return [
      {
        // PDFs, page images and word-box files are served by the `files`
        // service — docker-compose.host.yml's nginx on StudioMac in
        // production, scripts/files-dev-server.mjs in dev. This app is
        // deployed HA with no bind mount to data/, so every one of these is
        // a proxied URL, never a local file read.
        source: '/files/:path*',
        destination: `${FILES_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
