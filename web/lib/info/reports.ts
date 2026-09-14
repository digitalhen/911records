import 'server-only';
import { withTransaction } from '@/lib/db';
export async function saveReport(bates: string, location: string, note: string) {
  return withTransaction(async client => {
    // Serialize first-use DDL across both replicas, including an empty app schema.
    await client.query("SELECT pg_advisory_xact_lock(911, 2)");
    await client.query('CREATE SCHEMA IF NOT EXISTS app');
    await client.query(`CREATE TABLE IF NOT EXISTS app.reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      bates_page TEXT NOT NULL,
      location TEXT NOT NULL,
      note TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new'
    )`);
    const result = await client.query<{id:string}>('INSERT INTO app.reports (bates_page,location,note) VALUES ($1,$2,$3) RETURNING id',[bates,location,note]);
    return result.rows[0]!.id;
  });
}
