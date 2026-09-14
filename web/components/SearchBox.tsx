/** A plain GET form — no client JS required. /search redoes the whole query server-side from the URL. */
export function SearchBox({ q, compact }: { q?: string; compact?: boolean }) {
  return (
    <form className={compact ? 'query' : 'home-search'} action="/search" data-search>
      <label className="search-label" htmlFor="ask">
        Ask anything
      </label>
      <div className="searchbox">
        <input
          id="ask"
          name="q"
          defaultValue={q || ''}
          placeholder="Enter keywords or a Bates number (question answering is not live yet)"
          autoComplete="off"
        />
        <button className="button primary" type="submit">
          Search →
        </button>
      </div>
      <div className="search-help">
        <span>Keywords and Bates numbers search the mirrored records now.</span>
        <span>Question answering (Ask) ships in a later stage.</span>
      </div>
    </form>
  );
}
