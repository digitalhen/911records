#!/usr/bin/env node
// download.mjs — mirror every PDF in data/manifest.jsonl to data/pdf/.
//
// Node 20+, no dependencies. One connection at a time, >= 1 s between download
// starts, bodies streamed straight to disk (the largest PDF is ~377 MB).
//
// Layout:  data/pdf/<agency>/<production_volume>/<bates_start>.pdf
//          data/pdf/<agency>/<production_volume>/<bates_start>.pdf.json   sidecar: etag, last-modified, bytes, sha256, fetched_at
//
// Resumable. A document is skipped when its PDF exists and its size equals the
// manifest's pdf_size, or (with --revalidate) when the server answers 304 to the
// sidecar's ETag. A size mismatch with a stored ETag is revalidated with
// If-None-Match; a changed document keeps the old copy as
// <bates_start>.superseded-<ts>.pdf (re-redactions must never silently vanish).
// Partial downloads live in *.part and are discarded on restart.
//
// Logs:     data/download.log              one line per document
//           data/download.errors.jsonl     failures (retried on the next run)
//           data/download.progress.json    done/total/bytes/errors/rate/ETA, rewritten after every document
//           data/download.pid              this process's pid (refuses to start if another live one holds it)
//
// Usage: node scripts/download.mjs [--limit N] [--order size|manifest] [--revalidate]
// Stops (exit 3) on 429, 401/403 or a non-PDF body — see scripts/lib/portal.mjs.

import { createWriteStream } from 'node:fs';
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DATA, PortalStop, REPO, makeClient } from './lib/portal.mjs';
import { listSnapshots, loadSnapshot } from './lib/catalog.mjs';
import { catalogChanged } from './lib/download-state.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const LIMIT = Number(opt('--limit', 0)) || Infinity;
const ORDER = opt('--order', 'size');
const REVALIDATE = args.includes('--revalidate');

const LOG = join(DATA, 'download.log');
const ERRORS = join(DATA, 'download.errors.jsonl');
const PROGRESS = join(DATA, 'download.progress.json');
const PIDFILE = join(DATA, 'download.pid');

const client = makeClient({ minGapMs: 1000, maxAttempts: 5, log: (m) => logLine(`retry ${m}`) });
const exists = async (p) => stat(p).then((s) => s, () => null);
const logLine = (m) => appendFile(LOG, `${new Date().toISOString()} ${m}\n`).catch(() => {});

async function claimPid() {
  const prev = await readFile(PIDFILE, 'utf8').catch(() => null);
  const pid = Number(prev);
  if (pid && pid !== process.pid) {
    try { process.kill(pid, 0); throw new Error(`another downloader (pid ${pid}) is running; refusing to start`); }
    catch (e) { if (e.code !== 'ESRCH') throw e; }
  }
  await writeFile(PIDFILE, `${process.pid}\n`);
}

// A manifest row that is absent from the latest ACCEPTED catalog snapshot (or already marked
// status "removed" by enumerate.mjs) has been removed from the portal. We keep our copy —
// never delete — record `removed_from_portal` in its sidecar and in
// data/removed_from_portal.jsonl (once per document), and never try to fetch it.
const REMOVED_LEDGER = join(DATA, 'removed_from_portal.jsonl');

async function flagRemovedFromPortal(all) {
  const latest = (await listSnapshots()).filter((s) => s.summary?.accepted).at(-1) ?? null;
  const inCatalog = latest ? new Set((await loadSnapshot(latest.path)).rows.map((r) => r.bates_start)) : null;
  const ledger = new Set((await readFile(REMOVED_LEDGER, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l).key));
  const gone = new Set();
  for (const r of all) {
    const absent = r.status === 'removed' || (inCatalog && !inCatalog.has(r.bates_start));
    const pdfPath = join(REPO, r.local_pdf);
    const sidecar = await readSidecar(pdfPath);
    if (!absent) {
      if (sidecar?.removed_from_portal && !sidecar.removed_from_portal.reappeared_at) {
        sidecar.removed_from_portal.reappeared_at = latest?.date ?? new Date().toISOString();
        await writeFile(`${pdfPath}.json`, JSON.stringify(sidecar, null, 2) + '\n');
        await logLine(`reappeared_on_portal ${r.key}`);
      }
      continue;
    }
    gone.add(r);
    const since = r.removed_at ?? latest?.date ?? null;
    const held = !!(await exists(pdfPath));
    if (held && sidecar && !sidecar.removed_from_portal) {
      sidecar.removed_from_portal = { since, catalog_snapshot: latest?.name ?? null, noted_at: new Date().toISOString() };
      await writeFile(`${pdfPath}.json`, JSON.stringify(sidecar, null, 2) + '\n');
    }
    if (!ledger.has(r.key)) {
      ledger.add(r.key);
      await appendFile(REMOVED_LEDGER, JSON.stringify({ key: r.key, bates_start: r.bates_start, bates_end: r.bates_end,
        production_volume: r.production_volume, agency: r.agency, page_count: r.page_count, since,
        catalog_snapshot: latest?.name ?? null, held_locally: held, noted_at: new Date().toISOString() }) + '\n');
      await logLine(`removed_from_portal ${r.key} held=${held} since=${since}`);
    }
  }
  return gone;
}

