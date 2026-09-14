import type { ReactNode } from 'react';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
  sortable?: boolean;
}

/**
 * DataTable — dense records table. Sorting (when `sortKey`/`onSort` are
 * given) is left to the caller (server or client) so this stays a plain
 * renderer; pass no sort props for a static table.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  dense = true,
  sortKey,
  sortDir,
  onSort,
  caption,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  dense?: boolean;
  sortKey?: string;
  sortDir?: 'ascending' | 'descending';
  onSort?: (key: string) => void;
  caption?: string;
}) {
  return (
    <div className="table-wrap">
      <table className={['data-table', dense ? 'dense' : ''].filter(Boolean).join(' ')}>
        {caption && <caption className="small muted">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((col) => {
              const sorted = col.sortable && sortKey === col.key;
              return (
                <th
                  key={col.key}
                  style={{ textAlign: col.align === 'right' ? 'right' : undefined }}
                  aria-sort={col.sortable ? (sorted ? sortDir : 'none') : undefined}
                  onClick={col.sortable && onSort ? () => onSort(col.key) : undefined}
                >
                  {col.header}
                  {col.sortable && <span className="sort-indicator">{sorted ? (sortDir === 'ascending' ? '▲' : '▼') : '↕'}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td key={col.key} style={{ textAlign: col.align === 'right' ? 'right' : undefined }}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
