// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SutraAudioPlayer, type SutraAudioChunk } from '@/components/sutra/SutraAudioPlayer';

function getAudio(): HTMLAudioElement {
  const el = document.querySelector('audio');
  if (!el) throw new Error('audio element not found');
  return el as HTMLAudioElement;
}

function makeFetchMock(): ReturnType<typeof vi.fn> {
  // happy-dom does not implement URL.createObjectURL out of the box; stub it
  if (!('createObjectURL' in URL)) {
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:mock';
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
  }
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith('/api/tts') && init?.method === 'POST') {
      return new Response(new Blob(['x'], { type: 'audio/mpeg' }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

const singleChunk: SutraAudioChunk[] = [
  { id: 1, title: '大悲咒', text: '南无喝啰怛那哆啰夜耶' },
];
const playlist: SutraAudioChunk[] = [
  { id: 1, title: '大悲咒', text: '南无喝啰怛那哆啰夜耶。' },
  { id: 2, title: '心经',   text: '观自在菩萨。' },
  { id: 3, title: '药师咒', text: '南无薄伽伐帝。' },
];

describe('SutraAudioPlayer (TTS per chunk)', () => {
  beforeEach(() => {
    makeFetchMock();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders minimized by default with the expand button', () => {
    render(<SutraAudioPlayer chunks={singleChunk} />);
    expect(screen.getByRole('button', { name: '展开播放器' })).toBeInTheDocument();
    expect(document.querySelector('audio')).toBeInTheDocument();
  });

  it('does not set a static src on the audio element (TTS synthesizes on demand)', () => {
    render(<SutraAudioPlayer chunks={singleChunk} />);
    expect(getAudio().getAttribute('src')).toBeNull();
  });

  it('expands on click of the minimized button and shows the chunk title', () => {
    render(<SutraAudioPlayer chunks={singleChunk} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    expect(screen.getByText('大悲咒')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最小化播放器' })).toBeInTheDocument();
  });

  it('collapses back to minimized when minimize button is clicked', () => {
    render(<SutraAudioPlayer chunks={singleChunk} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    fireEvent.click(screen.getByRole('button', { name: '最小化播放器' }));
    expect(screen.getByRole('button', { name: '展开播放器' })).toBeInTheDocument();
  });

  it('does NOT render a progress / seek slider (TTS has no known duration)', () => {
    render(<SutraAudioPlayer chunks={singleChunk} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    expect(screen.queryByRole('slider', { name: '播放进度' })).toBeNull();
  });

  it('fetches POST /api/tts with { text, voice: "female" } when play is clicked', async () => {
    render(<SutraAudioPlayer chunks={singleChunk} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    fireEvent.click(screen.getByRole('button', { name: '播放' }));

    await waitFor(() => {
      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const ttsCall = calls.find((c) => {
      const url = typeof c[0] === 'string' ? c[0] : c[0] instanceof URL ? c[0].toString() : c[0].url;
      return url.endsWith('/api/tts');
    });
    expect(ttsCall).toBeTruthy();
    const init = ttsCall![1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.text).toBe('南无喝啰怛那哆啰夜耶');
    expect(body.voice).toBe('female');
  });

  it('cycles loop mode list → none → single → list without fetching', async () => {
    render(<SutraAudioPlayer chunks={singleChunk} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const loopBtn = screen.getByRole('button', { name: /循环模式/ });
    expect(loopBtn).toHaveTextContent('列表循环');
    const before = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(loopBtn);
    expect(loopBtn).toHaveTextContent('不循环');
    fireEvent.click(loopBtn);
    expect(loopBtn).toHaveTextContent('单曲循环');
    fireEvent.click(loopBtn);
    expect(loopBtn).toHaveTextContent('列表循环');
    const after = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(after).toBe(before);
  });

  it('sets audio.loop=true only when loop mode is single with a single chunk', () => {
    render(<SutraAudioPlayer chunks={singleChunk} />);
    const audio = getAudio();
    // default loopMode is 'list', chunks.length===1 → audio.loop=false (we advance via setTrackIndex)
    expect(audio.loop).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const loopBtn = screen.getByRole('button', { name: /循环模式/ });
    // list → none: still false
    fireEvent.click(loopBtn);
    expect(audio.loop).toBe(false);
    // none → single: becomes true
    fireEvent.click(loopBtn);
    expect(audio.loop).toBe(true);
    // single → list: back to false
    fireEvent.click(loopBtn);
    expect(audio.loop).toBe(false);
  });

  it('updates audio.volume when the volume slider changes', () => {
    render(<SutraAudioPlayer chunks={singleChunk} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const volume = screen.getByRole('slider', { name: '音量' });
    fireEvent.change(volume, { target: { value: '0.3' } });
    expect(getAudio().volume).toBeCloseTo(0.3);
  });

  it('advances to next chunk when ended fires in list mode (multi-chunk)', async () => {
    render(<SutraAudioPlayer chunks={playlist} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    fireEvent.click(screen.getByRole('button', { name: '播放' }));

    // Wait for first fetch
    await waitFor(() => {
      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => {
        const url = typeof c[0] === 'string' ? c[0] : c[0] instanceof URL ? c[0].toString() : c[0].url;
        return url.endsWith('/api/tts');
      });
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    const callsBefore = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    const audio = getAudio();
    act(() => {
      audio.dispatchEvent(new Event('ended'));
    });

    // After advancing, fetch should be called again for next chunk
    await waitFor(() => {
      const callsAfter = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });

    const allCalls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const ttsCalls = allCalls.filter((c) => {
      const url = typeof c[0] === 'string' ? c[0] : c[0] instanceof URL ? c[0].toString() : c[0].url;
      return url.endsWith('/api/tts');
    });
    // Second fetch should be for the second chunk text
    const bodies = ttsCalls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(bodies.some((b: { text: string }) => b.text === '观自在菩萨。')).toBe(true);
  });

  it('wraps to first chunk after last chunk ends in list mode', async () => {
    render(<SutraAudioPlayer chunks={playlist} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    fireEvent.click(screen.getByRole('button', { name: '下一曲' }));
    fireEvent.click(screen.getByRole('button', { name: '下一曲' }));
    expect(screen.getByText('3/3')).toBeInTheDocument();

    const audio = getAudio();
    act(() => {
      audio.dispatchEvent(new Event('ended'));
    });

    await waitFor(() => {
      expect(screen.getByText('1/3')).toBeInTheDocument();
    });
  });

  it('renders prev/next buttons only for multi-chunk playlists', () => {
    const { unmount } = render(<SutraAudioPlayer chunks={singleChunk} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    expect(screen.queryByRole('button', { name: '上一曲' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下一曲' })).toBeNull();
    unmount();
    render(<SutraAudioPlayer chunks={playlist} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    expect(screen.getByRole('button', { name: '上一曲' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一曲' })).toBeInTheDocument();
  });

  it('shows chunk position indicator 1/3 for multi-chunk', async () => {
    render(<SutraAudioPlayer chunks={playlist} playlistTitle="早课" />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    expect(screen.getByText('1/3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一曲' }));
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('shows playlist title above the current chunk for multi-chunk', () => {
    render(<SutraAudioPlayer chunks={playlist} playlistTitle="早课" />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    expect(screen.getByText('早课')).toBeInTheDocument();
    expect(screen.getByText('大悲咒')).toBeInTheDocument();
  });

  it('prev button wraps from first to last chunk', () => {
    render(<SutraAudioPlayer chunks={playlist} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    expect(screen.getByText('1/3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '上一曲' }));
    expect(screen.getByText('3/3')).toBeInTheDocument();
  });

  it('does not auto-advance when audio ends in single mode with a single chunk (native loop handles it)', () => {
    render(<SutraAudioPlayer chunks={singleChunk} />);
    fireEvent.click(screen.getByRole('button', { name: '展开播放器' }));
    const callsBefore = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const audio = getAudio();
    act(() => {
      audio.dispatchEvent(new Event('ended'));
    });
    const callsAfter = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfter).toBe(callsBefore);
  });
});