import type { ReactNode } from 'react';
import { Children } from 'react';

export interface ResponsiveColumn {
  /** Unique key for the column. */
  key: string;
  /** Desktop table header text. Also used as mobile card row label. */
  header: string;
  /** Mobile: render this column as the card title (larger, bold). */
  mobileTitle?: boolean;
  /** Mobile: hide this column from the detail list (rare). */
  mobileHide?: boolean;
  /** Optional CSS class for the desktop <th>. */
  headerClassName?: string;
  /** Optional CSS class for the desktop <td>. */
  className?: string;
}

interface Props<T> {
  columns: ResponsiveColumn[];
  rows: T[];
  rowKey: (row: T) => string | number;
  /**
   * Function-as-children (RSC-friendly — the function runs on the server and
   * the resulting React elements are serialized). Return a single Fragment
   * containing one child per column, in the same order as `columns`. The
   * component wraps each in <td> for desktop and re-layouts for mobile.
   */
  children: (row: T) => ReactNode;
  emptyMessage?: string;
  /** Optional extra classes applied to both desktop & mobile wrappers. */
  className?: string;
}

export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  children,
  emptyMessage = '暂无数据',
  className = '',
}: Props<T>) {
  if (rows.length === 0) {
    return (
      <div className={`card-paper rounded-lg p-6 text-center text-ink-faint text-sm ${className}`}>
        {emptyMessage}
      </div>
    );
  }
  const titleIdx = columns.findIndex(c => c.mobileTitle);
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
            {rows.map(r => {
              const cells = Children.toArray(children(r));
              return (
                <tr key={rowKey(r)} className="border-t">
                  {cells.map((cell, i) => (
                    <td key={i} className={`px-3 py-2 ${columns[i]?.className ?? ''}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards (<md) */}
      <div className={`md:hidden space-y-2 ${className}`}>
        {rows.map(r => {
          const cells = Children.toArray(children(r));
          return (
            <div key={rowKey(r)} className="card-paper rounded-lg p-3">
              {titleIdx >= 0 && (
                <div className="font-medium text-ink mb-2 break-words">{cells[titleIdx]}</div>
              )}
              <dl className="space-y-1 text-sm">
                {columns.map((c, i) => {
                  if (i === titleIdx || c.mobileHide) return null;
                  return (
                    <div key={c.key} className="flex justify-between gap-3">
                      <dt className="text-ink-soft shrink-0">{c.header}</dt>
                      <dd className="text-right min-w-0 break-words">{cells[i]}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          );
        })}
      </div>
    </>
  );
}