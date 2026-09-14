import { AiMark, Button } from '@/components/ui';

/**
 * The free-text "Ask a follow-up" input under every answer (/a/[id]) and
 * under the insufficient-evidence view (B17, issue #23) — separate from the
 * model's own validated follow-up chips just above it. A plain GET form
 * like components/SearchBox.tsx, so it works with no client JS; `parentId`
 * (when present) threads the new turn onto this one via
 * /ask?parent=<id>&q=... — see app/ask/page.tsx's merge branch and
 * lib/ask/plan.ts's planFollowUp.
 */
export function FollowUpForm({ parentId }: { parentId?: string }) {
  return (
    <form className="query mt-5" action="/ask" data-search>
      <label className="search-label" htmlFor="followup-q">
        Ask a follow-up
      </label>
      <div className="searchbox">
        {parentId && <input type="hidden" name="parent" value={parentId} />}
        <input id="followup-q" name="q" placeholder="Ask a follow-up about these pages…" autoComplete="off" />
        <Button variant="primary" type="submit">
          Ask <AiMark /> →
        </Button>
      </div>
    </form>
  );
}
