// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// The real `useRouter()` hands back the SAME router object on every render,
// and `usePathname()` the same string. A factory that builds a fresh object
// per call makes `AddToWorksheetDialog`'s load effect (whose deps include
// `router`) re-run on every render, so one dialog open fired the list request
// three times - and one of those late flushes landed after `mockReset()`, on a
// bare spy, so the dialog read `.then` off `undefined` and React printed an
// uncaught error into the suite output. Mock the contract, not a lookalike.
const stableRouter = { push: vi.fn() };

vi.mock('next/navigation', () => ({
  useRouter: () => stableRouter,
  usePathname: () => '/dictionary/永',
}));

const mockListLightweight = vi.fn();
const mockAppend = vi.fn();
const mockPushToast = vi.fn();

vi.mock('@/lib/api-worksheet', () => ({
  listWorksheetsLightweight: (...args: unknown[]) => mockListLightweight(...args),
  appendCharToWorksheetApi: (...args: unknown[]) => mockAppend(...args),
}));

vi.mock('@/lib/toast-store', () => ({
  useToastStore: (
    sel: (state: { push: (kind: ToastKind, text: string) => void }) => unknown,
  ) => sel({ push: mockPushToast }),
}));

import { DictionaryDetailAddToWorksheet } from '@/components/dictionary/DictionaryDetailAddToWorksheet';
import type { ToastKind } from '@/lib/toast-store';

beforeEach(() => {
  cleanup();
  mockListLightweight.mockReset();
  mockAppend.mockReset();
  mockPushToast.mockReset();
  mockListLightweight.mockResolvedValue([
    { id: 1, title: '我的字帖', charCount: 5, createdAt: '2026-06-29T00:00:00Z' },
  ]);
});

describe('DictionaryDetailAddToWorksheet — opens dialog instead of silent add', () => {
  it('renders the + 字帖 button', () => {
    render(<DictionaryDetailAddToWorksheet char="永" />);
    expect(screen.getByRole('button', { name: /\+ 字帖/ })).toBeInTheDocument();
  });

  it('does NOT call appendCharToWorksheetApi on mount', () => {
    render(<DictionaryDetailAddToWorksheet char="永" />);
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it('clicking + 字帖 opens the AddToWorksheetDialog (not silent add)', async () => {
    render(<DictionaryDetailAddToWorksheet char="永" />);
    fireEvent.click(screen.getByRole('button', { name: /\+ 字帖/ }));
    // Dialog shows the 确认 button (only present in the dialog footer)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /确认/ })).toBeInTheDocument();
    });
    // Append should NOT have been called yet (no confirm click)
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it('asks for the worksheet list once per dialog open, not once per render', async () => {
    render(<DictionaryDetailAddToWorksheet char="永" />);
    fireEvent.click(screen.getByRole('button', { name: /\+ 字帖/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /确认/ })).toBeInTheDocument();
    });
    // The dialog's load effect keys off `open` and `router`. If the mocked
    // router were a fresh object per render the effect would re-fire on every
    // render, so this count is what pins "the load runs once".
    expect(mockListLightweight).toHaveBeenCalledTimes(1);
  });

  it('confirming the dialog calls appendCharToWorksheetApi with the right args', async () => {
    mockAppend.mockResolvedValue({
      worksheetId: 1,
      title: '我的字帖',
      added: true,
      addedCount: 1,
      skipped: 0,
      charCount: 6,
      created: false,
    });
    render(<DictionaryDetailAddToWorksheet char="永" />);
    fireEvent.click(screen.getByRole('button', { name: /\+ 字帖/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /确认/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /确认/ }));
    await waitFor(() => {
      expect(mockAppend).toHaveBeenCalledWith(
        expect.objectContaining({ chars: ['永'], worksheetId: 1 }),
      );
    });
  });
});
