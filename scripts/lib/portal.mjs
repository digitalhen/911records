// portal.mjs — shared plumbing for the 9/11 Document Portal mirror scripts.
//
// Node 20+, no dependencies. Everything that touches the portal goes through
// here so the politeness rules live in exactly one place:
//   - one descriptive User-Agent,
//   - requests strictly sequential (callers await each one),
//   - a minimum gap between request STARTS (per client),
//   - retry with exponential backoff on 5xx / network errors,
//   - 429, 403 and anything that looks like a challenge page STOP the run
//     (PortalStop) rather than retry-storming.
//
// See docs/PORTAL-RECON.md for the API facts this encodes.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOST = 'https://sept11documents.cityofnewyork.us';
export const SEARCH_URL = `${HOST}/api/v2/search`;
export const contentUrl = (title) => `${HOST}/apps/content/September11_MD/${encodeURIComponent(title)}`;
export const UA = 'sept11-docs-mirror/0.1 (contact: digitalhen@gmail.com)';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA = join(REPO, 'data');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Raised for conditions where the right move is to stop and tell a human. */
export class PortalStop extends Error {
  constructor(message, detail = {}) { super(message); this.name = 'PortalStop'; this.detail = detail; }
}

/**
 * A paced, sequential client. `minGapMs` is the minimum time between the
 * starts of two consecutive requests made through this client.
 */
export function makeClient({ minGapMs, maxAttempts = 6, log = (m) => console.error(m) }) {
  let lastStart = 0;
  const stats = { requests: 0, retries: 0, http5xx: 0, network: 0 };

  async function pace() {
    const wait = lastStart + minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
  }

  /**
   * fetch() with pacing, retry and stop rules. `accept(res)` may throw
   * PortalStop for a response that is 2xx but wrong (e.g. an HTML challenge).
   * Returns the Response (body unread) for 2xx / 304.
   */
  async function request(url, init = {}, { idleTimeoutMs = 60_000 } = {}) {
    for (let attempt = 1; ; attempt++) {
      await pace();
      stats.requests++;
      const ac = new AbortController();
      let timer = setTimeout(() => ac.abort(new Error('idle timeout')), idleTimeoutMs);
      const touch = () => { clearTimeout(timer); timer = setTimeout(() => ac.abort(new Error('idle timeout')), idleTimeoutMs); };
      let res;
      try {
        res = await fetch(url, { ...init, signal: ac.signal, headers: { 'User-Agent': UA, ...(init.headers ?? {}) } });
      } catch (err) {
        clearTimeout(timer);
        stats.network++;
        if (attempt >= maxAttempts) throw new Error(`network error after ${attempt} attempts: ${err.message}`);
        const back = backoff(attempt);
        log(`network error (${err.cause?.code ?? err.message}); retry ${attempt}/${maxAttempts - 1} in ${back / 1000}s`);
        stats.retries++;
        await sleep(back);
        continue;
      }
      if (res.status === 429) {
        clearTimeout(timer);
        throw new PortalStop(`HTTP 429 from ${url} — rate limited; stopping as instructed`, { status: 429, retryAfter: res.headers.get('retry-after') });
      }
      if (res.status === 403 || res.status === 401) {
        clearTimeout(timer);
        const snippet = (await res.text().catch(() => '')).slice(0, 300);
        throw new PortalStop(`HTTP ${res.status} from ${url} — possible WAF/challenge; stopping`, { status: res.status, snippet });
      }
      if (res.status >= 500) {
        clearTimeout(timer);
        await res.body?.cancel().catch(() => {});
        stats.http5xx++;
        if (attempt >= maxAttempts) throw new Error(`HTTP ${res.status} after ${attempt} attempts for ${url}`);
        const back = backoff(attempt);
        log(`HTTP ${res.status}; retry ${attempt}/${maxAttempts - 1} in ${back / 1000}s`);
        stats.retries++;
        await sleep(back);
        continue;
      }
      // Hand the caller a response plus the idle-timer controls so a long
      // streaming body keeps the timer alive per chunk.
      res.startedAt = lastStart;
      res.headersAt = Date.now();
      res.touch = touch;
      res.done = () => clearTimeout(timer);
      return res;
    }
  }

  return { request, stats };
}

const backoff = (attempt) => Math.min(300_000, 5_000 * 3 ** (attempt - 1)); // 5s, 15s, 45s, 135s, 300s

/** POST /api/v2/search with JSON in and JSON out; a non-JSON reply is a stop. */
export async function search(client, body) {
  const res = await client.request(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  res.done();
  if (!res.ok) throw new Error(`search HTTP ${res.status}: ${text.slice(0, 200)}`);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('json') || /^\s*</.test(text)) {
    throw new PortalStop('search returned non-JSON (challenge page?) — stopping', { contentType: ct, snippet: text.slice(0, 300) });
  }
  return JSON.parse(text);
}

/** Flatten Mindbreeze properties[{id,data:[{value:{str|num}}]}] into a plain object. */
export function flatten(result) {
  const out = { id: result.id };
  for (const p of result.properties ?? []) {
    const vals = (p.data ?? []).map((d) => d.value?.str ?? d.value?.num ?? null);
    const key = p.id.replace(/^datasource\//, '');
    out[key] = vals.length === 0 ? null : vals.length === 1 ? vals[0] : vals;
  }
  return out;
}

// Short, stable directory names for the agencies seen at launch; anything new
// falls back to a slug of the full label, so a new agency never collides.
const AGENCY_DIRS = {
  'Environmental Protection, Dept. of': 'DEP',
  'Citywide Administrative Services, Dept. of': 'DCAS',
  'Fire Department': 'FDNY',
  'Records and Information Services, Dept. of': 'DORIS',
  'Design and Construction, Dept. of': 'DDC',
  'Buildings, Dept. of': 'DOB',
};
export function agencyDir(agency) {
  if (!agency) return '_unknown-agency';
  return AGENCY_DIRS[agency] ?? agency.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_');

/** Stable relative path (under data/pdf or data/text) for a manifest row, without extension. */
export function docStem(row) {
  return join(agencyDir(row.agency), safe(row.production_volume ?? '_unknown-volume'), safe(row.bates_start));
}
