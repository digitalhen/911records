import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth/server';
import { ensureRuntimeSchema } from '@/lib/runtimeSchema';

const handler = toNextJsHandler(auth.handler);

/** Auth tables are runtime state, never seeded -- make sure they exist
 *  before the first sign-in on a freshly restored database (same pattern as
 *  ~/Code/prospect/app/api/auth/[...all]/route.ts). Memoized, so this is a
 *  no-op after boot's own ensureRuntimeSchema() call (instrumentation.ts). */
async function withSchema(fn: (req: Request) => Promise<Response>, req: Request): Promise<Response> {
  await ensureRuntimeSchema();
  return fn(req);
}

export const GET = (req: Request) => withSchema(handler.GET, req);
export const POST = (req: Request) => withSchema(handler.POST, req);
