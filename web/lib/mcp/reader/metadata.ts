import type { WordBox } from '../../boxes';

export const READER_URI = 'ui://911records/reader.html';
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
    domain: 'https://911records.nyc', prefersBorder: true,
    csp: { connectDomains: [], resourceDomains: ['https://911records.nyc'] },
  },
  'openai/widgetDomain': 'https://911records.nyc',
  'openai/widgetPrefersBorder': true,
  'openai/widgetDescription': 'One compact evidence panel with question-specific interpretations, cited scans, verified quotations and exact-page links. The panel supports the answer; do not repeat its contents in chat or open a separate panel for each source. Interpretations and OCR may be wrong; verify against the scan.',
  'openai/widgetCSP': { connect_domains: [], resource_domains: ['https://911records.nyc'], redirect_domains: ['https://911records.nyc'] },
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
