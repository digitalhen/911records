#!/usr/bin/env node
// Dev-only stand-in for the `files` service (docker-compose.host.yml in
// production). Serves data/pdf, data/pages and data/text straight off disk
// with Range support and a URL scheme that carries agency/volume directly —
// see lib/files.ts — so there's no map to generate, just a path mirror.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', 'data');
const PORT = Number(process.env.FILES_PORT || 8911);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

const ROOTS = {
  downloads: path.join(DATA_DIR, 'downloads'),
  pdf: path.join(DATA_DIR, 'pdf'),
  page: path.join(DATA_DIR, 'pages'),
  text: path.join(DATA_DIR, 'text'),
};

function contentTypeFor(filePath) {
  if (filePath.endsWith('.pdf')) return 'application/pdf';
  if (filePath.endsWith('.webp')) return 'image/webp';
  if (filePath.endsWith('.jsonl')) return 'application/x-ndjson';
  return 'application/octet-stream';
}

function streamFile(req, res, filePath) {
  const contentType = contentTypeFor(filePath);
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
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

/** Resolves a URL under one of the known roots without escaping it via `..`. */
function resolveUnder(root, relPath) {
  const resolved = path.normalize(path.join(root, relPath));
  if (!resolved.startsWith(path.normalize(root) + path.sep) && resolved !== root) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/ollama/')) {
    const target = new URL(url.pathname.replace(/^\/ollama\//, '/'), OLLAMA_URL);
    target.search = url.search;
    const proxyReq = http.request(
      target,
      { method: req.method, headers: { ...req.headers, host: target.host } },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', () => res.writeHead(502).end('Ollama unreachable'));
    req.pipe(proxyReq);
    return;
  }

  for (const [prefix, root] of Object.entries(ROOTS)) {
    const marker = `/${prefix}/`;
    if (url.pathname.startsWith(marker)) {
      const rel = decodeURIComponent(url.pathname.slice(marker.length));
      const filePath = resolveUnder(root, rel);
      if (!filePath) {
        res.writeHead(400).end('Bad path');
        return;
      }
      streamFile(req, res, filePath);
      return;
    }
  }

  res.writeHead(404).end('Not found');
});

server.listen(PORT, () => console.log(`[files-dev-server] listening on http://127.0.0.1:${PORT} (DATA_DIR=${DATA_DIR})`));
