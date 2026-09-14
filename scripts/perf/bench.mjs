#!/usr/bin/env node
// Minimal perf probe for issue #13 — p50/p95 wall time over N requests per route, no deps
// (autocannon isn't installed and package.json is off-limits per docs/briefs/COMMON-web.md).
// Usage: node scripts/perf/bench.mjs [baseUrl] [n]
const base = process.argv[2] || 'http://127.0.0.1:3118';
const n = Number(process.argv[3] || 30);
const routes = [
  '/search?q=asbestos',
  '/doc/NYC-WTC_000094375',
  '/',
  '/entities',
  '/building/1000836',
  '/topics',
];

function pct(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function bench(path) {
  const times = [];
  let errors = 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    try {
      const res = await fetch(base + path, { headers: { 'x-perf-probe': '1' } });
      await res.arrayBuffer();
      if (!res.ok && res.status !== 404 && res.status !== 410) errors++;
    } catch {
      errors++;
    }
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return {
    path,
    n,
    errors,
    p50: pct(times, 50).toFixed(1),
    p95: pct(times, 95).toFixed(1),
    max: times[times.length - 1].toFixed(1),
  };
}

const results = [];
for (const r of routes) results.push(await bench(r));
console.log(`base=${base} n=${n}`);
console.table(results);
