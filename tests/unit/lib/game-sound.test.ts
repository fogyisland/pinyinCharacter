import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SOUND_KEY } from '@/lib/game-sound';

/**
 * The sound cues run on the Web Audio API. The node environment has no
 * AudioContext at all, which is exactly the "unsupported browser" case the
 * module has to survive, so the no-op assertions below are literal here.
 *
 * The stub context lets the scheduling be asserted without a real browser.
 */
interface StorageShim {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
  readonly length: number;
}

class StubAudioParam {
  value = 0;

  setValueAtTime(value: number): StubAudioParam {
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number): StubAudioParam {
    this.value = value;
    return this;
  }

  exponentialRampToValueAtTime(value: number): StubAudioParam {
    this.value = value;
    return this;
  }
}

class StubNode {
  connect(): StubNode {
    return this;
  }
}

class StubOscillator extends StubNode {
  type = 'sine';
  frequency = new StubAudioParam();
  started = false;

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.started = false;
  }
}

class StubGain extends StubNode {
  gain = new StubAudioParam();
}

class StubFilter extends StubNode {
  type = 'lowpass';
  frequency = new StubAudioParam();
  Q = new StubAudioParam();
}

class StubBuffer {
  private readonly channel: Float32Array;

  constructor(length: number) {
    this.channel = new Float32Array(length);
  }

  getChannelData(): Float32Array {
    return this.channel;
  }
}

class StubBufferSource extends StubNode {
  buffer: StubBuffer | null = null;
}

class StubAudioContext {
  static instances: StubAudioContext[] = [];

  currentTime = 0;
  state = 'running';
  sampleRate = 44100;
  destination = new StubNode();
  oscillators: StubOscillator[] = [];

  constructor() {
    StubAudioContext.instances.push(this);
  }

  createOscillator(): StubOscillator {
    const oscillator = new StubOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain(): StubGain {
    return new StubGain();
  }

  createBiquadFilter(): StubFilter {
    return new StubFilter();
  }

  createBuffer(_channels: number, length: number): StubBuffer {
    return new StubBuffer(length);
  }

  createBufferSource(): StubBufferSource {
    return new StubBufferSource();
  }

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
}

function installStorageShim(): void {
  const store = new Map<string, string>();
  const shim: StorageShim = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: shim });
}

/** A fresh module per test, so the lazily created context never leaks. */
async function loadSoundModule() {
  vi.resetModules();
  return import('@/lib/game-sound');
}

beforeEach(() => {
  installStorageShim();
  StubAudioContext.instances = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('game-sound', () => {
  it('reads the mute flag from the stored key', async () => {
    const { isSoundMuted } = await loadSoundModule();

    globalThis.localStorage.setItem(SOUND_KEY, '1');

    expect(isSoundMuted()).toBe(true);
  });

  it('writes the mute flag and reads it back', async () => {
    const { isSoundMuted, setSoundMuted } = await loadSoundModule();

    setSoundMuted(true);

    expect(globalThis.localStorage.getItem(SOUND_KEY)).toBe('1');
    expect(isSoundMuted()).toBe(true);

    setSoundMuted(false);

    expect(globalThis.localStorage.getItem(SOUND_KEY)).toBe('0');
    expect(isSoundMuted()).toBe(false);
  });

  it('never throws when there is no AudioContext', async () => {
    const { playChime, playThud, playFanfare, playStamp } = await loadSoundModule();
    vi.stubGlobal('AudioContext', undefined);

    expect(() => playChime()).not.toThrow();
    expect(() => playThud()).not.toThrow();
    expect(() => playFanfare()).not.toThrow();
    expect(() => playStamp()).not.toThrow();
  });

  it('schedules an oscillator when a context is available', async () => {
    const { playChime } = await loadSoundModule();
    vi.stubGlobal('AudioContext', StubAudioContext);

    playChime();

    expect(StubAudioContext.instances.length).toBe(1);
    expect(StubAudioContext.instances[0].oscillators.length).toBeGreaterThanOrEqual(1);
  });

  it('plays nothing while the sound is muted', async () => {
    const { playChime, setSoundMuted } = await loadSoundModule();
    vi.stubGlobal('AudioContext', StubAudioContext);
    setSoundMuted(true);

    playChime();

    expect(StubAudioContext.instances.length).toBe(0);
  });
});
