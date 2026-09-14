'use client';
import { useMemo, useState } from 'react';
import type { Candidate } from '@/lib/map/types';
import { pageUrl } from '@/lib/map/types';
import styles from './map.module.css';
export default function RecordTable({ rows, compact = false }: { rows: Candidate[]; compact?: boolean }) {
  const [sort, setSort] = useState('date');
  const sorted = useMemo(()=>[...rows].sort((a,b)=>(sort === 'date' ? (a.dates[0] || '9999').localeCompare(b.dates[0] || '9999') : (a.contaminants[0] || '').localeCompare(b.contaminants[0] || '')) || a.doc.localeCompare(b.doc) || a.page-b.page),[rows,sort]);
  return <div className={styles.records}>
    <label className={styles.sort}>Sort by <select value={sort} onChange={e=>setSort(e.target.value)}><option value="date">Date</option><option value="substance">Substance</option></select></label>
    <p className={styles.note}>Candidates extracted by machine can misread scans. Dates, substances, values and labs below occur on the same page; their relationship is not established — a value shown is a number found on the page, not a confirmed reading. Verify the page.</p>
    {!rows.length ? <p>No test candidates in this selection.</p> : <div className={styles.tableWrap}><table className={compact ? styles.compactTable : styles.table}>
      <thead><tr><th>Date / source</th><th>Page candidates</th></tr></thead>
      <tbody>{sorted.map(r=><tr key={`${r.doc}:${r.page}`}>
        <td>{r.dates.length ? r.dates.join(' · ') : 'Date not extracted'}<br/><a href={pageUrl(r)}>{r.doc} · p. {r.page} ↗</a></td>
        <td><strong>{r.contaminants.join(', ') || 'Substance not extracted'}</strong>
          <p>{r.measurements.length ? <><span className="muted">Values found on the page: </span>{r.measurements.join(' · ')}</> : 'Numeric value not extracted'}{!r.measurements.length && r.units.length ? ` · units: ${r.units.join(', ')}` : ''}</p>
          <p>Lab candidates: {r.labs.join(' · ') || 'not extracted'}</p>
          <p className={styles.note}>Stated limit / above or below: verify source page; not structured in this index.</p>
          <small>Machine-extracted · building match confidence {r.confidence === null ? 'not available' : r.confidence.toFixed(2)} (how sure the index is that this page concerns this building) · <a href={pageUrl(r)}>verify</a></small>
        </td>
      </tr>)}</tbody>
    </table></div>}
  </div>;
}
