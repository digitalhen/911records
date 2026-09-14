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
// Land polygons: Prospect's borough file (nyc-boroughs.geojson) clipped to the
// map's maxBounds plus a margin. New Jersey/Jersey City is not in that file
// (it has only the 5 NYC boroughs), so the west bank of the Hudson is left as
// open water rather than invented — accurate for present-day NYC geometry,
// not a claim about 2001.
const MAP_BOUNDS = [-74.045, 40.685, -73.965, 40.74];
const MARGIN = 0.015;
const CLIP = [MAP_BOUNDS[0] - MARGIN, MAP_BOUNDS[1] - MARGIN, MAP_BOUNDS[2] + MARGIN, MAP_BOUNDS[3] + MARGIN];
// Sutherland-Hodgman: clip a ring against one axis-aligned half-plane.
const clipEdge = (ring, inside, intersect) => {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i], prev = ring[(i - 1 + ring.length) % ring.length];
    const curIn = inside(cur), prevIn = inside(prev);
    if (curIn) { if (!prevIn) out.push(intersect(prev, cur)); out.push(cur); }
    else if (prevIn) out.push(intersect(prev, cur));
  }
  return out;
};
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const clipRing = ring => {
  let r = ring;
  r = clipEdge(r, p => p[0] >= CLIP[0], (a, b) => lerp(a, b, (CLIP[0] - a[0]) / (b[0] - a[0])));
  r = clipEdge(r, p => p[0] <= CLIP[2], (a, b) => lerp(a, b, (CLIP[2] - a[0]) / (b[0] - a[0])));
  r = clipEdge(r, p => p[1] >= CLIP[1], (a, b) => lerp(a, b, (CLIP[1] - a[1]) / (b[1] - a[1])));
  r = clipEdge(r, p => p[1] <= CLIP[3], (a, b) => lerp(a, b, (CLIP[3] - a[1]) / (b[1] - a[1])));
  if (r.length < 3) return null;
  r.push(r[0]);
  return round(r);
};
const boroughs = await read(resolve(prospect, 'public/geo/nyc-boroughs.geojson'));
const landFeatures = [];
for (const f of boroughs.features) {
  const polys = [];
  for (const poly of f.geometry.coordinates) {
    const exterior = clipRing(poly[0]);
    if (!exterior) continue; // whole polygon falls outside the clip window
    const holes = poly.slice(1).map(clipRing).filter(Boolean);
    polys.push([exterior, ...holes]);
  }
  if (polys.length) landFeatures.push({ type: 'Feature', properties: { boroname: f.properties.boroname }, geometry: { type: 'MultiPolygon', coordinates: polys } });
}
const land = { type: 'FeatureCollection', features: landFeatures };

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
  'land.geojson': land,
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
