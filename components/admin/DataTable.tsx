import type { ReactNode } from 'react';
import { ResponsiveTable } from '@/components/admin/ResponsiveTable';
import type { TableMaxHeight } from '@/components/admin/ResponsiveTable';
import { EmptyState } from '@/components/admin/EmptyState';

export interface DataTableColumn {
  /** Unique key for the column. */
  key: string;
  /** The column's header text, and its label on a phone. */
  header: string;
  /** Right-align the column and use tabular figures — for counts and dates. */
  numeric?: boolean;
  /** On a phone, show this column as the card's title. */
  mobileTitle?: boolean;
  /** On a phone, leave this column out. */
  mobileHide?: boolean;
  /** Extra classes for the header cell. */
  headerClassName?: string;
  /** Extra classes for the body cells. */
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn[];
  rows: T[];
  rowKey: (row: T) => string | number;
  /**
   * The cells of one row — one child per column, in the same order as
   * `columns`. The function runs on the server, so the table never reaches
   * the browser as React work.
   */
  children: (row: T) => ReactNode;
  /** Shown when there is nothing to list. */
  empty?: ReactNode;
  /** A screen-reader-only caption describing the table. */
  caption?: string;
  /** How tall the scrolling list region may be. */
  maxHeight?: TableMaxHeight;
  /**
   * Draw the paper card around the table.
   *
   * Pass `false` when the table sits flush inside a `Panel` — the panel is
   * already the card, and a second one would nest.
   */
  framed?: boolean;
  className?: string;
}

/**
 * The admin's canonical data table.
 *
 * Every admin list is a table, and each one had its own idea of what a
 * table looked like: a different header background, a different row
 * padding, numbers that were sometimes left-aligned, and no shared idea of
 * how tall a list should be before it starts scrolling. This component
 * holds those decisions:
 *
 *  - the header row is pinned while the list scrolls,
 *  - the rows are banded so the eye can follow a row across the columns,
 *  - a column marked `numeric` is right-aligned with tabular figures, so
 *    a column of counts lines up on the decimal,
 *  - an empty list shows the shared empty state rather than a bare line of
 *    text.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  children,
  empty,
  caption,
  maxHeight = 'tall',
  framed = true,
  className = '',
}: DataTableProps<T>) {
  const responsiveColumns = columns.map((c) => ({
    key: c.key,
    header: c.header,
    mobileTitle: c.mobileTitle,
    mobileHide: c.mobileHide,
    headerClassName: c.numeric ? `text-right ${c.headerClassName ?? ''}` : c.headerClassName,
    className: c.numeric ? `text-right tabular-nums ${c.className ?? ''}` : c.className,
  }));

  return (
    <ResponsiveTable
      columns={responsiveColumns}
      rows={rows}
      rowKey={rowKey}
      caption={caption}
      maxHeight={maxHeight}
      framed={framed}
      className={className}
      emptyMessage={empty ?? <EmptyState title="暂无数据" className="py-8" />}
    >
      {children}
    </ResponsiveTable>
  );
}

/**
 * The table's empty state, shown when the list has no rows.
 *
 * `DataTable` renders `empty` inside the table's own card, so the empty
 * list looks like the list — same border, same paper — instead of a
 * different box.
 */
export function DataTableEmpty({ title, description }: { title: string; description?: ReactNode }) {
  return <EmptyState title={title} description={description} className="py-10" />;
}
