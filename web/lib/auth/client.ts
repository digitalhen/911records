'use client';

// Browser-side Better Auth client -- same-origin, no basePath (this app has
// none). Never imports lib/db.ts or lib/auth/server.ts (COMMON-web.md: no
// server import from a 'use client' file).
import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});

export const { useSession, signOut } = authClient;
