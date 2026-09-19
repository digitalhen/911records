import { z } from 'zod';

export const submissionSchema = z.object({
  kind: z.enum(['suggestion', 'correction']),
  sources: z.string().trim().min(1).max(2000),
  note: z.string().trim().min(10).max(6000),
});
export type Submission = z.infer<typeof submissionSchema>;

export function submissionHandler(save: (data: Submission) => Promise<string>) {
  const requests = new Map<string, { count: number; until: number }>();
  return async (req: Request) => {
    const reply = (body: object, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    const origin = req.headers.get('origin');
    if (origin && origin !== 'https://911records.org' && !(process.env.NODE_ENV !== 'production' && origin === new URL(req.url).origin)) return reply({ error: 'Submit from this site.' }, 403);
    if (!req.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'Expected JSON.' }, 415);
    const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const now = Date.now();
    for (const [key, item] of requests) if (item.until <= now) requests.delete(key);
    const bucket = requests.get(ip);
    if ((bucket?.count ?? 0) >= 5 || (!bucket && requests.size >= 5000)) return reply({ error: 'Too many submissions. Please try again in ten minutes.' }, 429);
    requests.set(ip, { count: (bucket?.count ?? 0) + 1, until: bucket?.until ?? now + 600000 });
    const reader = req.body?.getReader();
    if (!reader) return reply({ error: 'Enter your submission.' }, 400);
    let expired = false;
    const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 10000);
    let data: Submission;
    try {
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32000) { await reader.cancel(); return reply({ error: 'Submission is too long.' }, 413); }
        chunks.push(value);
      }
      if (expired) return reply({ error: 'Request timed out. Please try again.' }, 408);
      data = submissionSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch { return reply({ error: 'Choose a submission type, include source links or Bates pages, and enter a note of 10–6,000 characters.' }, 400); }
    finally { clearTimeout(timer); reader.releaseLock(); }
    try { return reply({ id: await save(data) }, 201); }
    catch { return reply({ error: 'Your submission could not be saved. Please try again later.' }, 503); }
  };
}
