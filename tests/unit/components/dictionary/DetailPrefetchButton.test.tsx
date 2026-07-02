// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DetailPrefetchButton } from '@/components/dictionary/DetailPrefetchButton';

vi.mock('@/lib/tts-cache', () => ({
  prefetchTts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/toast-store', () => ({
  useToastStore: (sel: any) => sel({ push: vi.fn() }),
}));

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DetailPrefetchButton', () => {
  it('renders a button with the related count', () => {
    render(<DetailPrefetchButton relatedChars={['女', '好', '学']} />);
    expect(screen.getByRole('button', { name: /预取同部首 \(3\)/ })).toBeInTheDocument();
  });

  it('clicking the button calls prefetchTts for each char (in order)', async () => {
    const tts = await import('@/lib/tts-cache');
    render(<DetailPrefetchButton relatedChars={['女', '好']} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(tts.prefetchTts).toHaveBeenCalledTimes(2);
    });
    expect(tts.prefetchTts).toHaveBeenNthCalledWith(1, 'female', '女');
    expect(tts.prefetchTts).toHaveBeenNthCalledWith(2, 'female', '好');
  });

  it('disables the button when relatedChars is empty', () => {
    render(<DetailPrefetchButton relatedChars={[]} />);
    const btn = screen.getByRole('button', { name: /预取同部首 \(0\)/ });
    expect(btn).toBeDisabled();
  });

  it('respects the cap prop (does not prefetch more than cap chars)', async () => {
    const tts = await import('@/lib/tts-cache');
    render(<DetailPrefetchButton relatedChars={['a', 'b', 'c', 'd', 'e']} cap={2} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(tts.prefetchTts).toHaveBeenCalledTimes(2);
    });
  });
});