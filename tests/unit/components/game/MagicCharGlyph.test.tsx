/**
 * MagicCharGlyph — one character, drawn.
 *
 * The glyph is drawn by `hanzi-writer` from the site's own stroke data
 * (`public/strokes/<char>.json`), so the character the player sees is the
 * same character the relation table was computed from.
 *
 * Two things must never break the game:
 *
 *   - the character may have no stroke data at all (a rare character the
 *     site has no strokes for) — then the plain character is shown;
 *   - the writer may fail to load — then the plain character is shown.
 *
 * Either way the option is still clickable and still readable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// @vitest-environment happy-dom

/** The writer module is mocked: the real one needs a DOM and network. */
const mockState = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('hanzi-writer', () => ({
  default: {
    create: (target: HTMLElement, char: string, options: Record<string, unknown>) =>
      mockState.create(target, char, options),
  },
}));

/** The stroke data a character with strokes would load. */
const STROKE_DATA = JSON.stringify({ strokes: ['M0 0'], medians: [[[0, 0]]] });

describe('MagicCharGlyph', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cleanup();
    vi.resetModules();
    mockState.create.mockReset();
    mockState.create.mockImplementation(() => ({
      showCharacter: vi.fn(),
      pauseAnimation: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('draws the character with hanzi-writer', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(STROKE_DATA, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch;
    const { MagicCharGlyph } = await import('@/components/game/MagicCharGlyph');
    render(<MagicCharGlyph char="大" />);
    await waitFor(() => {
      expect(mockState.create).toHaveBeenCalled();
    });
    const [, char] = mockState.create.mock.calls[0];
    expect(char).toBe('大');
  });

  it('shows the plain character while the stroke data is loading', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(STROKE_DATA, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch;
    const { MagicCharGlyph } = await import('@/components/game/MagicCharGlyph');
    render(<MagicCharGlyph char="大" />);
    expect(screen.getByTestId('magic-glyph-fallback').textContent).toBe('大');
  });

  it('shows the plain character when there is no stroke data', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 })) as typeof fetch;
    const { MagicCharGlyph } = await import('@/components/game/MagicCharGlyph');
    render(<MagicCharGlyph char="䶮" />);
    await waitFor(() => {
      expect(screen.getByTestId('magic-glyph-fallback').textContent).toBe('䶮');
    });
  });

  it('shows the plain character when the writer fails', async () => {
    mockState.create.mockImplementation(() => {
      throw new Error('the writer could not start');
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(STROKE_DATA, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch;
    const { MagicCharGlyph } = await import('@/components/game/MagicCharGlyph');
    render(<MagicCharGlyph char="大" />);
    await waitFor(() => {
      expect(screen.getByTestId('magic-glyph-fallback').textContent).toBe('大');
    });
  });
});
