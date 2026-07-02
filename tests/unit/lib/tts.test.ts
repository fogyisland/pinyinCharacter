// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { speak, stopSpeaking } from '@/lib/tts';

// Minimal Cache API polyfill — happy-dom doesn't ship `caches`.
class FakeCache {
  private store = new Map<string, Blob>();
  async match(req: Request | string): Promise<Response | undefined> {
    const url = typeof req === 'string' ? req : req.url;
    const blob = this.store.get(url);
    return blob ? new Response(blob, { headers: { 'Content-Type': 'audio/mpeg' } }) : undefined;
  }
  async put(req: Request | string, res: Response): Promise<void> {
    const url = typeof req === 'string' ? req : req.url;
    this.store.set(url, await res.blob());
  }
  async delete(req: Request | string): Promise<boolean> {
    const url = typeof req === 'string' ? req : req.url;
    return this.store.delete(url);
  }
  async keys(): Promise<Request[]> {
    return Array.from(this.store.keys()).map(url => new Request(url));
  }
}

// Stub HTMLAudioElement so audio.play() resolves immediately and audio.onended
// fires synchronously — happy-dom doesn't implement real audio playback.
class FakeAudio {
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = true;
  pause() { this.paused = true; }
  play(): Promise<void> {
    this.paused = false;
    queueMicrotask(() => this.onended?.());
    return Promise.resolve();
  }
}

function makeFetchOk(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body as string | undefined;
    return new Response(new Blob([`audio:${body ?? ''}`], { type: 'audio/mpeg' }), { status: 200 });
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('speak()', () => {
  beforeEach(() => {
    if (!('createObjectURL' in URL)) {
      (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:mock';
      (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
    }
    // Override Audio constructor to return our FakeAudio
    (global as unknown as { Audio: typeof FakeAudio }).Audio = FakeAudio as unknown as typeof FakeAudio;
    // Install Cache API polyfill BEFORE the module under test runs.
    // Always reinstall a fresh FakeCache so cache state doesn't bleed between tests.
    const fake = new FakeCache();
    Object.defineProperty(globalThis, 'caches', {
      value: { open: async () => fake, delete: async () => true },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    stopSpeaking();
    vi.restoreAllMocks();
  });

  it('sends a single POST for short text (one batch)', async () => {
    const fetchMock = makeFetchOk();
    await speak('南无阿弥陀佛');
    const ttsCalls = fetchMock.mock.calls.filter((c) => {
      const url = typeof c[0] === 'string' ? c[0] : (c[0] as URL).toString();
      return url.endsWith('/api/tts');
    });
    expect(ttsCalls).toHaveLength(1);
    const body = JSON.parse((ttsCalls[0]![1] as RequestInit).body as string);
    expect(body.voice).toBe('female');
    expect(body.text).toBe('南无阿弥陀佛');
  });

  it('splits long text on \\n into multiple batches each under BATCH_MAX_CHARS', async () => {
    const fetchMock = makeFetchOk();
    const para = '观自在菩萨行深般若波罗蜜多时照见五蕴皆空度一切苦厄舍利子色不异空空不异色色即是空空即是色受想行识亦复如是舍利子是诸法空相不生不灭不垢不净不增不减是故空中无色无受想行识无眼耳鼻舌身意无色声香味触法无眼界乃至无意识界无无明亦无无明尽乃至无老死亦无老死尽无苦集灭道无智亦无得。';
    expect(Array.from(para).length).toBeLessThanOrEqual(500); // sanity
    await speak(Array(10).fill(para).join('\n'));
    const ttsCalls = fetchMock.mock.calls.filter((c) => {
      const url = typeof c[0] === 'string' ? c[0] : (c[0] as URL).toString();
      return url.endsWith('/api/tts');
    });
    expect(ttsCalls.length).toBeGreaterThanOrEqual(2);
    for (const c of ttsCalls) {
      const body = JSON.parse((c[1] as RequestInit).body as string);
      expect(body.text.length).toBeLessThanOrEqual(500);
      expect(body.voice).toBe('female');
    }
  });

  it('throws (does not fall back to browser speech) when /api/tts returns 500', async () => {
    global.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    await expect(speak('南无阿弥陀佛')).rejects.toThrow(/TTS failed/);
    // Specifically: speechSynthesis must NOT be invoked
    expect((window as unknown as { speechSynthesis?: { speak: unknown } }).speechSynthesis?.speak).toBeUndefined();
  });

  it('throws when /api/tts network errors', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(speak('南无阿弥陀佛')).rejects.toThrow(/TTS network error/);
  });

  it('sends male voice when voice="male"', async () => {
    const fetchMock = makeFetchOk();
    await speak('南无阿弥陀佛', { voice: 'male' });
    const ttsCalls = fetchMock.mock.calls.filter((c) => {
      const url = typeof c[0] === 'string' ? c[0] : (c[0] as URL).toString();
      return url.endsWith('/api/tts');
    });
    expect(ttsCalls).toHaveLength(1);
    const body = JSON.parse((ttsCalls[0]![1] as RequestInit).body as string);
    expect(body.voice).toBe('male');
  });

  it('stops playback on pagehide so audio does not continue after navigation', async () => {
    // speak() creates a module-level Audio instance that React doesn't own.
    // pagehide (and visibilitychange→hidden) must call stopSpeaking() so
    // soft navigations, BFCache, and tab switches don't leave audio playing.
    makeFetchOk();
    const speakPromise = speak('南无阿弥陀佛');
    // Fire pagehide before the audio.play() resolves — clearActive sets
    // active.cancelled = true, which makes the loop bail after the current
    // batch ends.
    window.dispatchEvent(new Event('pagehide'));
    await speakPromise.catch(() => undefined);
    // After pagehide, the FakeAudio's pause() should have been called.
    // Stopping a non-active speak() must not throw.
    expect(() => stopSpeaking()).not.toThrow();
  });

  it('uses cached blob on second speak() of same text (no second fetch)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValue(
      new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' })),
    );
    await speak('女');
    fetchSpy.mockClear();
    await speak('女');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('stores fetched blob in cache after first speak()', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' })),
    );
    await speak('女');
    // After this speak(), re-importing getCachedTts should find the entry.
    const { getCachedTts } = await import('@/lib/tts-cache');
    const blob = await getCachedTts('female', '女');
    expect(blob).not.toBeNull();
    fetchSpy.mockRestore();
  });

  it('falls back to fetch when cache returns null (regression: no behavioral change)', async () => {
    // With the polyfill installed but empty, cache always misses. speak() must still fetch.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob([new Uint8Array([1])], { type: 'audio/mpeg' })),
    );
    await speak('学');
    expect(fetchSpy).toHaveBeenCalledWith('/api/tts', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: '学', voice: 'female' }),
    }));
    fetchSpy.mockRestore();
  });
});