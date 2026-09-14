// `npm run seed:reading` [-- --refresh] — populates/refreshes
// app.reading_seeds for "What others are reading" (B22, GitHub issue #36).
// Picks ~40 documents from data already in schema `site`/`app` — no model
// call, purely rule-based selection and a data-generated one-line "why" —
// grouped:
//
//   Start here             the documents most cited in app.answers (Ask's
//                          own answer permalinks)
//   Sampling and results   the highest doc_topics-probability lab_report
//                          document per named topic
//   What the City knew     the highest doc_topics-probability memo_letter
//                          document per named topic, plus memo_letters whose
//                          folder label or first page mentions re-occupancy,
//                          liability or air quality
//   Buildings              documents at the building (site.places) with the
//                          most recorded test pages, highest-confidence first
//
// Hard rules (COMMON-web.md privacy rules): never a folder cover sheet
// (documents.doc_type = 'cover_sheet'), and never a document whose folder
// label reads as a private individual's name rather than a place or
// organization (lib/reading/nameSafety.ts's TitleCase-pair heuristic, a port
// of scripts/embed/topics.py's own name-safety check). Each candidate doc is
// claimed by exactly one group, first-claimed-wins, so no document appears
// twice.
//
// Idempotent: recomputes the whole candidate set every run and replaces
// app.reading_seeds with it inside one transaction — safe to run repeatedly,
// and safe to run concurrently with the app (which only reads this table).
// `--refresh` (used by the nightly scripts/refresh_daily.sh stage) changes
// nothing about the logic, only the log banner, so a manual first run and
// the nightly cron run are exercising the exact same code path.
//
// Run with tsx (project convention, see scripts/ask-eval.ts's header) with
// DATABASE_URL/DATABASE_READ_URL in the environment — this script talks to
// Postgres directly via lib/db.ts, the same helper the app uses.
import { pool, readPool, query, queryRead, withTransaction } from '../lib/db';
import { ensureRuntimeSchema } from '../lib/runtimeSchema';
import { looksLikePersonalName } from '../lib/reading/nameSafety';

const REFRESH = process.argv.includes('--refresh');

const GROUP_TARGETS: Record<string, number> = {
  'Start here': 8,
  'Sampling and results': 10,
  'What the City knew': 12,
  Buildings: 10,
};
const GROUPS = Object.keys(GROUP_TARGETS);

interface DocRow {
  doc: string;
  folder: string | null;
  box: string | null;
  agency: string | null;
  volume: string | null;
  doc_type: string | null;
  status: string | null;
}

interface Seed {
  doc: string;
  title: string;
  why: string;
  group: string;
  rank: number;
}

/** Never a removed document, a cover sheet, or a folder that reads as a private individual's name. */
function isSeedable(row: Pick<DocRow, 'doc_type' | 'status' | 'folder'>): boolean {
  if (row.status === 'removed') return false;
  if (row.doc_type === 'cover_sheet') return false;
  if (looksLikePersonalName(row.folder)) return false;
  return true;
}

async function firstLine(doc: string): Promise<string | null> {
  const rows = await queryRead<{ text: string | null }>('SELECT text FROM site.page_text WHERE doc=$1 AND page=1', [doc]).catch(() => []);
  const text = rows[0]?.text;
  if (!text) return null;
  const line = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  if (!line) return null;
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
}

/** The folder label when present and not empty; otherwise the first non-blank line of page 1's OCR text; otherwise the Bates id. */
async function titleFor(row: Pick<DocRow, 'doc' | 'folder'>): Promise<string> {
  if (row.folder && row.folder.trim()) return row.folder.trim();
  return (await firstLine(row.doc)) || row.doc;
}

function count(seeds: Seed[], group: string): number {
  return seeds.reduce((n, s) => (s.group === group ? n + 1 : n), 0);
}

