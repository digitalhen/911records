// Run before packaging: node scripts/geo.mjs /path/to/sept11-docs/data /path/to/prospect
// No network; all outputs are bundled in public/geo for both HA replicas.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = process.argv[2] || resolve(root, '../../sept11-docs/data');
const prospect = process.argv[3] || resolve(root, '../../../prospect');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const footprints = await read(resolve(data, 'geo/lm_buildings.geojson'));
const resolved = await read(resolve(data, 'embed/buildings.geojson'));
const counts = new Map(resolved.features.map(f => [f.properties.place_id, f.properties]));
const round = c => Array.isArray(c) ? c.map(round) : Number(c.toFixed(6));
const joins = {};
const features = footprints.features.map(f => {
  const p = f.properties, bin = String(p.bin);
  const ids = [...new Set([`bin:${bin}`, ...[p.base_bbl, p.mappluto_bbl].filter(Boolean).map(b => `bbl:${b}`)])];
  joins[bin] = [...new Set([...(joins[bin] || []), ...ids])];
  const matched = ids.map(id => counts.get(id)).filter(Boolean);
  return { type: 'Feature', geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) }, properties: {
    bin, height_roof: Math.max(0, Number(p.height_roof) || 0),
    n_docs: matched.reduce((n, r) => n + r.docs, 0), n_pages: matched.reduce((n, r) => n + r.pages, 0),
    n_test_pages: matched.reduce((n, r) => n + r.test_pages, 0),
  }};
});
// The prototype's reference polygon is approximate, not reconstructed 2001 geometry.
const reference = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: {
  type: 'Polygon', coordinates: [[[-74.0137,40.713],[-74.0098,40.7116],[-74.0113,40.709],[-74.0155,40.7104],[-74.0137,40.713]]],
}}] };
const roads = await read(resolve(prospect, 'public/geo/streets-m.json'));
const inside = ([x,y]) => x >= -74.025 && x <= -73.985 && y >= 40.698 && y <= 40.727;
const lines = [];
for (const f of roads.features) for (const line of f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates]) {
  let run = [];
  for (const p of line) { if (inside(p)) run.push(p); else { if (run.length > 1) lines.push(round(run)); run = []; } }
  if (run.length > 1) lines.push(round(run));
}
const output = {
  'buildings.geojson': { type: 'FeatureCollection', features },
  'joins.json': joins,
  'reference.geojson': reference,
  'streets.geojson': { type: 'FeatureCollection', features: [{type:'Feature', properties:{}, geometry:{type:'MultiLineString', coordinates:lines}}] },
};
await mkdir(resolve(root, 'public/geo'), { recursive: true });
let total = 0;
for (const [name, object] of Object.entries(output)) {
  const body = JSON.stringify(object); total += Buffer.byteLength(body);
  if (total > 3_000_000) throw new Error('Map assets exceed the 3 MB budget');
  await writeFile(resolve(root, 'public/geo', name), body + '\n');
  console.log(`${name}: ${Buffer.byteLength(body)} bytes`);
}
console.log(`${features.length} footprints; ${total} bytes total. Roof heights retained in source feet; map converts to metres.`);
