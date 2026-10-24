// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

/**
 * Regression tests for the live stroke demo on the home page.
 *
 * hanzi-writer calls `charDataLoader(char, onLoad, onError)` — the first
 * argument is the character, not a callback. The component used to treat it
 * as a callback and call it with the stroke data, which threw and left the
 * hero without its animation (the plain character was shown instead).
 */
const createMock = vi.fn();
const loopMock = vi.fn(() => Promise.resolve());
const pauseMock = vi.fn(() => Promise.resolve());

vi.mock('hanzi-writer', () => ({
  default: {
    create: (...args: unknown[]) => createMock(...args),
  },
}));

import { LiveStrokeDemo } from '@/components/LiveStrokeDemo';

const STROKE_DATA = { strokes: [['M0 0 L10 10']], medians: [[[0, 0], [10, 10]]] };

beforeEach(() => {
  // mockClear (not mockReset): the writer's methods must keep returning a
  // promise — the component chains a .catch() on them.
  createMock.mockClear();
  loopMock.mockClear();
  pauseMock.mockClear();
  createMock.mockImplementation(() => ({
    loopCharacterAnimation: loopMock,
    pauseAnimation: pauseMock,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => STROKE_DATA,
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LiveStrokeDemo', () => {
  it('hands the fetched stroke data to hanzi-writer through onLoad', async () => {
    render(<LiveStrokeDemo char="韵" size={100} />);
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));

    const [, char, options] = createMock.mock.calls[0] as [
      HTMLElement,
      string,
      { charDataLoader: (char: string, onLoad: (data: unknown) => void) => void },
    ];
    expect(char).toBe('韵');

    const onLoad = vi.fn();
    options.charDataLoader('韵', onLoad);
    expect(onLoad).toHaveBeenCalledWith(STROKE_DATA);
  });

  it('starts the animation once the writer exists', async () => {
    render(<LiveStrokeDemo char="韵" size={100} />);
    await waitFor(() => expect(loopMock).toHaveBeenCalledTimes(1));
  });

  it('keeps the animated view instead of falling back to the plain character', async () => {
    render(<LiveStrokeDemo char="韵" size={100} />);
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    // The fallback renders the character with an aria-label; the animated
    // view marks its svg as aria-hidden.
    expect(screen.queryByLabelText('韵')).toBeNull();
  });

  it('pauses the animation when the component unmounts', async () => {
    const { unmount } = render(<LiveStrokeDemo char="韵" size={100} />);
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    unmount();
    await waitFor(() => expect(pauseMock).toHaveBeenCalled());
  });
});
