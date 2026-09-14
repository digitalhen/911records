'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useCaseFolder } from '@/lib/case/useCaseFolder';
import { exportCsv } from '@/lib/case/store';
import type { CaseItem } from '@/lib/case/types';
import type { CaseDocMeta } from '@/lib/case/lookup';
import { Button, ButtonLink, Callout, Dialog, Textarea, Toast, useToast } from '@/components/ui';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://911records.nyc';

function docHref(doc: string, page: number): string {
  return page > 1 ? `/doc/${encodeURIComponent(doc)}/p/${page}` : `/doc/${encodeURIComponent(doc)}`;
}

function batesRange(doc: string, batesEnd: string | null | undefined): string {
  if (!batesEnd || batesEnd === doc) return doc;
  return `${doc}–${batesEnd.replace(/^NYC-WTC_/, '')}`;
}

interface Suggestion {
  doc: string;
  page: number;
  score: number;
  reason: string;
  meta?: CaseDocMeta;
}

export function CaseFolderApp() {
  const { items, remove, updateNote, moveUp, moveDown } = useCaseFolder();
  const [meta, setMeta] = useState<Record<string, CaseDocMeta>>({});
  const [suggestions, setSuggestions] = useState<{ rows: Suggestion[]; unavailable: boolean; loaded: boolean }>({
    rows: [],
    unavailable: false,
    loaded: false,
  });
  const { message, show } = useToast();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [csv, setCsv] = useState('');

  const docIds = [...new Set(items.map((i) => i.doc))];
  const docKey = docIds.join(',');

  useEffect(() => {
    if (!docIds.length) {
      setMeta({});
      return;
    }
    let cancelled = false;
    fetch(`/api/case/lookup?docs=${encodeURIComponent(docKey)}`)
      .then((r) => r.json())
      .then((body: { docs?: Record<string, CaseDocMeta> }) => {
        if (!cancelled) setMeta(body.docs || {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  useEffect(() => {
    if (!items.length) {
      setSuggestions({ rows: [], unavailable: false, loaded: true });
      return;
    }
    let cancelled = false;
    fetch('/api/case/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map((i) => ({ doc: i.doc, page: i.page, label: i.label })) }),
    })
      .then((r) => r.json())
      .then((body: { suggestions?: Suggestion[]; unavailable?: boolean }) => {
        if (cancelled) return;
        const rows = body.suggestions || [];
        setSuggestions({ rows, unavailable: !!body.unavailable, loaded: true });
        const extraDocs = [...new Set(rows.map((r) => r.doc))].filter((d) => !meta[d]);
        if (extraDocs.length) {
          fetch(`/api/case/lookup?docs=${encodeURIComponent(extraDocs.join(','))}`)
            .then((r) => r.json())
            .then((b: { docs?: Record<string, CaseDocMeta> }) => {
              if (!cancelled) setMeta((prev) => ({ ...prev, ...(b.docs || {}) }));
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) setSuggestions({ rows: [], unavailable: true, loaded: true });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => `${i.doc}:${i.page}`).join(',')]);

  const totalPages = items.length; // one saved page per exhibit; ranges collapse when a doc's bates_end covers it.

  function openExport() {
    // The export itself is a pure function in lib/case/store.ts (exportCsv)
    // so it stays in one place alongside the rest of the case-folder
    // contract, not duplicated here.
    setCsv(exportCsv(items, meta, SITE_URL));
    dialogRef.current?.showModal();
  }

  async function copyCsv() {
    try {
      await navigator.clipboard.writeText(csv);
      show('Exhibit list copied.');
    } catch {
      show('Select the text below and copy it.');
    }
  }

  function downloadCsv() {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'case-folder-exhibits.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">Saved research / Stored in this browser</div>
          <h1>Case folder</h1>
          <p className="subtitle">Pages, working notes and the order you want to cite them. No account, no cloud sync.</p>
        </div>
        {items.length > 0 && (
          <Button variant="primary" type="button" onClick={openExport}>
            Export exhibit list ↓
          </Button>
        )}
      </div>

      {!items.length ? (
        <Callout title="Nothing saved yet">
          <p>
            Open any <Link href="/search">document</Link> or an <Link href="/ask">answer</Link> and use "Save to case"
            to start building an exhibit list.
          </p>
        </Callout>
      ) : (
        <div className="case-layout">
          <section>
            <div className="result-toolbar">
              <h2>Exhibit order</h2>
              <span className="small muted">
                {items.length} exhibit{items.length === 1 ? '' : 's'} · {totalPages} page{totalPages === 1 ? '' : 's'}
              </span>
            </div>
            <p className="case-summary">Use the arrows to reorder. Notes and order are saved in this browser only.</p>
            <div>
              {items.map((item: CaseItem, i: number) => {
                const m = meta[item.doc];
                const removed = m?.status === 'removed';
                return (
                  <article className="exhibit" key={`${item.doc}:${item.page}`}>
                    <div className="exhibit-no">{String(i + 1).padStart(2, '0')}</div>
                    <div>
                      <h2>
                        <Link href={docHref(item.doc, item.page)}>{m?.title || item.label || item.doc}</Link>
                      </h2>
                      <Link href={docHref(item.doc, item.page)} className="mono">
                        {batesRange(item.doc, m?.bates_end)} ↗
                      </Link>
                      {m?.summary && <p className="small">{m.summary}</p>}
                      <p>
                        {item.box ? `Box ${item.box} · ` : ''}
                        {m?.title ? 'Machine-extracted title' : "Label derived from the City's folder field"}
                        {removed ? ' · removed by the City' : ''}
                      </p>
                      <label htmlFor={`case-note-${i}`}>Your note</label>
                      <Textarea
                        id={`case-note-${i}`}
                        defaultValue={item.note}
                        onBlur={(e) => {
                          if (e.target.value !== item.note) {
                            updateNote(item.doc, item.page, e.target.value);
                            show('Note saved in this browser.');
                          }
                        }}
                      />
                      <Button variant="secondary" size="small" type="button" className="mt-2" onClick={() => remove(item.doc, item.page)}>
                        Remove from case
                      </Button>
                    </div>
                    <div className="order-controls">
                      <button
                        className="move-up"
                        type="button"
                        disabled={i === 0}
                        aria-label={`Move exhibit ${i + 1} up`}
                        onClick={() => moveUp(i)}
                      >
                        ↑ Up
                      </button>
                      <button
                        className="move-down"
                        type="button"
                        disabled={i === items.length - 1}
                        aria-label={`Move exhibit ${i + 1} down`}
                        onClick={() => moveDown(i)}
                      >
                        ↓ Down
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
          <aside className="side-panel">
            <section>
              <h2>Export contents</h2>
              <p>A CSV exhibit list: exhibit number, Bates page, the document&apos;s Bates range, our permalink, the note and the City&apos;s official PDF URL when known.</p>
            </section>
            <section>
              <h2>Before using a page</h2>
              <p>Open the current official PDF and check the Bates stamp. A City removal or new redaction may change what is available.</p>
              <ButtonLink variant="secondary" href="/changes">
                Check release changes →
              </ButtonLink>
            </section>
            <section>
              <h2>Local case folder</h2>
              <p>These notes stay in this browser. No account or cloud sync is connected. Export to keep a separate copy.</p>
            </section>
          </aside>
        </div>
      )}

      <section className="discovery mt-7">
        <div className="section-head">
          <h2>Case-folder suggestions</h2>
          <Link href="/topics">Browse subjects →</Link>
        </div>
        <p className="small muted">Records similar to what you&apos;ve saved, not yet in this case folder. Suggestions are records, never people.</p>
        {!items.length ? (
          <p className="small muted">Save a page to see suggestions.</p>
        ) : !suggestions.loaded ? (
          <p className="small muted">Looking for similar pages…</p>
        ) : suggestions.unavailable ? (
          <p>Suggestions are temporarily unavailable.</p>
        ) : !suggestions.rows.length ? (
          <p>No similar unsaved pages found yet.</p>
        ) : (
          <div className="discovery-grid">
            <div className="stack">
              {suggestions.rows.map((s) => {
                const m = meta[s.doc];
                return (
                  <div key={`${s.doc}:${s.page}`}>
                    <Link className="question-link" href={docHref(s.doc, s.page)}>
                      {m?.title || m?.folder || s.doc} · page {s.page} <span>{s.score.toFixed(2)}</span>
                    </Link>
                    <p className="small muted">
                      {s.reason} <Link href={docHref(s.doc, s.page)}>{batesRange(s.doc, m?.bates_end)} ↗</Link>
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <Dialog
        ref={dialogRef}
        id="case-export-dialog"
        title="Exhibit list"
        description="Copy this list, or download it as a CSV."
        primaryAction={{ label: 'Copy', onClick: copyCsv }}
        secondaryAction={{ label: 'Download CSV', onClick: downloadCsv }}
      >
        <Textarea aria-label="Exhibit list CSV" readOnly value={csv} style={{ minHeight: 160 }} />
      </Dialog>
      <Toast message={message} />
    </>
  );
}
