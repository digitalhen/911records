import { AiMark, Button } from '@/components/ui';

/**
 * A plain GET form — no client JS required. One box, one button: submits to
 * /ask, which does the deterministic router.ts dispatch (a Bates number
 * opens the document, a keyword string redirects to /search with facets, a
 * question gets a cited answer, anything off-topic gets a plain note) — so
 * pointing here unconditionally is safe. Henry, B11: "combine search and ask
 * into one, like Prospect" — this used to have a second "Search →" button
 * with formAction="/search"; removed, the router decides now.
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
          placeholder="Ask a question, or type an address, substance or Bates number"
          autoComplete="off"
        />
        <Button variant="primary" type="submit">
          Ask <AiMark /> →
        </Button>
      </div>
      <div className="search-help">
        <span>A question gets a cited answer. Keywords, addresses and Bates numbers go straight to the records.</span>
      </div>
    </form>
  );
}
