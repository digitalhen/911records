'use client';

// The interactive half of a "list" Ask answer (B21, issue #35): client-side
// sort (rows are already bounded to MAX_LIST_ROWS — see lib/ask/lists.ts —
// so an in-browser sort is cheap and needs no round trip), "Copy as CSV"
// and "Save all to case" (lib/case/store.ts, the same localStorage folder
// every other save-to-case control uses). The server component
// (components/ask/ListAnswer.tsx) hands this plain, already-fetched rows —
// no functions cross the server/client boundary.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { DataTable, Button, type DataTableColumn } from '@/components/ui';
import { useCaseFolder } from '@/lib/case/useCaseFolder';
import type { ListRow } from '@/lib/ask/lists';

function csvEscape(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function dateSpan(r: ListRow): string {
  if (!r.firstDate) return '—';
  return r.lastDate && r.lastDate !== r.firstDate ? `${r.firstDate} – ${r.lastDate}` : r.firstDate;
}

export function ListTable({
  rows,
  extraColumnLabels,
  truncated,
}: {
  rows: ListRow[];
  extraColumnLabels: string[];
  truncated: boolean;
}) {
  const [sortKey, setSortKey] = useState('pageCount');
  const [sortDir, setSortDir] = useState<'ascending' | 'descending'>('descending');
  const { add } = useCaseFolder();
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  const sorted = useMemo(() => {
    const extraIndex = sortKey.startsWith('extra:') ? Number(sortKey.slice(6)) : -1;
    const value = (r: ListRow): string | number => {
      if (extraIndex >= 0) return r.extra[extraIndex]?.value || '';
      if (sortKey === 'label') return r.label;
      if (sortKey === 'docCount') return r.docCount;
      if (sortKey === 'pageCount') return r.pageCount;
      if (sortKey === 'dates') return r.firstDate || '';
      return '';
    };
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'ascending' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function onSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'ascending' ? 'descending' : 'ascending'));
    } else {
      setSortKey(key);
      setSortDir(key === 'label' ? 'ascending' : 'descending');
    }
  }

  const columns: DataTableColumn<ListRow>[] = [
    {
      key: 'label',
      header: 'Name',
      sortable: true,
      render: (r) => (r.href ? <Link href={r.href}>{r.label}</Link> : r.label),
    },
    ...extraColumnLabels.map(
      (label, i): DataTableColumn<ListRow> => ({
        key: `extra:${i}`,
        header: label,
        sortable: true,
        render: (r) => r.extra[i]?.value || '—',
      }),
    ),
    {
      key: 'docCount',
      header: 'Docs',
      align: 'right',
      sortable: true,
      render: (r) => (r.href ? <Link href={r.href}>{r.docCount}</Link> : r.docCount),
    },
    {
      key: 'pageCount',
      header: 'Pages',
      align: 'right',
      sortable: true,
      render: (r) => (r.href ? <Link href={r.href}>{r.pageCount}</Link> : r.pageCount),
    },
    {
      key: 'dates',
      header: 'Dates',
      sortable: true,
      render: (r) => dateSpan(r),
    },
  ];

  function copyCsv() {
    const header = ['Name', ...extraColumnLabels, 'Docs', 'Pages', 'First date', 'Last date'];
    const lines = [
      header,
      ...sorted.map((r) => [r.label, ...r.extra.map((e) => e.value), r.docCount, r.pageCount, r.firstDate || '', r.lastDate || '']),
    ];
    const csv = lines.map((row) => row.map(csvEscape).join(',')).join('\r\n');
    navigator.clipboard?.writeText(csv).then(
      () => {
        setCopyState('copied');
        setTimeout(() => setCopyState('idle'), 2000);
      },
      () => {},
    );
  }

  function saveAllToCase() {
    for (const r of sorted) {
      if (!r.cite) continue;
      add({
        doc: r.cite.doc,
        page: r.cite.page,
        batesPage: r.cite.batesPage,
        label: r.label,
        box: r.cite.box,
        agency: r.cite.agency,
        volume: r.cite.volume,
      });
    }
  }

  return (
    <div>
      <div className="mb-3 flex gap-2" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        <Button type="button" variant="secondary" size="small" onClick={copyCsv}>
          {copyState === 'copied' ? 'Copied ✓' : 'Copy as CSV'}
        </Button>
        <Button type="button" variant="secondary" size="small" onClick={saveAllToCase}>
          Save all to case
        </Button>
      </div>
      <DataTable columns={columns} rows={sorted} rowKey={(r) => r.key} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
      {truncated && (
        <p className="small muted mt-2">
          Showing the first {rows.length} rows — ask a narrower question (a date range, a specific building) for a
          complete list.
        </p>
      )}
    </div>
  );
}
