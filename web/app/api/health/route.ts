import { NextResponse } from 'next/server';
import { pingDb, pingReadPool, readPoolState } from '@/lib/db';
import { getMeta, siteSchemaReady } from '@/lib/site';
import { healthCheck as opensearchHealth } from '@/lib/opensearch';
import { ollamaHealth } from '@/lib/embed';

export const dynamic = 'force-dynamic';

/**
 * Liveness + data-freshness check, modeled on ~/Code/prospect's /api/health.
 * Always 200 while the process can serve; callers should alert on the
 * boolean/error fields inside the body, not the HTTP status — a stale index
 * or an unreachable Ollama is not a reason to take a replica out of rotation.
 *
 * `replica` (docs/PLAN.md HA note): this app runs on two Dokploy instances
 * behind one Cloudflare tunnel, so a probe of this endpoint is answered by
 * whichever replica the load balancer picked — REPLICA_NAME says which one.
 */
export async function GET() {
  const commit = process.env.GIT_SHA?.trim() || null;
  const replica = process.env.REPLICA_NAME?.trim() || null;

  const [dbUp, readUp, schemaReady, meta, os, ollama] = await Promise.all([
    pingDb(1_000),
    pingReadPool(1_000),
    siteSchemaReady().catch(() => false),
    getMeta().catch(() => null),
    opensearchHealth(),
    ollamaHealth(),
  ]);

  return NextResponse.json({
    ok: true,
    commit,
    replica,
    time: new Date().toISOString(),
    db: {
      primary: dbUp,
      read: readUp, // null = no DATABASE_READ_URL configured, boolean = reachable or not
      ...readPoolState(),
    },
    site: {
      schemaReady,
      builtAt: meta?.built_at ?? null,
      snapshotDate: meta?.snapshot_date ?? null,
      documents: meta?.documents ?? null,
      pages: meta?.pages ?? null,
    },
    opensearch: { reachable: os.reachable, docCount: os.docCount, error: os.error },
    ollama: { reachable: ollama },
  });
}
