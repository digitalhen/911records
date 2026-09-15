import { backend } from '@/lib/mcp/backend';
import { createHandler } from '@/lib/mcp/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handler = createHandler(backend);
export const POST = handler;
export const GET = handler;
export const DELETE = handler;
