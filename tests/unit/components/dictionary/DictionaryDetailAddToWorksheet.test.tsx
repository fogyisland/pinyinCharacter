// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
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
  useToastStore: (sel: any) => sel({ push: mockPushToast }),
}));

import { DictionaryDetailAddToWorksheet } from '@/components/dictionary/DictionaryDetailAddToWorksheet';

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

  it('confirming the dialog calls appendCharToWorksheetApi with the right args', async () => {
    mockAppend.mockResolvedValue({
      worksheetId: 1, title: '我的字帖', added: true, addedCount: 1, skipped: 0, charCount: 6, created: false,
    });
    render(<DictionaryDetailAddToWorksheet char="永" />);
    fireEvent.click(screen.getByRole('button', { name: /\+ 字帖/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /确认/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /确认/ }));
    await waitFor(() => {
      expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({ chars: ['永'], worksheetId: 1 }));
    });
  });
});