async function selectSeeds(): Promise<Seed[]> {
  const used = new Set<string>();
  const seeds: Seed[] = [];
  const claim = (doc: string) => {
    if (used.has(doc)) return false;
    used.add(doc);
    return true;
  };
  const room = (group: string) => count(seeds, group) < (GROUP_TARGETS[group] ?? 0);

  // 1. Start here — most-cited documents in app.answers. "Cited" means a
  // sentence in the written answer actually referenced that Bates page, not
  // merely that the page was retrieved that turn (the fuller `cites` array).
  interface AnswerRow {
    cites: { doc: string; batesPage: string }[] | null;
    answer: { sentences?: { cites?: string[] }[] } | null;
  }
  // app.answers lives in schema `app`, primary-only (the standby's read-only
  // role has no grant on it) — query the primary directly rather than pay
  // for a guaranteed-to-fail standby attempt on every run.
  const answers = await query<AnswerRow>('SELECT cites, answer FROM app.answers').catch(() => []);
  const citeCounts = new Map<string, number>();
  for (const row of answers) {
    const byBates = new Map((row.cites || []).map((c) => [c.batesPage, c.doc] as const));
    const citedBates = new Set((row.answer?.sentences || []).flatMap((s) => s.cites || []));
    const docsThisAnswer = new Set<string>();
    for (const bp of citedBates) {
      const doc = byBates.get(bp);
      if (doc) docsThisAnswer.add(doc);
    }
    for (const doc of docsThisAnswer) citeCounts.set(doc, (citeCounts.get(doc) || 0) + 1);
  }
  const citedDocIds = [...citeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([doc]) => doc);
  if (citedDocIds.length) {
    const rows = await queryRead<DocRow>(
      'SELECT doc, folder, box, agency, volume, doc_type, status FROM site.documents WHERE doc = ANY($1::text[])',
      [citedDocIds],
    );
    const byDoc = new Map(rows.map((r) => [r.doc, r]));
    let rank = 1;
    for (const doc of citedDocIds) {
      if (!room('Start here')) break;
      const row = byDoc.get(doc);
      if (!row || !isSeedable(row) || !claim(doc)) continue;
      const n = citeCounts.get(doc)!;
      seeds.push({ doc, title: await titleFor(row), why: `Cited in ${n} Ask answer${n === 1 ? '' : 's'}.`, group: 'Start here', rank: rank++ });
    }
  }

  // 2. Per named topic, the top lab_report (→ Sampling and results) or
  // memo_letter (→ What the City knew) document.
  const topics = await queryRead<{ id: number; title: string | null; label: string | null }>(
    "SELECT id, title, label FROM site.topics WHERE title IS NOT NULL ORDER BY size_docs DESC",
  ).catch(() => []);
  let labRank = 1;
  let memoRank = 1;
  for (const topic of topics) {
    if (!room('Sampling and results') && !room('What the City knew')) break;
    const candidates = await queryRead<DocRow>(
      `SELECT d.doc, d.folder, d.box, d.agency, d.volume, d.doc_type, d.status
       FROM site.doc_topics dt JOIN site.documents d USING(doc)
       WHERE dt.topic=$1 AND d.doc_type IN ('lab_report','memo_letter')
       ORDER BY dt.prob DESC NULLS LAST LIMIT 8`,
      [topic.id],
    ).catch(() => []);
    const title = topic.title || topic.label || `Topic ${topic.id}`;
    for (const row of candidates) {
      const group = row.doc_type === 'lab_report' ? 'Sampling and results' : 'What the City knew';
      if (!room(group) || !isSeedable(row) || !claim(row.doc)) continue;
      const rank = group === 'Sampling and results' ? labRank++ : memoRank++;
      const kind = row.doc_type === 'lab_report' ? 'lab report' : 'memo or letter';
      seeds.push({ doc: row.doc, title: await titleFor(row), why: `Top-scoring ${kind} in the "${title}" topic.`, group, rank });
      break; // one document per topic
    }
  }

  // 3. Key memos: memo_letter whose folder label or first page mentions
  // re-occupancy, liability or air quality — the City's own record of what
  // it told (or was told) at the time.
  const KEY_TERMS: [RegExp, string][] = [
    [/re-?occupanc/i, 're-occupancy'],
    [/liabilit/i, 'liability'],
    [/air quality/i, 'air quality'],
  ];
  if (room('What the City knew')) {
    const memoRows = await queryRead<DocRow & { text: string | null }>(
      `SELECT d.doc, d.folder, d.box, d.agency, d.volume, d.doc_type, d.status, pt.text
       FROM site.documents d LEFT JOIN site.page_text pt ON pt.doc=d.doc AND pt.page=1
       WHERE d.doc_type='memo_letter' AND d.status IS DISTINCT FROM 'removed'
         AND (d.folder ~* '(re-?occupanc|liabilit|air quality)' OR pt.text ~* '(re-?occupanc|liabilit|air quality)')
       LIMIT 60`,
    ).catch(() => []);
    for (const row of memoRows) {
      if (!room('What the City knew')) break;
      if (!isSeedable(row) || !claim(row.doc)) continue;
      const haystack = `${row.folder || ''} ${row.text || ''}`;
      const term = KEY_TERMS.find(([re]) => re.test(haystack))?.[1] || 'these subjects';
      seeds.push({ doc: row.doc, title: await titleFor(row), why: `Memo or letter mentioning ${term}.`, group: 'What the City knew', rank: memoRank++ });
    }
  }

  // 4. Buildings: the buildings with the most recorded test pages, their
  // own highest-confidence documents.
  const buildings = await queryRead<{ id: string; label: string; n_test_pages: number }>(
    `SELECT p.id, p.label, count(*) FILTER (WHERE pp.has_test)::int AS n_test_pages
     FROM site.places p JOIN site.place_pages pp ON pp.place_id=p.id JOIN site.documents d ON d.doc=pp.doc
     WHERE d.status IS DISTINCT FROM 'removed'
     GROUP BY p.id, p.label
     HAVING count(*) FILTER (WHERE pp.has_test) > 0
     ORDER BY n_test_pages DESC LIMIT 6`,
  ).catch(() => []);
  // Cap per building so the "Buildings" group actually spans several
  // buildings — without this, the single most-tested building's document
  // count alone can fill the whole group.
  const perBuildingCap = Math.max(2, Math.ceil((GROUP_TARGETS.Buildings ?? 0) / Math.max(1, buildings.length)));
  let buildingRank = 1;
  for (const building of buildings) {
    if (!room('Buildings')) break;
    const docs = await queryRead<DocRow & { confidence: number | null }>(
      `SELECT DISTINCT ON (d.doc) d.doc, d.folder, d.box, d.agency, d.volume, d.doc_type, d.status, pp.confidence
       FROM site.place_pages pp JOIN site.documents d ON d.doc=pp.doc
       WHERE pp.place_id=$1 AND pp.has_test AND d.status IS DISTINCT FROM 'removed'
       ORDER BY d.doc, pp.confidence DESC NULLS LAST`,
      [building.id],
    ).catch(() => []);
    docs.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    let claimedForBuilding = 0;
    for (const row of docs) {
      if (!room('Buildings') || claimedForBuilding >= perBuildingCap) break;
      if (!isSeedable(row) || !claim(row.doc)) continue;
      claimedForBuilding++;
      seeds.push({
        doc: row.doc,
        title: await titleFor(row),
        why: `Test record for ${building.label} · ${building.n_test_pages} test page${building.n_test_pages === 1 ? '' : 's'} recorded for this building.`,
        group: 'Buildings',
        rank: buildingRank++,
      });
    }
  }

  return seeds;
}

