// `npm run digest` (issue #21 / docs/PLAN.md "Accounts" -- saved-search
// digest). STUB: for every saved search, computes which documents newly
// added or re-appeared (site.changes) since the search was last checked
// also match the search's own terms and filters, and PRINTS what a digest
// email would contain. Sends nothing -- there is no lib/auth/mail.ts call
// here and this script never advances `last_checked_at`/`last_seen_count`,
// on purpose: those are the "already told them about this" checkpoint, and
// advancing it before anything is actually emailed would let real matches
// quietly fall out of the very first live digest once sending ships.
//
// Run with tsx (see scripts/ask-eval.ts's header for why: extensionless
// relative TS imports). Unlike `npm run dev`, tsx does NOT read web/.env.local
// on its own -- export it into the shell first:
//   set -a; source web/.env.local; set +a; npm run digest
// (same DATABASE_URL/DATABASE_READ_URL/OPENSEARCH_*/OLLAMA_URL the app
// itself uses). Intended to become a launchd/cron job alongside
// scripts/refresh_daily.sh once it actually sends mail.
import { queryReadSafe } from '../lib/db';
import { search } from '../lib/opensearch';
import { FILTER_KEYS } from '../lib/searchUrl';

interface SavedSearchRow {
  id: string;
  email: string;
  label: string;
  params: string;
  created_at: string;
  last_checked_at: string | null;
}

interface ChangedDocRow {
  doc: string;
}

function sinceDate(row: SavedSearchRow): string {
  const iso = row.last_checked_at || row.created_at;
  return new Date(iso).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const rows = await queryReadSafe<SavedSearchRow>(
    `SELECT ss.id, u.email, ss.label, ss.params, ss.created_at, ss.last_checked_at
     FROM app.saved_searches ss JOIN app."user" u ON u.id = ss.user_id
     ORDER BY ss.created_at ASC`,
  );

  if (!rows.length) {
    console.log('[digest] No saved searches exist yet -- nothing to check.');
    return;
  }

  console.log(`[digest] Checking ${rows.length} saved search(es). Nothing will be sent -- this is a stub.`);

  for (const row of rows) {
    const since = sinceDate(row);
    const changed = await queryReadSafe<ChangedDocRow>(
      `SELECT DISTINCT doc FROM site.changes WHERE date > $1 AND kind IN ('added', 'reappeared')`,
      [since],
    );
    const changedDocs = new Set(changed.map((r) => r.doc));

    if (!changedDocs.size) {
      console.log(`[digest] "${row.label}" (${row.email}): no documents added since ${since}.`);
      continue;
    }

    const usp = new URLSearchParams(row.params);
    const q = usp.get('q') || '';
    const filters: Record<string, string> = {};
    for (const key of FILTER_KEYS) {
      const v = usp.get(key);
      if (v) filters[key] = v;
    }

    let matchingDocs: string[] = [];
    try {
      // pageSize 200 / sort 'newest': this is a batch check over a bounded
      // window of new documents, not a paginated UI, so pull enough hits to
      // cover a typical release and prefer the newest to eyeball first.
      const result = await search({ q, filters, page: 1, pageSize: 200, sort: 'newest' });
      matchingDocs = [...new Set(result.hits.filter((h) => changedDocs.has(h.doc)).map((h) => h.doc))];
    } catch (err) {
      console.error(`[digest] "${row.label}" (${row.email}): search failed, skipping this run`, err);
      continue;
    }

    if (!matchingDocs.length) {
      console.log(`[digest] "${row.label}" (${row.email}): ${changedDocs.size} new document(s) released, none matched.`);
      continue;
    }

    console.log(
      `[digest] "${row.label}" (${row.email}): WOULD SEND -- ${matchingDocs.length} new matching document(s) since ${since}:`,
    );
    for (const doc of matchingDocs.slice(0, 10)) console.log(`    ${doc}`);
    if (matchingDocs.length > 10) console.log(`    ...and ${matchingDocs.length - 10} more`);
  }

  console.log('[digest] Done. No email was sent (stub) and no last_checked_at/last_seen_count was advanced.');
}

main().catch((err) => {
  console.error('[digest] failed', err);
  process.exitCode = 1;
});
