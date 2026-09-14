const RETRY_SECONDS = 15;

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="${RETRY_SECONDS}">
<title>911records.nyc is updating</title>
<meta name="robots" content="noindex">
<style>
 body{margin:0;background:#f0f2ef;color:#1f2d36;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
 main{max-width:560px;margin:14vh auto;padding:0 24px}
 h1{font-size:26px;letter-spacing:-.4px;margin:0 0 10px}
 p{margin:8px 0;color:#49595f} .eyebrow{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#6b7a80;margin-bottom:18px}
 .bar{height:3px;background:#dce0df;margin:26px 0 0;overflow:hidden}.bar i{display:block;height:100%;width:30%;background:#1f3d6b;animation:s 1.6s ease-in-out infinite}
 @keyframes s{0%{margin-left:-30%}100%{margin-left:100%}}
 small{display:block;margin-top:28px;font-size:12px;color:#6b7a80}
</style></head><body><main>
<div class="eyebrow">9/11 City Records · 911records.nyc</div>
<h1>A new version is going live.</h1>
<p>The site is restarting with an update. This usually takes under a minute. This page checks again every ${RETRY_SECONDS} seconds and will open the records as soon as they are back.</p>
<div class="bar"><i></i></div>
<small>An independent project by Cleartext Labs. Not affiliated with the City of New York.</small>
</main></body></html>`;

function maintenance() {
  return new Response(PAGE, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': String(RETRY_SECONDS),
    },
  });
}

// Traefik's "no router matched" answer during a deploy: 404, text/plain, body "404 page not found".
async function isTraefikGap(res) {
  if (res.status !== 404) return false;
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('text/plain')) return false;
  const body = await res.clone().text();
  return body.trim() === '404 page not found';
}

export default {
  async fetch(request) {
    let res;
    try {
      res = await fetch(request);
    } catch {
      return maintenance(); // tunnel / origin unreachable
    }
    if (res.status === 502 || res.status === 503 || res.status === 504 || (res.status >= 520 && res.status <= 530)) {
      // The app's own 503 (e.g. /api/map "index unavailable") is JSON and must pass through; only
      // HTML/plain gateway errors become the maintenance page.
      const type = res.headers.get('content-type') || '';
      if (!type.includes('json')) return maintenance();
    }
    if (await isTraefikGap(res)) return maintenance();
    return res;
  },
};