async function loadManifest() {
  const text = await readFile(join(DATA, 'manifest.jsonl'), 'utf8');
  const all = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const gone = await flagRemovedFromPortal(all);
  const rows = all.filter((r) => !gone.has(r));
  if (ORDER === 'size') rows.sort((a, b) => (a.pdf_size ?? 0) - (b.pdf_size ?? 0));
  return rows;
}

// Complete = on-disk size equals the manifest's pdf_size, OR a sidecar records a
// finished download of exactly this size. The second test matters: ~39 manifest
// rows (2026-09-13) carry an impossible pdf_size (tens of bytes for a real
// multi-KB PDF), and without it those would re-download on every run.
const isComplete = (row, st, sidecar) => st.size === row.pdf_size || (sidecar?.bytes != null && sidecar.bytes === st.size);
const readSidecar = async (pdfPath) => JSON.parse(await readFile(`${pdfPath}.json`, 'utf8').catch(() => 'null'));

/** Download one row. Returns {status, bytes, ms, etag}. */
async function fetchOne(row) {
  const pdfPath = join(REPO, row.local_pdf);
  const sidecarPath = `${pdfPath}.json`;
  const have = await exists(pdfPath);
  const sidecar = have ? JSON.parse(await readFile(sidecarPath, 'utf8').catch(() => 'null')) : null;

  if (have && isComplete(row, have, sidecar) && !REVALIDATE && !catalogChanged(row, sidecar)) return { status: 'skip-size', bytes: 0 };

  const headers = {};
  if (have && sidecar?.etag && sidecar.bytes === have.size) headers['If-None-Match'] = sidecar.etag;

  const res = await client.request(row.download_url, { headers }, { idleTimeoutMs: 120_000 });
  const started = Date.now(); // after pacing
  const headersMs = res.headersAt - res.startedAt;
  if (res.status === 304) {
    res.done();
    await writeFile(sidecarPath, JSON.stringify({ ...sidecar, catalog_changed_at: row.changed_at || null, manifest_pdf_size: row.pdf_size, url: row.download_url, checked_at: new Date().toISOString() }, null, 2) + '\n');
    return { status: have.size === row.pdf_size ? 'skip-etag' : 'skip-etag-size-differs', bytes: 0, ms: Date.now() - started, etag: sidecar.etag };
  }
  if (!res.ok) {
    res.done();
    await res.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${res.status}`);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('pdf')) {
    const snippet = (await res.text().catch(() => '')).slice(0, 300);
    res.done();
    throw new PortalStop(`non-PDF response (${ct}) for ${row.key} — challenge page?`, { snippet });
  }

  await mkdir(dirname(pdfPath), { recursive: true });
  const part = `${pdfPath}.part`;
  const hash = createHash('sha256');
  let bytes = 0, firstChecked = false;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      if (!firstChecked) {
        firstChecked = true;
        if (chunk.subarray(0, 5).toString('latin1') !== '%PDF-') return cb(new PortalStop(`body for ${row.key} does not start with %PDF-`));
      }
      res.touch();
      bytes += chunk.length;
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body), meter, createWriteStream(part));
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  } finally {
    res.done();
  }

  const declared = Number(res.headers.get('content-length'));
  if (declared && declared !== bytes) { await rm(part, { force: true }); throw new Error(`short body: ${bytes} of ${declared}`); }

  const etag = res.headers.get('etag');
  if (have) await rename(pdfPath, pdfPath.replace(/\.pdf$/, `.superseded-${Date.now()}.pdf`));
  await rename(part, pdfPath);
  await writeFile(sidecarPath, JSON.stringify({
    key: row.key, url: row.download_url, etag, last_modified: res.headers.get('last-modified'),
    content_length: declared || null, bytes, sha256: hash.digest('hex'), manifest_pdf_size: row.pdf_size,
    size_matches_manifest: bytes === row.pdf_size, fetched_at: new Date().toISOString(),
    replaced_previous: !!have, catalog_changed_at: row.changed_at || null,
  }, null, 2) + '\n');
  return { status: have ? 'replaced' : 'ok', bytes, ms: Date.now() - started + headersMs, headersMs, bodyMs: Date.now() - started,
    etag, sizeMismatch: bytes !== row.pdf_size };
}

async function main() {
  await mkdir(DATA, { recursive: true });
  await claimPid();
  const rows = (await loadManifest());
  const todo = rows.slice(0, LIMIT === Infinity ? rows.length : LIMIT);
  const total = rows.length;
  const bytesTotal = rows.reduce((s, r) => s + (r.pdf_size ?? 0), 0);

  // Account for what is already on disk up front so progress/ETA are honest after a restart.
  let done = 0, bytesDone = 0;
  const pending = [];
  for (const r of todo) {
    const p = join(REPO, r.local_pdf);
    await rm(`${p}.part`, { force: true });
    const s = await exists(p);
    const sc = s ? await readSidecar(p) : null;
    if (s && isComplete(r, s, sc) && !REVALIDATE && !catalogChanged(r, sc)) { done++; bytesDone += s.size; } else pending.push(r);
  }
  await logLine(`start pid=${process.pid} manifest=${total} already_done=${done} pending=${pending.length} order=${ORDER} revalidate=${REVALIDATE}`);

  const session = { started: Date.now(), files: 0, bytes: 0, transferMs: 0, overheadMs: 0, errors: 0, sizeMismatch: 0 };
  let status = 'running', lastError = null;
  let pendingBytes = pending.reduce((s, r) => s + (r.pdf_size ?? 0), 0);

  const writeProgress = async (current) => {
    const elapsed = (Date.now() - session.started) / 1000;
    const bps = session.transferMs > 0 ? session.bytes / (session.transferMs / 1000) : null;
    // Each remaining document costs max(1 s pacing slot, time-to-headers) plus its
    // bytes at the observed BODY throughput (headers and body timed separately, so
    // thousands of tiny files don't make request overhead look like slow bandwidth).
    const remainingFiles = pending.length - session.files - session.errors;
    let etaSeconds = null;
    if (bps && session.files >= 5) {
      etaSeconds = Math.round(pendingBytes / bps + remainingFiles * Math.max(1, session.overheadMs / session.files / 1000));
      etaSeconds = Math.max(etaSeconds, remainingFiles);
    }
    const doc = {
      status, pid: process.pid, updated_at: new Date().toISOString(),
      done, total, remaining: total - done, bytes_done: bytesDone, bytes_total: bytesTotal,
      percent_bytes: +(100 * bytesDone / bytesTotal).toFixed(2), errors: session.errors, size_mismatch_vs_manifest: session.sizeMismatch,
      session: { files: session.files, bytes: session.bytes, elapsed_seconds: Math.round(elapsed),
        files_per_minute: elapsed ? +(session.files / elapsed * 60).toFixed(1) : null,
        throughput_mb_per_s: bps ? +(bps / 1e6).toFixed(2) : null },
      eta_seconds: etaSeconds, eta_at: etaSeconds != null ? new Date(Date.now() + etaSeconds * 1000).toISOString() : null,
      current, last_error: lastError, requests: client.stats,
    };
    const tmp = `${PROGRESS}.tmp`;
    await writeFile(tmp, JSON.stringify(doc, null, 2) + '\n');
    await rename(tmp, PROGRESS);
  };

  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      if (stopping) process.exit(130);
      stopping = true; status = `interrupted (${sig})`;
      logLine(`received ${sig}; finishing current document then exiting`);
    });
  }

  for (const row of pending) {
    if (stopping) break;
    await writeProgress(row.key);
    try {
      const r = await fetchOne(row);
      pendingBytes -= row.pdf_size ?? 0;
      if (r.status.startsWith('skip')) { done++; bytesDone += row.pdf_size ?? 0; }
      else {
        done++; bytesDone += r.bytes;
        session.files++; session.bytes += r.bytes;
        session.transferMs += r.bodyMs;
        session.overheadMs += r.headersMs;
        if (r.sizeMismatch) session.sizeMismatch++;
      }
      await logLine(`${r.status} ${row.key} bytes=${r.bytes} ms=${r.ms ?? 0} etag=${r.etag ?? ''}${r.sizeMismatch ? ` manifest_size=${row.pdf_size}` : ''}`);
    } catch (err) {
      if (err instanceof PortalStop) {
        status = `stopped: ${err.message}`; lastError = { key: row.key, message: err.message, detail: err.detail };
        await logLine(`STOP ${row.key} ${err.message} ${JSON.stringify(err.detail)}`);
        await writeProgress(null);
        process.exit(3);
      }
      session.errors++; pendingBytes -= row.pdf_size ?? 0;
      lastError = { key: row.key, message: err.message, at: new Date().toISOString() };
      await logLine(`error ${row.key} ${err.message}`);
      await appendFile(ERRORS, JSON.stringify(lastError) + '\n');
    }
  }
  if (!stopping) status = session.errors ? `finished with ${session.errors} errors (re-run to retry)` : 'finished';
  await writeProgress(null);
  await logLine(`end ${status} done=${done}/${total} session_files=${session.files} session_bytes=${session.bytes}`);
  await rm(PIDFILE, { force: true });
  if (session.errors || stopping) process.exitCode = 1;
}

main().catch(async (err) => {
  await logLine(`fatal ${err.stack}`);
  console.error(err.stack);
  process.exit(1);
});
