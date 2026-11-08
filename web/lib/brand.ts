// Who this copy of the site is: its address, name, operator, and third-party ids. Every value
// defaults to 911records.org's own, so the production build needs no new settings; a self-hosted
// copy sets the NEXT_PUBLIC_* build args (Dockerfile, deploy/docker-compose.yml,
// docs/SELF-HOSTING.md). They are NEXT_PUBLIC_ so the browser bundle, the middleware and the
// server all see the same values, inlined at build time; change one, rebuild.
//
// Convention for every switch here (same as NEXT_PUBLIC_GA_ID, lib/analytics.ts): unset or empty
// means "the default", the literal `off` means "none". An empty build arg therefore can never
// silently turn something off.
//
// Each process.env.NEXT_PUBLIC_* below must stay a literal property access, or Next.js won't
// inline it into client bundles.

const DEFAULT_SITE_URL = 'https://911records.org';

function setting(raw: string | undefined, fallback: string): string {
  const v = (raw ?? '').trim();
  if (!v) return fallback;
  return v.toLowerCase() === 'off' ? '' : v;
}

/** Canonical origin, no trailing slash: `https://911records.org`. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL).trim().replace(/\/+$/, '');
export const SITE_HOST = new URL(SITE_URL).host;
const IS_ORIGINAL = SITE_URL === DEFAULT_SITE_URL;

/** The name shown in titles, the logo, citations and legal pages: `911records.org`. */
export const SITE_NAME = setting(process.env.NEXT_PUBLIC_SITE_NAME, SITE_HOST) || SITE_HOST;

/** Short machine name (download filenames, MCP server name, reader resource URI): `911records`. */
export const SITE_SLUG =
  setting(process.env.NEXT_PUBLIC_SITE_SLUG, SITE_HOST.replace(/^www\./, '').split('.')[0] ?? '').replace(/[^a-z0-9-]/gi, '') ||
  'site';

/**
 * Other hostnames that redirect (301) to SITE_URL and are accepted as this site's own origin
 * (short links, MCP, form posts). Comma-separated. Default: the original site's former and www
 * hosts when SITE_URL is the original, otherwise `www.<host>`.
 */
export const SITE_ALIASES: string[] = setting(
  process.env.NEXT_PUBLIC_SITE_ALIASES,
  IS_ORIGINAL ? '911records.nyc,www.911records.nyc,www.911records.org' : `www.${SITE_HOST}`,
)
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter((h) => h && h !== SITE_HOST);

/** The canonical origin plus every alias, as https origins. */
export const SITE_ORIGINS: string[] = [SITE_URL, ...SITE_ALIASES.map((h) => `https://${h}`)];

/** A former address worth naming on the privacy page ("its former address 911records.nyc"). */
export const FORMER_HOST = setting(process.env.NEXT_PUBLIC_FORMER_HOST, IS_ORIGINAL ? '911records.nyc' : '');

/** Who runs this copy, as named on the About, Privacy and Terms pages. */
export const OPERATOR_NAME = setting(process.env.NEXT_PUBLIC_OPERATOR_NAME, 'Cleartext Labs') || SITE_NAME;

/** Contact address on the Privacy and Terms pages. */
export const CONTACT_EMAIL = setting(process.env.NEXT_PUBLIC_CONTACT_EMAIL, 'support@cleartextlabs.com');

/** Public issue tracker linked from the About page; `off` points readers at CONTACT_EMAIL instead. */
export const ISSUES_URL = setting(process.env.NEXT_PUBLIC_ISSUES_URL, 'https://github.com/digitalhen/911records/issues');

/** "Buy me a coffee"-style link in the header; `off` hides it. */
export const DONATE_URL = setting(process.env.NEXT_PUBLIC_DONATE_URL, 'https://buymeacoffee.com/digitalhen');

/** Google AdSense publisher id for ad units and /ads.txt; `off` (or NEXT_PUBLIC_ADS=off) removes ads. */
export const ADSENSE_CLIENT =
  (process.env.NEXT_PUBLIC_ADS ?? '').trim().toLowerCase() === 'off'
    ? ''
    : setting(process.env.NEXT_PUBLIC_ADSENSE_CLIENT, 'ca-pub-9961054735948902');

/** AdSense ad-unit slot id used by components/ads/AdUnit.tsx. */
export const ADSENSE_SLOT = setting(process.env.NEXT_PUBLIC_ADSENSE_SLOT, '4391479569');

/** True when `origin` (e.g. a request's Origin header) is this site. */
export function isSiteOrigin(origin: string | null | undefined): boolean {
  return Boolean(origin) && SITE_ORIGINS.includes(origin!.replace(/\/+$/, ''));
}

/** Absolute URL for a site path: absoluteUrl('/doc/X') -> https://911records.org/doc/X. */
export function absoluteUrl(path = '/'): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
