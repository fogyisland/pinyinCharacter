// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ResponsiveTable } from '@/components/admin/ResponsiveTable';

interface Row {
  id: number;
  a: string;
  b: number;
  c: boolean;
}

const rows: Row[] = [
  { id: 1, a: 'one', b: 10, c: true },
  { id: 2, a: 'two', b: 20, c: false },
];

describe('ResponsiveTable — Fragment children flatten correctly', () => {
  it('renders one <td> per column when children returns a Fragment', () => {
    const { container } = render(
      <ResponsiveTable
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { key: 'a', header: 'A' },
          { key: 'b', header: 'B' },
          { key: 'c', header: 'C' },
        ]}
      >
        {(r) => (
          <>
            <span>{r.a}</span>
            <span>{r.b}</span>
            <span>{r.c ? 'yes' : 'no'}</span>
          </>
        )}
      </ResponsiveTable>,
    );
    // 2 rows × 3 cols = 6 <td> on desktop table
    const tds = container.querySelectorAll('table td');
    expect(tds.length).toBe(6);
    // Each row should have one cell per column value
    expect(tds[0]?.textContent).toBe('one');
    expect(tds[1]?.textContent).toBe('10');
    expect(tds[2]?.textContent).toBe('yes');
    expect(tds[3]?.textContent).toBe('two');
    expect(tds[4]?.textContent).toBe('20');
    expect(tds[5]?.textContent).toBe('no');
  });

  it('also works when children returns a bare array', () => {
    const { container } = render(
      <ResponsiveTable
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { key: 'a', header: 'A' },
          { key: 'b', header: 'B' },
        ]}
      >
        {(r) => [<span key="a">{r.a}</span>, <span key="b">{r.b}</span>]}
      </ResponsiveTable>,
    );
    const tds = container.querySelectorAll('table td');
    expect(tds.length).toBe(4);
  });

  it('builds the cells of a row only once and ships a single copy of the rows', () => {
    // The component used to render the desktop table AND a parallel list of
    // mobile cards, so every row existed twice and the children function ran
    // once per layout. There is now one <table>; the narrow-screen layout is
    // pure CSS driven by the data-label attribute.
    const children = vi.fn((r: Row) => (
      <>
        <span>{r.a}</span>
        <span>{r.b}</span>
      </>
    ));

    const { container } = render(
      <ResponsiveTable
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { key: 'a', header: 'A' },
          { key: 'b', header: 'B' },
        ]}
      >
        {children}
      </ResponsiveTable>,
    );

    expect(children).toHaveBeenCalledTimes(rows.length);
    expect(container.querySelectorAll('table').length).toBe(1);
    expect(container.querySelectorAll('table td').length).toBe(4);
    // The mobile card copy is gone — no second set of cells in the DOM.
    expect(container.querySelectorAll('.md\\:hidden').length).toBe(0);
    // Each cell carries the header text so the CSS layout can label it.
    const firstRow = container.querySelectorAll('table tbody tr')[0];
    const labels = Array.from(firstRow?.querySelectorAll('td') ?? []).map((td) =>
      td.getAttribute('data-label'),
    );
    expect(labels).toEqual(['A', 'B']);
  });

  it('marks the mobile title column and hides the columns flagged mobileHide', () => {
    const { container } = render(
      <ResponsiveTable
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { key: 'a', header: 'A', mobileTitle: true },
          { key: 'b', header: 'B' },
          { key: 'c', header: 'C', mobileHide: true },
        ]}
      >
        {(r) => [<span key="a">{r.a}</span>, <span key="b">{r.b}</span>, <span key="c">{r.c ? 'yes' : 'no'}</span>]}
      </ResponsiveTable>,
    );

    const firstRow = container.querySelectorAll('table tbody tr')[0];
    const roles = Array.from(firstRow?.querySelectorAll('td') ?? []).map((td) =>
      td.getAttribute('data-mobile'),
    );
    expect(roles).toEqual(['title', 'field', 'hide']);
  });
});
