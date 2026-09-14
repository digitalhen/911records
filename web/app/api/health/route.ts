import { NextResponse } from 'next/server';
import fs from 'node:fs';
import { SITE_DB_PATH, getMeta, siteDbExists, getDocumentCount } from '@/lib/siteDb';
import { healthCheck as opensearchHealth } from '@/lib/opensearch';
import { ollamaHealth } from '@/lib/embed';

export const dynamic = 'force-dynamic';

/**
 * Liveness + data-freshness check (docs/PLAN.md deliverable list, modeled on
 * ~/Code/prospect's /api/health shape). Always 200 while the process can
 * serve; callers should alert on the boolean fields inside the body, not the
 * HTTP status — a stale index or an unreachable Ollama is not a reason to
 * take the container out of rotation.
 */
export async function GET() {
  const commit = process.env.GIT_SHA?.trim() || null;

  let siteDb: { exists: boolean; mtime: string | null; documents: number | null; pages: number | null } = {
    exists: false,
    mtime: null,
    documents: null,
    pages: null,
  };
  const exists = siteDbExists();
  if (exists) {
    const stat = fs.statSync(SITE_DB_PATH);
    const meta = getMeta();
    siteDb = {
      exists: true,
      mtime: stat.mtime.toISOString(),
      documents: (meta?.documents as number | null) ?? getDocumentCount(),
      pages: (meta?.pages as number | null) ?? null,
    };
  }

  const [os, ollama] = await Promise.all([opensearchHealth(), ollamaHealth()]);

  const ok = true; // liveness only; see field-level booleans for readiness of dependencies
  return NextResponse.json({
    ok,
    commit,
    time: new Date().toISOString(),
    siteDb,
    opensearch: { reachable: os.reachable, docCount: os.docCount, error: os.error },
    ollama: { reachable: ollama },
  });
}
