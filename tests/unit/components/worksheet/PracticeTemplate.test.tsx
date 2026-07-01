// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// @react-pdf/renderer is used by PracticeTemplate (dynamic PDFDownloadLink)
// and by PracticePDF (Font.register at module load). In happy-dom, the
// renderer throws on instantiation, and Font.register would try to read
// '/fonts/zcool-xiaowei.ttf' from CWD. Spread the actual module so Font
// and other named exports survive, then stub only PDFDownloadLink to a
// plain anchor so we can exercise the UI tree without running react-pdf.
vi.mock('@react-pdf/renderer', async () => {
  const actual = await vi.importActual<typeof import('@react-pdf/renderer')>('@react-pdf/renderer');
  return {
    ...actual,
    PDFDownloadLink: ({ children, fileName }: { children: unknown; fileName?: string }) => (
      <a data-testid="pdf-link" data-filename={fileName}>{typeof children === 'function' ? children({ loading: false }) : children}</a>
    ),
  };
});

import { PracticeTemplate } from '@/components/worksheet/PracticeTemplate';

// testing-library/react v16 dropped automatic cleanup — multiple `render()`
// calls in the same file would otherwise leave stale DOM behind, and
// `getByLabelText` would then find two elements sharing the same `id`.
afterEach(() => {
  cleanup();
});

describe('PracticeTemplate — pen-lined option', () => {
  it('renders a 钢笔·横线 option in the 格子形式 select', () => {
    render(<PracticeTemplate />);
    const select = screen.getByLabelText('格子形式') as HTMLSelectElement;
    const options = within(select).getAllByRole('option');
    const labels = options.map((o) => o.textContent);
    expect(labels).toContain('钢笔·横线');
  });

  it('defaults to pen-square (regression: lined does not change default)', () => {
    render(<PracticeTemplate />);
    const select = screen.getByLabelText('格子形式') as HTMLSelectElement;
    expect(select.value).toBe('pen-square');
  });
});

describe('PracticeTemplate — lined render branch', () => {
  it('after selecting 钢笔·横线, renders 24 row containers (A4 default) inside .lined-paper', async () => {
    const user = userEvent.setup();
    render(<PracticeTemplate />);
    const select = screen.getByLabelText('格子形式') as HTMLSelectElement;
    await user.selectOptions(select, 'pen-lined');
    const lined = document.querySelector('.lined-paper');
    expect(lined).not.toBeNull();
    const rows = document.querySelectorAll('.lined-paper-row');
    expect(rows.length).toBe(24);
  });

  it('each lined row is 38px tall (A4 linedHeightPx)', async () => {
    const user = userEvent.setup();
    render(<PracticeTemplate />);
    await user.selectOptions(screen.getByLabelText('格子形式'), 'pen-lined');
    const firstRow = document.querySelector('.lined-paper-row') as HTMLElement;
    expect(firstRow.style.height).toBe('38px');
  });

  it('after selecting 钢笔·横线, the hint text shows "24 行 / 页" instead of "格 / 页"', async () => {
    const user = userEvent.setup();
    render(<PracticeTemplate />);
    await user.selectOptions(screen.getByLabelText('格子形式'), 'pen-lined');
    expect(screen.getByText(/24 行 \/ 页/)).toBeTruthy();
  });

  it('switching back to 钢笔·田字格 restores the .worksheet-grid layout (regression)', async () => {
    const user = userEvent.setup();
    render(<PracticeTemplate />);
    await user.selectOptions(screen.getByLabelText('格子形式'), 'pen-lined');
    await user.selectOptions(screen.getByLabelText('格子形式'), 'pen-square');
    expect(document.querySelector('.lined-paper')).toBeNull();
    expect(document.querySelector('.worksheet-grid')).not.toBeNull();
  });
});
