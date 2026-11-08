// Query-time embedding. It MUST match the model the pipeline indexed the
// page vectors with (scripts/embed/pages.py, scripts/search/opensearch.py:
// EMBED_MODEL, default nomic-embed-text, 768-d, "search_query: " prefix for
// queries vs. "search_document: " for passages). Changing the model means
// re-embedding and re-indexing every page — see docs/MODELS.md.
//
//   EMBED_PROVIDER      ollama (default) | openai  (any OpenAI-compatible /v1/embeddings)
//   EMBED_URL           ollama: base URL (falls back to OLLAMA_URL, then 127.0.0.1:11434);
//                       openai: base URL ending in /v1
//   EMBED_MODEL         default nomic-embed-text
//   EMBED_QUERY_PREFIX  default "search_query: " (nomic's convention; "" for most others)
//   EMBED_API_KEY       openai provider (falls back to OPENAI_API_KEY)
const env = (k: string) => process.env[k]?.trim() || '';
const PROVIDER = env('EMBED_PROVIDER').toLowerCase() === 'openai' ? 'openai' : 'ollama';
const BASE_URL = (env('EMBED_URL') || env('OLLAMA_URL') || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = env('EMBED_MODEL') || 'nomic-embed-text';
const QUERY_PREFIX = process.env.EMBED_QUERY_PREFIX ?? 'search_query: ';
const API_KEY = env('EMBED_API_KEY') || env('OPENAI_API_KEY');
const authHeaders: Record<string, string> = API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};

export interface EmbedResult {
  vector: number[] | null;
  reachable: boolean;
  error?: string;
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/**
 * Embeds a search query. Returns { vector: null, reachable: false } when
 * Ollama cannot be reached at all, so callers can fall back to keyword-only
 * search and say so, rather than fail the whole request.
 */
export async function embedQuery(q: string, timeoutMs = 4000): Promise<EmbedResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = PROVIDER === 'openai' ? `${BASE_URL}/embeddings` : `${BASE_URL}/api/embed`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ model: MODEL, input: [`${QUERY_PREFIX}${q}`] }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { vector: null, reachable: false, error: `embedding ${PROVIDER} http ${res.status}` };
    }
    const body = (await res.json()) as { embeddings?: number[][]; data?: { embedding: number[] }[] };
    const raw = PROVIDER === 'openai' ? body.data?.[0]?.embedding : body.embeddings?.[0];
    if (!raw) return { vector: null, reachable: false, error: `embedding ${PROVIDER} returned no embedding` };
    return { vector: normalize(raw), reachable: true };
  } catch (err) {
    return { vector: null, reachable: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function ollamaHealth(timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = PROVIDER === 'openai' ? `${BASE_URL}/models` : `${BASE_URL}/api/tags`;
    const res = await fetch(url, { headers: authHeaders, signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
