import type { NextConfig } from 'next';


const nextConfig: NextConfig = {
  output: 'standalone',
  // `pg` ships some optional native/CJS-only paths (pg-native, pg-cloudflare)
  // that webpack/turbopack shouldn't try to bundle — same reasoning as
  // prospect's serverExternalPackages: ['pg'].
  serverExternalPackages: ['pg'],
  // /files/* is a runtime route handler (app/files/[...path]/route.ts), NOT a
  // rewrite: rewrites are fixed at build time and Dokploy builds with no
  // FILES_URL, which baked 127.0.0.1 into production (every image 500'd).
};

export default nextConfig;
