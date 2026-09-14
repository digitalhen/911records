import type { NextConfig } from 'next';

const FILES_URL = process.env.FILES_URL || 'http://127.0.0.1:8911';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Server external packages: better-sqlite3 is a native addon and must not
  // be bundled by webpack/turbopack — same pattern prospect uses for `pg`.
  serverExternalPackages: ['better-sqlite3'],
  async rewrites() {
    return [
      {
        // PDFs and page images are served by the `files` service (nginx in
        // docker-compose.yml, scripts/files-dev-server.mjs in dev) straight
        // from the read-only data bind mount — never buffered through Next.
        source: '/files/:path*',
        destination: `${FILES_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
