'use client';
import type { ReactNode } from 'react';

export interface ResponsiveColumn<T> {
  /** Unique key for the column. */
  key: string;
  /** Desktop table header text. Also used as mobile card row label. */
  header: string;
  /** Cell content renderer. */
  render: (row: T) => ReactNode;
  /** Mobile: render this column as the card title (larger, bold). */
  mobileTitle?: boolean;
  /** Mobile: hide this column entirely (rare — only when redundant with title). */
  mobileHide?: boolean;
  /** Optional CSS class for the desktop <td>. */
  className?: string;
  /** Optional CSS class for the desktop <th>. */
  headerClassName?: string;
}

interface Props<T> {
  columns: ResponsiveColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  emptyMessage?: string;
  /** Optional extra classes applied to both desktop & mobile wrappers. */
  className?: string;
  /** When provided, both desktop rows and mobile cards become clickable. */
  onRowClick?: (row: T) => void;
}

export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = '暂无数据',
  className = '',
  onRowClick,
}: Props<T>) {
  if (rows.length === 0) {
    return (
      <div className={`card-paper rounded-lg p-6 text-center text-ink-faint text-sm ${className}`}>
        {emptyMessage}
      </div>
    );
  }
  const titleCol = columns.find(c => c.mobileTitle);
  const detailCols = columns.filter(c => c !== titleCol);
  const rowInteractive = !!onRowClick;
  return (
    <>
      {/* Desktop table (md+) */}
      <div className={`hidden md:block card-paper rounded-lg overflow-x-auto ${className}`}>
        <table className="w-full text-sm">
          <thead className="bg-paper-deep text-left">
            <tr>
              {columns.map(c => (
                <th key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.headerClassName ?? ''}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr
                key={rowKey(r)}
                className={`border-t ${rowInteractive ? 'cursor-pointer hover:bg-paper-warm/50' : ''}`}
                onClick={rowInteractive ? () => onRowClick!(r) : undefined}
              >
                {columns.map(c => (
                  <td key={c.key} className={`px-3 py-2 ${c.className ?? ''}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards (<md) */}
      <div className={`md:hidden space-y-2 ${className}`}>
        {rows.map(r => (
          <div
            key={rowKey(r)}
            className={`card-paper rounded-lg p-3 ${rowInteractive ? 'cursor-pointer' : ''}`}
            onClick={rowInteractive ? () => onRowClick!(r) : undefined}
            role={rowInteractive ? 'button' : undefined}
            tabIndex={rowInteractive ? 0 : undefined}
            onKeyDown={rowInteractive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick!(r); } } : undefined}
          >
            {titleCol && <div className="font-medium text-ink mb-2 break-words">{titleCol.render(r)}</div>}
            <dl className="space-y-1 text-sm">
              {detailCols.filter(c => !c.mobileHide).map(c => (
                <div key={c.key} className="flex justify-between gap-3">
                  <dt className="text-ink-soft shrink-0">{c.header}</dt>
                  <dd className="text-right min-w-0 break-words">{c.render(r)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}