// User-agent heuristics for the /api/v view-count beacon (B22, issue #36).
// Not a security boundary — a spoofed UA still gets counted — just enough to
// keep obvious crawlers and uptime/link-preview fetchers out of the "what
// others are reading" counts. Real browsers do not send navigator.sendBeacon
// requests with these substrings.
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegrambot|pingdom|uptimerobot|ahrefsbot|semrushbot|mj12bot|dotbot|petalbot|yandex|bingpreview|headlesschrome|phantomjs|python-requests|curl\/|wget|go-http-client|scrapy|monitor/i;

export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.trim().length === 0) return true;
  return BOT_UA.test(userAgent);
}
