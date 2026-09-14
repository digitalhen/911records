// Query-time embedding via Ollama, matching the model the pipeline indexes
// with (scripts/search/opensearch.py: nomic-embed-text, 768-d, "search_query:"
// prefix for queries vs. the pipeline's own passage prefix). Local network
// call only — never touches the City's portal.
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = 'nomic-embed-text';

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
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, input: [`search_query: ${q}`] }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { vector: null, reachable: false, error: `ollama http ${res.status}` };
    }
    const body = (await res.json()) as { embeddings?: number[][] };
    const raw = body.embeddings?.[0];
    if (!raw) return { vector: null, reachable: false, error: 'ollama returned no embedding' };
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
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
