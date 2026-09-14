/**
 * MapLibre GL 6 derives its web-worker URL from `import.meta.url` at runtime.
 * Inside a webpack/Next bundle that resolves to /_next/static/chunks/... where
 * no worker file exists, so the module worker fails to load and the map never
 * fires `load`. We therefore serve the untouched worker bundle (and the shared
 * chunk it imports) from /public and point MapLibre at it with setWorkerUrl().
 *
 * Run automatically by `npm run dev` / `npm run build`.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = dirname(require.resolve('maplibre-gl/dist/maplibre-gl.mjs'));
const out = join(root, 'public', 'maplibre');

const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

await mkdir(out, { recursive: true });
for (const f of FILES) {
  await copyFile(join(dist, f), join(out, f));
}
console.log(`[maplibre] copied ${FILES.length} worker files to public/maplibre`);
