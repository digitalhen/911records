'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Entity } from '@/lib/discovery/data';
import styles from './discovery.module.css';
export default function EntitySearch({ initialQuery }: {initialQuery: string}) {
  const [q,setQ] = useState(initialQuery);
  const [state,setState] = useState<{q: string; rows: Entity[]; error: boolean} | null>(null);
  useEffect(() => {
    if (!q.trim() || q === initialQuery) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/entities/suggest?q=${encodeURIComponent(q)}`, {signal:controller.signal});
        if (!response.ok) throw new Error('unavailable');
        const rows: Entity[] = await response.json();
        setState({q,rows,error:false});
      } catch { if (!controller.signal.aborted) setState({q,rows:[],error:true}); }
    },250);
    return () => {clearTimeout(timer);controller.abort();};
  },[q,initialQuery]);
  return <div className="entity-search"><form action="/entities" className={styles.search}><label htmlFor="entity-query" className="search-label">Type an entity or official role</label><input id="entity-query" name="q" value={q} maxLength={120} onChange={e=>setQ(e.target.value)} autoComplete="off" aria-controls="entity-suggestions"/><button className="button primary">Find records →</button></form>
    <div id="entity-suggestions" aria-live="polite">{state?.q === q && q !== initialQuery && q.trim() && <><p className="small muted">{state.error ? 'Suggestions unavailable. Try the search button again.' : `${state.rows.length} suggestions`}</p>{[...new Set(state.rows.map(r=>r.type))].map(type=><section key={type}><h3>{type==='signatory'?'Signatories by role':type}</h3><ul className={styles.cards}>{state.rows.filter(r=>r.type===type).map(r=><li key={`${r.type}:${r.id}`}><Link href={r.type==='signatory'?`/signatory/${encodeURIComponent(r.slug)}`:`/entity/${r.type}/${encodeURIComponent(r.slug)}`}>{r.label}</Link> · {r.type === 'signatory' ? r.role : r.type} · {r.n_pages} pages <small className="extraction">machine-extracted · confidence {r.confidence == null ? 'unavailable' : Number(r.confidence).toFixed(2)} · <Link href={`/doc/${encodeURIComponent(r.doc)}/p/${r.page}`}>Check page ↗</Link></small></li>)}</ul></section>)}</>}</div></div>;
}
