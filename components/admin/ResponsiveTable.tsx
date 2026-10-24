import type { ReactNode } from 'react';
import { Fragment, isValidElement } from 'react';

export interface ResponsiveColumn {
  /** Unique key for the column. */
  key: string;
  /** Desktop table header text. Also used as the mobile card's field label. */
  header: string;
  /** Mobile: render this column as the card title (larger, bold). */
  mobileTitle?: boolean;
  /** Mobile: hide this column from the card (rare). */
  mobileHide?: boolean;
  /** Optional CSS class for the desktop <th>. */
  headerClassName?: string;
  /** Optional CSS class for the desktop <td>. */
  className?: string;
}

/**
 * `Children.toArray(<><a/><b/></>)` returns 1 element (the Fragment itself) —
 * Fragments are NOT flattened. That made the entire `ResponsiveTable` body
 * collapse to a single <td> per row, leaving the other columns empty. We
 * walk Fragments and nested arrays explicitly so callers can keep returning
 * a Fragment from the children function (the natural JSX shape).
 */
function flattenCells(node: ReactNode): ReactNode[] {
  if (node == null || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(flattenCells);
  if (isValidElement(node) && node.type === Fragment) {
    return flattenCells((node.props as { children: ReactNode }).children);
  }
  return [node];
}

/** How a cell behaves once the table collapses into cards on a narrow screen. */
type MobileRole = 'title' | 'field' | 'hide';

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
  /** Optional extra classes applied to the table wrapper. */
  className?: string;
}

/**
 * A data table that stays readable on a phone — with ONE copy of the rows.
 *
 * The first version rendered the desktop `<table>` AND a parallel list of
 * mobile cards, hiding one of them with `hidden md:block` / `md:hidden`. The
 * hidden copy was still in the DOM, so every row existed twice: the logs
 * page shipped 50 rows x 7 columns x 2 layouts = 700 cells to the browser,
 * and React reconciled all of them.
 *
 * Now there is a single `<table>`. The narrow-screen layout is pure CSS
 * (see the `.rt-table` rules in app/globals.css): the head collapses away
 * and each cell becomes a labelled line, using the `data-label` attribute
 * for the label the header used to provide.
 */
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
  const titleIdx = columns.findIndex((c) => c.mobileTitle);
  // The children function is called once per row and the resulting cells are
  // shared by the desktop table and the mobile cards. It used to run twice per
  // row (once per layout), which doubled the cost of building every cell —
  // noticeable on the admin tables that format a date per cell.
  const rowCells = rows.map((row) => flattenCells(children(row)));
  return (
    <div className={`card-paper rounded-lg overflow-x-auto ${className}`}>
      <table className="rt-table w-full text-sm">
        <thead className="bg-paper-deep text-left">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-3 py-2 whitespace-nowrap ${c.headerClassName ?? ''}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, rowIndex) => {
            const cells = rowCells[rowIndex];
            return (
              <tr key={rowKey(r)} className="border-t">
                {cells.map((cell, i) => {
                  const column = columns[i];
                  const role: MobileRole =
                    i === titleIdx ? 'title' : column?.mobileHide ? 'hide' : 'field';
                  return (
                    <td
                      key={i}
                      data-label={column?.header ?? ''}
                      data-mobile={role}
                      className={`px-3 py-2 ${column?.className ?? ''}`}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
