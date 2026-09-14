import { formatTotal } from '@/lib/searchUrl';
import Link from 'next/link';

/**
 * The design's persistent tab switcher between "Answer from records" and
 * "Document results" (design/astra/results.html & answer.html `.tabs`),
 * shared by /search and /a/[id] (issue #32, item 2). Plain links, not
 * client state — each tab's href is supplied by the caller so the active
 * page can point the *other* tab wherever makes sense (a fresh /ask call
 * for /search, or straight back to this same permalink for /a/[id]) without
 * this component knowing about either route's internals.
 */
export function SearchTabs({
  active,
  answerHref,
  documentsHref,
  documentCount,
}: {
  active: 'answer' | 'documents';
  answerHref: string;
  documentsHref: string;
  documentCount?: number;
}) {
  return (
    <nav className="tabs" aria-label="Search view">
      <Link href={answerHref} className={active === 'answer' ? 'active' : ''} aria-current={active === 'answer' ? 'page' : undefined}>
        Answer from records
      </Link>
      <Link href={documentsHref} className={active === 'documents' ? 'active' : ''} aria-current={active === 'documents' ? 'page' : undefined}>
        Document results{documentCount != null && <span className="count">{formatTotal(documentCount)}</span>}
      </Link>
    </nav>
  );
}
