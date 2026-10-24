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

/**
 * How tall the scrolling table region may be.
 *
 * The list region only scrolls when it is given a height, and a sticky
 * header only pins while its container scrolls — so the height and the
 * sticky header come together. The values are literal class names because
 * Tailwind only generates the classes it can see written out in the source.
 */
export type TableMaxHeight = 'none' | 'short' | 'medium' | 'tall';

const MAX_HEIGHT_CLASS: Record<TableMaxHeight, string> = {
  none: '',
  short: 'max-h-[50vh]',
  medium: 'max-h-[65vh]',
  tall: 'max-h-[80vh]',
};

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
  /** Shown in place of the table when there are no rows. */
  emptyMessage?: ReactNode;
  /** A screen-reader-only caption describing the table. */
  caption?: string;
  /** How tall the scrolling list region may be. */
  maxHeight?: TableMaxHeight;
  /**
   * Draw the paper card around the table.
   *
   * A table that stands on its own needs the frame; a table that sits
   * flush inside a `Panel` must not have one, or the reader sees a card
   * inside a card.
   */
  framed?: boolean;
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
  caption,
  maxHeight = 'none',
  framed = true,
  className = '',
}: Props<T>) {
  const frameClass = framed ? 'card-paper rounded-lg ' : '';
  if (rows.length === 0) {
    if (emptyMessage == null || emptyMessage === '') return null;
    return <div className={`${frameClass}${className}`}>{emptyMessage}</div>;
  }
  const titleIdx = columns.findIndex((c) => c.mobileTitle);
  // The children function is called once per row and the resulting cells are
  // shared by the desktop table and the mobile cards. It used to run twice per
  // row (once per layout), which doubled the cost of building every cell —
  // noticeable on the admin tables that format a date per cell.
  const rowCells = rows.map((row) => flattenCells(children(row)));
  return (
    <div
      className={`${frameClass}overflow-x-auto overflow-y-auto ${MAX_HEIGHT_CLASS[maxHeight]} ${className}`}
    >
      <table className="rt-table w-full text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
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
