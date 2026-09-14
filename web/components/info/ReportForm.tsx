'use client';
import { useState } from 'react';
import styles from './info.module.css';
export function ReportForm({ bates = '' }: { bates?: string }) {
  const [message,setMessage] = useState(''); const [busy,setBusy] = useState(false);
  return <form action="/api/report" method="post" className={styles.form} onSubmit={async e => {
    e.preventDefault(); setBusy(true); setMessage('');
    const form = e.currentTarget;
    try { const response = await fetch('/api/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))}); const result = await response.json(); if (!response.ok) setMessage(result.error || 'Report could not be saved. Please try again.'); else { setMessage(`Report received. Reference: ${result.id}. Keep this reference; no email address is collected.`); form.reset(); } } catch { setMessage('Report could not be saved. Please try again, or report it through the City’s official portal.'); } finally {setBusy(false);}
  }}><label>Bates page<input name="bates" defaultValue={bates} placeholder="NYC-WTC_000058160" pattern="NYC-WTC_[0-9]{9}" maxLength={17} required /></label><label>Location on the page<input name="location" placeholder="For example: lower-right corner, signature line" maxLength={500} required /></label><label>Note<textarea name="note" placeholder="Describe the kind of information and your concern. Do not repeat private details." maxLength={4000} required /></label><button className="button primary" disabled={busy} type="submit">{busy ? 'Sending…' : 'Send report'}</button><p role="status" aria-live="polite">{message}</p></form>;
}
