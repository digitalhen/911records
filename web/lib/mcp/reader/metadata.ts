import { SITE_ORIGINS, SITE_SLUG, SITE_URL } from '../../brand';
import { readerHtml } from './generated';
import type { WordBox } from '../../boxes';

export const READER_URI = `ui://${SITE_SLUG}/reader.html`;
// The canonical origin plus former bare-domain hosts the reader may load scans from (www. aliases are
// redirects, not asset hosts). For 911records.org: [https://911records.org, https://911records.nyc].
const READER_DOMAINS = SITE_ORIGINS.filter((o, i) => i === 0 || !new URL(o).hostname.startsWith('www.'));

/** The reader HTML with this site's origins filled in (the bundle is built once, the site is configured per deploy). */
export function readerHtmlForSite(): string {
  return readerHtml.replace('__READER_SITE__', encodeURIComponent(JSON.stringify({ url: SITE_URL, origins: SITE_ORIGINS, slug: SITE_SLUG })));
}

export const READER_MIME = 'text/html;profile=mcp-app';
// Data calls remain available inside the reader without creating another iframe.
export const dataToolMeta = {
  ui: { visibility: ['model', 'app'] },
  'openai/widgetAccessible': true,
};
export const readerToolMeta = {
  ui: { resourceUri: READER_URI, visibility: ['model', 'app'] },
  'openai/outputTemplate': READER_URI,
  'openai/widgetAccessible': true,
};
export const readerResourceMeta = {
  ui: {
    domain: SITE_URL, prefersBorder: true,
    csp: { connectDomains: [], resourceDomains: READER_DOMAINS },
  },
  'openai/widgetDomain': SITE_URL,
  'openai/widgetPrefersBorder': true,
  'openai/widgetDescription': 'One compact evidence panel with question-specific interpretations, cited scans, verified quotations and exact-page links. The panel supports the answer; do not repeat its contents in chat or open a separate panel for each source. Interpretations and OCR may be wrong; verify against the scan.',
  'openai/widgetCSP': { connect_domains: [], resource_domains: READER_DOMAINS, redirect_domains: READER_DOMAINS },
};

/** Malformed/oversized geometry must never become a plausible highlight. */
export function readerBoxes(value: WordBox | null | undefined, page: number): WordBox | null {
  if (!value || value.page !== page || !Number.isFinite(value.w) || !Number.isFinite(value.h)
    || value.w <= 0 || value.h <= 0 || !Array.isArray(value.words) || value.words.length > 8000) return null;
  if (value.words.some(word => !Array.isArray(word) || word.length !== 5 || typeof word[4] !== 'string'
    || word[4].length > 300 || !word.slice(0, 4).every(Number.isFinite)
    || word[0] < 0 || word[1] < 0 || word[2] <= word[0] || word[3] <= word[1]
    || word[2] > value.w || word[3] > value.h)) return null;
  return value;
}