async function writeSeeds(seeds: Seed[]): Promise<void> {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM app.reading_seeds');
    for (const seed of seeds) {
      await client.query(
        `INSERT INTO app.reading_seeds (doc, title, why, "group", rank) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (doc) DO UPDATE SET title=EXCLUDED.title, why=EXCLUDED.why, "group"=EXCLUDED."group", rank=EXCLUDED.rank`,
        [seed.doc, seed.title, seed.why, seed.group, seed.rank],
      );
    }
  });
}

async function main(): Promise<void> {
  console.log(`[seed-reading] ${REFRESH ? 'nightly refresh' : 'seeding'} app.reading_seeds…`);
  await ensureRuntimeSchema();
  const seeds = await selectSeeds();
  const byGroup = Object.fromEntries(GROUPS.map((g) => [g, count(seeds, g)]));
  console.log(`[seed-reading] selected ${seeds.length} seeds:`, byGroup);
  await writeSeeds(seeds);
  console.log(`[seed-reading] wrote ${seeds.length} rows to app.reading_seeds.`);
}

main()
  .then(async () => {
    await pool.end();
    if (readPool) await readPool.end();
  })
  .catch(async (err) => {
    console.error('[seed-reading] failed:', err);
    await pool.end().catch(() => {});
    if (readPool) await readPool.end().catch(() => {});
    process.exitCode = 1;
  });
