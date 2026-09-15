export async function requestShortlink(target: string): Promise<string> {
  const response = await fetch('/api/shortlinks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: target }), signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('Shortlink unavailable');
  const result = await response.json() as { short_url: string };
  return result.short_url;
}
