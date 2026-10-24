// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, within, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The PDF renderer is reached through the lazily loaded
// `PracticePdfDownloader`, which calls `pdf()` from @react-pdf/renderer.
// In happy-dom the real renderer cannot lay out a document (and
// Font.register would try to read '/fonts/zcool-xiaowei.ttf' from CWD), so
// `pdf()` is stubbed and the call is recorded — that is what lets us assert
// that the ~1 MB renderer is only pulled in when the visitor asks for a PDF.
const { pdfMock } = vi.hoisted(() => ({
  pdfMock: vi.fn(() => ({
    toBlob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
  })),
}));

vi.mock('@react-pdf/renderer', async () => {
  const actual = await vi.importActual<typeof import('@react-pdf/renderer')>('@react-pdf/renderer');
  return {
    ...actual,
    pdf: pdfMock,
  };
});

import { PracticeTemplate } from '@/components/worksheet/PracticeTemplate';

// testing-library/react v16 dropped automatic cleanup — multiple `render()`
// calls in the same file would otherwise leave stale DOM behind, and
// `getByLabelText` would then find two elements sharing the same `id`.
afterEach(() => {
  cleanup();
  pdfMock.mockClear();
});

// happy-dom has no object-URL store; the download path needs one.
const originalCreateObjectURL = URL.createObjectURL;
beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:practice-pdf');
});
afterAll(() => {
  URL.createObjectURL = originalCreateObjectURL;
});

describe('PracticeTemplate — pen-lined option', () => {
  it('renders a 钢笔·横线 option in the 格子形式 select', () => {
    render(<PracticeTemplate />);
    const select = screen.getByLabelText('格子形式') as HTMLSelectElement;
    const options = within(select).getAllByRole('option');
    const labels = options.map((o) => o.textContent);
    expect(labels).toContain('钢笔 · 横线');
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

describe('PracticeTemplate — pen-english option (four-line English trace)', () => {
  it('renders a 钢笔·英文描红 option in the 格子形式 select', () => {
    render(<PracticeTemplate />);
    const select = screen.getByLabelText('格子形式') as HTMLSelectElement;
    const labels = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toContain('钢笔 · 英文描红');
  });

  it('selecting 钢笔·英文描红 renders 4-line ruled paper (CSS background, blank template)', async () => {
    const user = userEvent.setup();
    render(<PracticeTemplate />);
    await user.selectOptions(screen.getByLabelText('格子形式'), 'pen-english');
    // 4-line uses CSS linear-gradient background (not SVG per row). The
    // container .four-line-paper gets the ruled background; the rows are
    // empty <div className="four-line-paper-row" /> stacked vertically.
    const paper = document.querySelector('.four-line-paper');
    expect(paper).not.toBeNull();
    const rows = document.querySelectorAll('.four-line-paper-row');
    // A4 default: 16 rows/page (tuned 2026-07-03 from 14 to 18 to fill
    // more of the A4 sheet; 16×54px = 864px ≈ 4.7cm bottom margin).
    expect(rows.length).toBe(16);
    // No SVG and no letter — the rules come from background-image.
    expect(paper?.querySelector('svg')).toBeNull();
    expect(paper?.querySelector('text')).toBeNull();
  });

  it('4-line footer shows brand name "字·韵" in dev (NEXT_PUBLIC_SITE_URL is empty by design)', async () => {
    // Per memory next-public-site-url-from-admin: NEXT_PUBLIC_SITE_URL is
    // unset in local dev and only set in production by the admin backend.
    // The footer must still render something — fall back to the brand name
    // so the printable page is not missing its bottom line in dev.
    const user = userEvent.setup();
    render(<PracticeTemplate />);
    await user.selectOptions(screen.getByLabelText('格子形式'), 'pen-english');
    const paper = document.querySelector('.four-line-paper');
    const footer = paper?.querySelector('.text-ink-faint');
    // NEXT_PUBLIC_SITE_URL is empty in the test environment, so the
    // fallback '字·韵' must be rendered.
    expect(footer?.textContent?.trim()).toBe('字·韵');
  });

  it('header (字·韵 + 公益网站) lives INSIDE .four-line-paper so print position:absolute carries it (regression: 2026-07-03 blank-header bug)', async () => {
    const user = userEvent.setup();
    render(<PracticeTemplate />);
    await user.selectOptions(screen.getByLabelText('格子形式'), 'pen-english');
    const paper = document.querySelector('.four-line-paper');
    // The header line "字·韵 · 钢笔·英文描红" must be a descendant of
    // .four-line-paper. If a future refactor moves it to be a sibling of
    // .four-line-paper, the @media print position:absolute reset on
    // .four-line-paper would leave the header behind, and `body * {
    // visibility: hidden }` would hide it — producing a printable body
    // with rules but no header. This test pins the contract.
    const headerText = paper?.querySelector('span.font-kai');
    expect(headerText?.textContent).toMatch(/字·韵 · 钢笔·英文描红/);
  });

  it('switching pen-english → pen-square restores the 田字格 grid (regression)', async () => {
    const user = userEvent.setup();
    render(<PracticeTemplate />);
    await user.selectOptions(screen.getByLabelText('格子形式'), 'pen-english');
    await user.selectOptions(screen.getByLabelText('格子形式'), 'pen-square');
    const firstCell = document.querySelector('.worksheet-cell svg');
    // 田字格 uses viewBox 0 0 100 100, not 0 0 100 38
    expect(firstCell?.getAttribute('viewBox')).toBe('0 0 100 100');
  });
});

describe('PracticeTemplate — lazy PDF renderer', () => {
  it('does not load the PDF renderer before the download button is used', () => {
    render(<PracticeTemplate />);
    // @react-pdf/renderer + pdfkit is ~1 MB. It must stay out of the page
    // until a PDF is actually requested.
    expect(pdfMock).not.toHaveBeenCalled();
  });

  it('loads the PDF renderer and generates a document when 下载 PDF is clicked', async () => {
    const user = userEvent.setup();
    render(<PracticeTemplate />);
    const button = screen.getByRole('button', { name: '下载 PDF' });
    await user.click(button);
    await waitFor(() => expect(pdfMock).toHaveBeenCalledTimes(1), { timeout: 5000 });
  });

  it('renders the download button and the print button side by side', () => {
    render(<PracticeTemplate />);
    expect(screen.getByRole('button', { name: '下载 PDF' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '打印模板' })).toBeTruthy();
  });
});
