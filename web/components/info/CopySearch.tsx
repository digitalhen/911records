'use client';
import { useState } from 'react';
import styles from './info.module.css';
export function CopySearch() {
  const [q,setQ] = useState(''); const [url,setUrl] = useState(''); const [message,setMessage] = useState('');
  return <form className={styles.copy} onSubmit={async e => { e.preventDefault(); const link = `${window.location.origin}/search?q=${encodeURIComponent(q.trim())}`; setUrl(link); try { await navigator.clipboard.writeText(link); setMessage('Search link copied.'); } catch { setMessage('Select and copy the link below.'); } }}><label htmlFor="saved-query">Search to revisit</label><input id="saved-query" value={q} onChange={e => setQ(e.target.value)} required maxLength={500} placeholder="Liberty Street asbestos" /><button className="button" type="submit">Copy search link</button>{url && <input aria-label="Search link" readOnly value={url} onFocus={e => e.target.select()} />}<p role="status">{message}</p><p className="small muted">Copy this link to check again after a capture. No email alerts or automatic notifications.</p></form>;
}
