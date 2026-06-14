// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { StrokeOrderCard } from '@/components/dictionary/StrokeOrderCard';

// Mock the heavy hanzi-writer module so tests don't load real lib
const mockWriter = {
  loopCharacterAnimation: vi.fn(),
  animateCharacter: vi.fn(),
  cancelAnimation: vi.fn(),
  getNumStrokes: vi.fn(() => 1),
};
vi.mock('hanzi-writer', () => ({
  default: {
    create: vi.fn(() => mockWriter),
  },
}));

describe('StrokeOrderCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriter.getNumStrokes.mockReturnValue(1);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows loading state initially (Test 1)', () => {
    // fetch is in flight; component renders spinner
    global.fetch = vi.fn(() => new Promise(() => {})) as any; // never resolves
    render(<StrokeOrderCard char="一" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows error state when /strokes/{char}.json 404s (Test 2)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as any);
    render(<StrokeOrderCard char="𠮷" />);
    await waitFor(() => {
      expect(screen.getByText(/暂无.*笔画数据/)).toBeInTheDocument();
    });
  });
});