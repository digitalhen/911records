/**
 * Next.js server-start hook (stable since Next 14, no config flag needed).
 * Ensures schema `app` exists before anything tries to write to it.
 * Fire-and-forget-safe: boot must survive a slow or absent database, so a
 * failure here only logs — routes that need it call ensureRuntimeSchema()
 * themselves too (it's memoized, so this is just a warm start).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureRuntimeSchema } = await import('./lib/runtimeSchema');
    await ensureRuntimeSchema().catch((err) => {
      console.error('[runtimeSchema] ensure failed at boot', err);
    });
  }
}
