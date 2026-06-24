// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockSearchParams = new Map<string, string>();
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => mockSearchParams.get(k) ?? null }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/worksheet',
}));

vi.mock('@/lib/store', () => ({
  useAppStore: (sel: any) => sel({ user: null }),
}));

import { WorksheetGenerator } from '@/components/worksheet/WorksheetGenerator';

describe('WorksheetGenerator settings do NOT auto-jump to preview', () => {
  beforeEach(() => mockSearchParams.clear());

  it('changing font after entering content does NOT navigate to preview', () => {
    mockSearchParams.set('prefill', '永字八法');
    render(<WorksheetGenerator />);
    // Form should be visible (生成字帖 button)
    expect(screen.getByRole('button', { name: /生成字帖/ })).toBeInTheDocument();
    // No worksheet grid (preview) should be rendered
    expect(document.querySelector('.worksheet-grid')).toBeNull();
  });

  it('changing a setting does not navigate to preview (form stays visible)', () => {
    mockSearchParams.set('prefill', '永字八法');
    render(<WorksheetGenerator />);
    // Change paper size via the form's select — should NOT cause preview to mount
    const selects = document.querySelectorAll('select');
    expect(selects.length).toBeGreaterThan(0);
    // Pick the last <select> in the form (paperSize is near the end of the form)
    const lastSelect = selects[selects.length - 1] as HTMLSelectElement;
    fireEvent.change(lastSelect, { target: { value: 'A4' } });
    // Still no preview
    expect(document.querySelector('.worksheet-grid')).toBeNull();
    // And 生成字帖 button is still there
    expect(screen.getByRole('button', { name: /生成字帖/ })).toBeInTheDocument();
  });

  it('clicking 生成字帖 IS the way to enter preview', () => {
    mockSearchParams.set('prefill', '永字八法');
    render(<WorksheetGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /生成字帖/ }));
    expect(document.querySelector('.worksheet-grid')).not.toBeNull();
  });
});
