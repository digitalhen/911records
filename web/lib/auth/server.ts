// Better Auth instance (issue #21 / docs/PLAN.md "Accounts"), magic-link
// only, no passwords, modeled on ~/Code/prospect/lib/auth.ts but WITHOUT its
// admin-provisioning gate: Prospect is an invite-only broker tool
// (`disableSignUp: true`, mint refused for an address it doesn't already
// hold), while 911records.nyc is a public self-serve site -- any visitor
// (a family member, a lawyer, a journalist) may sign in with their own
// address, so sign-up stays open (`disableSignUp` defaults to false).
//
// What DOES carry over from Prospect, because the risk is the same on any
// magic-link site: never mint for an address we hold no relationship to
// being spammed by a stranger's request. The magic-link plugin's own
// `rateLimit` (5 requests / 5 minutes, keyed by IP+endpoint) is the v1
// guard -- good enough to stop casual relay abuse without Prospect's
// per-address ledger, which exists there to protect an ADMIN's sending
// reputation on an invite-only product; a public product's threat model
// doesn't need that machinery for a v1.
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { headers } from 'next/headers';
import { authPool } from './pool';
import { sendMagicLinkMail } from './mail';

// Deliberately NOT defaulting to the production origin when
// NEXT_PUBLIC_SITE_URL is unset (unlike this app's other `|| 'https://
// 911records.nyc'` fallbacks): dev's port is whatever's free ("next dev,
// picks a free port if 3000 is busy", web/README.md), and Better Auth's own
// fallback -- infer the origin from the incoming request when `baseURL` is
// omitted -- gets that right for free, in a way a hardcoded prod default
// would not (it would mint magic links to the live site while testing
// locally). Production sets NEXT_PUBLIC_SITE_URL, so this pins the public
// domain there, matching every proxied cookie/CSRF check against the origin
// visitors actually see.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || undefined;

export const auth = betterAuth({
  database: authPool,
  baseURL: SITE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  user: {
    deleteUser: {
      // Immediate deletion, no confirmation email: the privacy page's
      // promise is "delete anytime", and the session cookie already proves
      // it's them (magic-link only, nothing to re-authenticate with).
      // app.case_folders and app.saved_searches both carry
      // `ON DELETE CASCADE` on user_id, so deleting the user row (which
      // Better Auth's internal adapter does directly) removes them too --
      // no afterDelete hook needed.
      enabled: true,
    },
  },
  plugins: [
    magicLink({
      // An hour: long enough that someone reading email on a second device
      // (a lawyer's phone, say) doesn't lose the link to the 5-minute
      // default before they click it.
      expiresIn: 60 * 60,
      rateLimit: { window: 60 * 5, max: 5 },
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkMail(email, url);
      },
    }),
    nextCookies(),
  ],
  session: {
    // A records tool people return to over weeks of a claim or a story --
    // keep sessions long, refresh quietly.
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
});

export type SessionUser = { id: string; email: string; name: string };

/** The signed-in user for server components and route handlers, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const u = session.user;
  return { id: u.id, email: u.email, name: u.name || '' };
}
