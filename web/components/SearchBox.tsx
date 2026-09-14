/**
 * A plain GET form — no client JS required. Default submit (pressing Enter,
 * or the primary "Ask →" button) goes to /ask, which does the deterministic
 * router.ts dispatch itself (a Bates number opens the document, a short
 * keyword string redirects to /search, anything else asks the model) — so
 * pointing here unconditionally is safe. The "Search →" button overrides
 * with formAction to go straight to /search, skipping Ask entirely.
 */
export function SearchBox({ q, compact }: { q?: string; compact?: boolean }) {
  return (
    <form className={compact ? 'query' : 'home-search'} action="/ask" data-search>
      <label className="search-label" htmlFor="ask">
        Ask anything
      </label>
      <div className="searchbox">
        <input
          id="ask"
          name="q"
          defaultValue={q || ''}
          placeholder="Enter keywords, a Bates number, or a question"
          autoComplete="off"
        />
        <button className="button" type="submit" formAction="/search">
          Search →
        </button>
        <button className="button primary" type="submit">
          Ask →
        </button>
      </div>
      <div className="search-help">
        <span>Keywords and Bates numbers search the mirrored records directly.</span>
        <span>Ask a question for a cited answer, when the evidence supports one.</span>
      </div>
    </form>
  );
}
