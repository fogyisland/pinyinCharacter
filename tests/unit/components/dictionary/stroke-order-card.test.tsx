// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
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

  it('renders canvas + controls when fetch succeeds (Test 3)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ strokes: ['M0,0 L100,100'], medians: [] }),
    } as any);

    render(<StrokeOrderCard char="一" />);

    await waitFor(() => {
      // Replay + loop buttons visible
      expect(screen.getByRole('button', { name: /重新播放/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /循环播放/ })).toBeInTheDocument();
    });
    // Stroke count visible
    expect(screen.getByText(/1 \/ 1 画/)).toBeInTheDocument();
  });

  it('reinitializes writer when char prop changes (Test 7)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ strokes: [], medians: [] }),
    } as any);

    const { rerender } = render(<StrokeOrderCard char="一" />);
    await waitFor(() => {
      expect(screen.getByText(/1 \/ 1 画/)).toBeInTheDocument();
    });

    // Change char
    rerender(<StrokeOrderCard char="丁" />);
    await waitFor(() => {
      // New fetch for 丁 (URL-encoded by encodeURIComponent)
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/strokes/%E4%B8%81.json'));
    });
  });

  it('replay button replays the animation (Test 4)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ strokes: [], medians: [] }),
    } as any);

    render(<StrokeOrderCard char="一" />);
    await waitFor(() => {
      expect(screen.getByText(/1 \/ 1 画/)).toBeInTheDocument();
    });

    // Clear the auto-play call (loop was on by default)
    mockWriter.loopCharacterAnimation.mockClear();
    mockWriter.animateCharacter.mockClear();
    mockWriter.cancelAnimation.mockClear();

    // Click replay
    fireEvent.click(screen.getByRole('button', { name: /重新播放/ }));

    expect(mockWriter.cancelAnimation).toHaveBeenCalled();
    // loopEnabled is true by default, so loopCharacterAnimation is called
    expect(mockWriter.loopCharacterAnimation).toHaveBeenCalled();
  });

  it('loop toggle flips aria-pressed and cancels animation (Test 5)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ strokes: [], medians: [] }),
    } as any);

    render(<StrokeOrderCard char="一" />);
    await waitFor(() => {
      expect(screen.getByText(/1 \/ 1 画/)).toBeInTheDocument();
    });

    const loopBtn = screen.getByRole('button', { name: /循环播放/ });
    expect(loopBtn).toHaveAttribute('aria-pressed', 'true');

    mockWriter.cancelAnimation.mockClear();
    fireEvent.click(loopBtn);

    expect(loopBtn).toHaveAttribute('aria-pressed', 'false');
    expect(mockWriter.cancelAnimation).toHaveBeenCalled();
  });

  it('unmount calls writer.cancelAnimation (Test 6)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ strokes: [], medians: [] }),
    } as any);

    const { unmount } = render(<StrokeOrderCard char="一" />);
    await waitFor(() => {
      expect(screen.getByText(/1 \/ 1 画/)).toBeInTheDocument();
    });

    mockWriter.cancelAnimation.mockClear();
    unmount();

    expect(mockWriter.cancelAnimation).toHaveBeenCalled();
  });
});