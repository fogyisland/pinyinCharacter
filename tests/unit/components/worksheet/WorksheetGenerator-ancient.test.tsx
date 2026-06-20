// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

// Mock next/navigation so useSearchParams returns our params
const mockSearchParams = new Map<string, string>();
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => mockSearchParams.get(k) ?? null }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/worksheet',
}));

// Mock /api/classics
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Mock the user store
vi.mock('@/lib/store', () => ({
  useAppStore: (sel: any) => sel({ user: null }),
}));

import { WorksheetGenerator } from '@/components/worksheet/WorksheetGenerator';

describe('WorksheetGenerator with source=ancient', () => {
  beforeEach(() => {
    mockSearchParams.clear();
    mockFetch.mockReset();
  });

  it('preloads chars from /api/classics when source=ancient', async () => {
    mockSearchParams.set('source', 'ancient');
    mockSearchParams.set('book', 'lunyu');
    mockSearchParams.set('chapterIdx', '0');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          id: 1, slug: 'lunyu', title: '论语', category: 'four-books', author: '孔子', era: '春秋',
          chunks: [
            { id: 1, label: '学而第一', content: ['子曰:学而时习之。'], pinyin: [] },
          ],
        },
      }),
    });
    render(<WorksheetGenerator />);
    // Wait for fetch + render
    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).toHaveBeenCalledWith('/api/classics/lunyu');
  });

  it('shows 上一章/下一章 buttons when source=ancient and chapter loaded', async () => {
    mockSearchParams.set('source', 'ancient');
    mockSearchParams.set('book', 'lunyu');
    mockSearchParams.set('chapterIdx', '0');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: {
          id: 1, slug: 'lunyu', title: '论语', category: 'four-books', author: '孔子', era: '春秋',
          chunks: [
            { id: 1, label: '学而第一', content: ['子曰学而时习之。'], pinyin: [] },
            { id: 2, label: '为政第二', content: ['子曰为政以德。'], pinyin: [] },
          ],
        },
      }),
    });
    render(<WorksheetGenerator />);
    await new Promise(r => setTimeout(r, 50));
    expect(screen.getByRole('button', { name: /下一章/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /上一章/ })).toBeInTheDocument();
  });

  it('does NOT show 上一章/下一章 when source is not ancient', async () => {
    mockSearchParams.set('prefill', '你好');
    render(<WorksheetGenerator />);
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: /下一章/ })).toBeNull();
  });
});
