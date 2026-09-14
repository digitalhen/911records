'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { PanelRow } from '@/lib/discovery/data';
import styles from './discovery.module.css';

// Entity row shape returned by /api/entities/suggest — a superset of PanelRow
// (adds a sample source page/confidence). Kept local so this client file
// never imports lib/discovery/data's runtime code (that module pulls in
// lib/db.ts, which must stay server-only).
interface SuggestRow extends PanelRow { doc: string; page: number; confidence: number | null; role?: string }

function linkFor(row: Pick<PanelRow, 'type' | 'slug' | 'bin'>): string {
  if (row.type === 'signatory') return `/signatory/${encodeURIComponent(row.slug)}`;
  if (row.type === 'address' && row.bin) return `/building/${encodeURIComponent(row.bin)}`;
  return `/entity/${encodeURIComponent(row.type)}/${encodeURIComponent(row.slug)}`;
}
function span(first: string | null, last: string | null): string {
  return first || last ? `${first || 'date unavailable'} – ${last || 'date unavailable'}` : 'Date unavailable';
}

export default function EntitySearch({ order, labels, panels, initialQuery }: {
  order: readonly string[];
  labels: Record<string, string>;
  panels: Record<string, { rows: PanelRow[]; total: number }>;
  initialQuery: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [live, setLive] = useState<{ q: string; rows: SuggestRow[]; error: boolean } | null>(null);
  const [panelFilter, setPanelFilter] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!q.trim()) { setLive(null); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/entities/suggest?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!response.ok) throw new Error('unavailable');
        const rows: SuggestRow[] = await response.json();
        setLive({ q, rows, error: false });
      } catch { if (!controller.signal.aborted) setLive({ q, rows: [], error: true }); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q]);
  const searching = q.trim().length > 0;
  const liveByType = useMemo(() => {
    const map: Record<string, SuggestRow[]> = {};
    for (const row of live?.rows ?? []) (map[row.type] ??= []).push(row);
    return map;
  }, [live]);
  return <div className="entity-search">
    <form action="/entities" className={styles.search}>
      <label htmlFor="entity-query" className="search-label">Find records — type an entity, role, address or substance</label>
      <input id="entity-query" name="q" value={q} maxLength={120} onChange={e => setQ(e.target.value)} autoComplete="off" aria-controls="entity-panels" />
      <button className="button primary">Find records →</button>
    </form>
    {searching && live?.error && <p className="small muted">Suggestions unavailable. Results below may be out of date.</p>}
    <div id="entity-panels" className={styles.panelGrid}>
      {order.map(type => {
        const base = panels[type] ?? { rows: [], total: 0 };
        const label = labels[type] ?? type;
        const rows = searching ? (live?.q === q ? (liveByType[type] ?? []) : base.rows) : base.rows;
        const filter = (panelFilter[type] ?? '').trim().toLowerCase();
        const shown = (filter ? rows.filter(r => r.label.toLowerCase().includes(filter)) : rows).slice(0, 20);
        return <section key={type} className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>{label}</h2>
            <span className="small muted">{searching ? `${rows.length} matching` : `${base.total} total`}</span>
          </div>
          <input className={styles.panelFilter} placeholder={`Filter ${label.toLowerCase()}…`} aria-label={`Filter ${label}`}
            value={panelFilter[type] ?? ''} onChange={e => setPanelFilter(p => ({ ...p, [type]: e.target.value }))} />
          {!shown.length && <p className="small muted">{searching ? 'No matches in this panel.' : 'No indexed entries yet.'}</p>}
          <ul className={styles.panelList}>
            {shown.map(r => <li key={r.id} className={styles.panelItem}>
              <Link href={linkFor(r)}>{r.label}</Link>
              <p className="small muted">{r.n_pages} pages · {r.n_docs} documents · {span(typeof r.first_date === 'string' ? r.first_date : null, typeof r.last_date === 'string' ? r.last_date : null)}</p>
              <small className="extraction">machine-extracted{r.type === 'address' && r.bin ? ' · linked to building file' : ''}</small>
            </li>)}
          </ul>
          {!searching && base.total > shown.length && <Link className={styles.seeAll} href={`/entities/${encodeURIComponent(type)}`}>See all {base.total} →</Link>}
        </section>;
      })}
    </div>
  </div>;
}
