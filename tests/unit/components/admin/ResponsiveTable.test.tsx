// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ResponsiveTable } from '@/components/admin/ResponsiveTable';

interface Row { id: number; a: string; b: number; c: boolean; }

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
      </ResponsiveTable>
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
      </ResponsiveTable>
    );
    const tds = container.querySelectorAll('table td');
    expect(tds.length).toBe(4);
  });
});
