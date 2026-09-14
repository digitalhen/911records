#!/usr/bin/env node
// Dev-only stand-in for the `files` nginx service in docker-compose.yml.
// Serves data/pdf and data/pages straight off disk with Range support, so
// `npm run dev` can render /doc/<bates> without the production compose
// stack. Mirrors files/generate-maps.sh's bates -> agency/volume lookup by
// reading data/manifest.jsonl once at startup (same source, same logic).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', 'data');
const PORT = Number(process.env.FILES_PORT || 8911);

const dirByBates = new Map();

async function loadManifest() {
  const manifestPath = path.join(DATA_DIR, 'manifest.jsonl');
  if (!fs.existsSync(manifestPath)) {
    console.warn(`[files-dev-server] no manifest at ${manifestPath}; PDF/page routes will 404 until it exists`);
    return;
  }
  const rl = readline.createInterface({ input: fs.createReadStream(manifestPath, { encoding: 'utf8' }) });
  let n = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const bates = row.bates_start;
      const localPdf = row.local_pdf; // "data/pdf/<dir>/<volume>/<bates>.pdf"
      if (!bates || !localPdf) continue;
      const rel = localPdf.replace(/^data\/pdf\//, '').replace(new RegExp(`/${bates}\\.pdf$`), '');
      dirByBates.set(bates, rel);
      n++;
    } catch {
      // skip malformed line
    }
  }
  console.log(`[files-dev-server] loaded ${n} bates -> path mappings from ${manifestPath}`);
}

function streamFile(req, res, filePath, contentType) {
  fs.stat(filePath, (err, stat) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : stat.size - 1;
      res.writeHead(206, {
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pdfMatch = /^\/pdf\/([^/]+)\.pdf$/.exec(url.pathname);
  const pageMatch = /^\/page\/([^/]+)\/(\d+)(\.t)?\.webp$/.exec(url.pathname);

  if (pdfMatch) {
    const bates = pdfMatch[1];
    const dir = dirByBates.get(bates);
    if (!dir) {
      res.writeHead(404).end('Unknown Bates number');
      return;
    }
    streamFile(req, res, path.join(DATA_DIR, 'pdf', dir, `${bates}.pdf`), 'application/pdf');
    return;
  }

  if (pageMatch) {
    const [, bates, n, thumb] = pageMatch;
    const dir = dirByBates.get(bates);
    if (!dir) {
      res.writeHead(404).end('Unknown Bates number');
      return;
    }
    const fileName = `${n}${thumb || ''}.webp`;
    streamFile(req, res, path.join(DATA_DIR, 'pages', dir, bates, fileName), 'image/webp');
    return;
  }

  res.writeHead(404).end('Not found');
});

loadManifest().then(() => {
  server.listen(PORT, () => console.log(`[files-dev-server] listening on http://127.0.0.1:${PORT} (DATA_DIR=${DATA_DIR})`));
});
