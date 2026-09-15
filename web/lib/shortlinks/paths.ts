export const SITE_ORIGIN = 'https://911records.nyc';
const roots = new Set(['', 'doc', 'page', 'search', 'browse', 'building', 'map', 'timeline', 'topics', 'entities', 'entity', 'signatory', 'a', 'ask', 'case', 'reading', 'contradictions', 'changes', 'releases', 'about', 'privacy', 'terms', 'personal-information', 'support', 'styleguide', 'gone']);

export function normalizeTarget(input: string): string {
  if (input.length > 4096 || /[\\\u0000-\u001f\u007f]/.test(input)) throw new Error('Invalid page URL.');
  const u = new URL(input, SITE_ORIGIN);
  if (u.origin !== SITE_ORIGIN || u.username || u.password) throw new Error('Only 911records.nyc pages can be shortened.');
  if (!roots.has(decodeURIComponent(u.pathname.split('/')[1] || ''))) throw new Error('Not a supported app page.');
  return u.pathname + u.search + u.hash;
}

// Document links are reversible, so MCP reads never need to create database records.
export function documentShortUrl(doc: string, page = 1): string {
  if (!/^NYC-WTC_\d{9}$/.test(doc) || !Number.isSafeInteger(page) || page < 1) throw new Error('Invalid document page.');
  const code = Number(doc.slice(8)).toString(36);
  return `${SITE_ORIGIN}/s/d${code}${page > 1 ? `-${page.toString(36)}` : ''}`;
}

export function decodeDocumentCode(code: string): string | null {
  const m = /^d([0-9a-z]{1,6})(?:-([0-9a-z]{1,6}))?$/.exec(code);
  if (!m) return null;
  const n = parseInt(m[1]!, 36);
  const page = m[2] ? parseInt(m[2], 36) : 1;
  if (n > 999999999 || page < 1) return null;
  return `/doc/NYC-WTC_${String(n).padStart(9, '0')}${page > 1 ? `/p/${page}` : ''}`;
}

export function shortDocumentTarget(target: string): string | null {
  const m = /^\/doc\/(NYC-WTC_\d{9})(?:\/p\/(\d+))?\/?$/.exec(target);
  return m ? documentShortUrl(m[1]!, m[2] ? Number(m[2]) : 1) : null;
}
