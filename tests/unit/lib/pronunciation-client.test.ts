// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  FAILURE_MESSAGES,
  hanziOf,
  isSpeechSupported,
  recogniseOnce,
} from '@/lib/pronunciation-client';

/**
 * 浏览器侧的语音识别。
 *
 * 这一层不加分、不比字 —— 它只负责「拿到识别出来的那段文字」。所以测试
 * 不需要麦克风：给 window 装一个假的 SpeechRecognition，看它被怎么调、
 * 以及在各种失败下是否会永远等下去。
 *
 * 最要紧的一条：**永远不会挂住**。一个不 fire `onend` 的识别器会把面板
 * 卡在「正在听…」，学生只能刷新页面。
 */

interface FakeRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

/** Install a fake recogniser and return a handle to drive it. */
function installFakeRecognition(): {
  instance: FakeRecognition;
  emitResult: (text: string) => void;
  emitError: (code: string) => void;
  emitEnd: () => void;
} {
  const instance: FakeRecognition = {
    lang: '',
    interimResults: false,
    continuous: true,
    maxAlternatives: 3,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    onresult: null,
    onerror: null,
    onend: null,
  };

  function FakeCtor(this: unknown): FakeRecognition {
    return instance;
  }
  Object.defineProperty(window, 'SpeechRecognition', {
    configurable: true,
    value: FakeCtor,
  });

  return {
    instance,
    emitResult: (text: string) => {
      instance.onresult?.({ results: [[{ transcript: text }]] });
    },
    emitError: (code: string) => instance.onerror?.({ error: code }),
    emitEnd: () => instance.onend?.(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  // @ts-expect-error -- removing the fake between cases
  delete window.SpeechRecognition;
});

describe('isSpeechSupported', () => {
  it('is false when the browser has no recogniser', () => {
    expect(isSpeechSupported()).toBe(false);
  });

  it('is true once a recogniser exists, under either name', () => {
    installFakeRecognition();
    expect(isSpeechSupported()).toBe(true);
  });

  it('accepts the webkit-prefixed constructor Safari exposes', () => {
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      configurable: true,
      value: function Fake() {} as unknown,
    });
    expect(isSpeechSupported()).toBe(true);
    // @ts-expect-error -- removing the fake between cases
    delete window.webkitSpeechRecognition;
  });
});

describe('recogniseOnce', () => {
  it('configures the recogniser for Mandarin before starting', () => {
    const fake = installFakeRecognition();
    void recogniseOnce(1000);
    expect(fake.instance.lang).toBe('zh-CN');
    expect(fake.instance.interimResults).toBe(false);
    expect(fake.instance.start).toHaveBeenCalled();
  });

  it('resolves with the transcript', async () => {
    const fake = installFakeRecognition();
    const promise = recogniseOnce(1000);
    fake.emitResult('学生');
    await expect(promise).resolves.toEqual({ ok: true, transcript: '学生' });
  });

  it('trims the transcript the recogniser pads with spaces', async () => {
    const fake = installFakeRecognition();
    const promise = recogniseOnce(1000);
    fake.emitResult('  学生  ');
    await expect(promise).resolves.toEqual({ ok: true, transcript: '学生' });
  });

  it('maps a permission refusal to not-allowed', async () => {
    const fake = installFakeRecognition();
    const promise = recogniseOnce(1000);
    fake.emitError('not-allowed');
    await expect(promise).resolves.toEqual({ ok: false, reason: 'not-allowed' });
  });

  it('maps a silent microphone to no-speech', async () => {
    const fake = installFakeRecognition();
    const promise = recogniseOnce(1000);
    fake.emitError('no-speech');
    await expect(promise).resolves.toEqual({ ok: false, reason: 'no-speech' });
  });

  it('maps a broken service to network', async () => {
    const fake = installFakeRecognition();
    const promise = recogniseOnce(1000);
    fake.emitError('network');
    await expect(promise).resolves.toEqual({ ok: false, reason: 'network' });
  });

  it('gives up instead of hanging when the recogniser never ends', async () => {
    // Some Edge builds fire neither onresult nor onend. Without the timer
    // the panel would sit on 「正在听…」 forever.
    vi.useFakeTimers();
    const fake = installFakeRecognition();
    const promise = recogniseOnce(500);
    await vi.advanceTimersByTimeAsync(600);
    await expect(promise).resolves.toEqual({ ok: false, reason: 'no-speech' });
    expect(fake.instance.abort).toHaveBeenCalled();
  });

  it('settles once even when the recogniser reports twice', async () => {
    const fake = installFakeRecognition();
    const promise = recogniseOnce(1000);
    fake.emitResult('学生');
    fake.emitError('network');
    await expect(promise).resolves.toEqual({ ok: true, transcript: '学生' });
  });

  it('reports unsupported when there is no recogniser at all', async () => {
    await expect(recogniseOnce(1000)).resolves.toEqual({ ok: false, reason: 'unsupported' });
  });

  it('treats an empty transcript as no speech', async () => {
    const fake = installFakeRecognition();
    const promise = recogniseOnce(1000);
    fake.emitResult('   ');
    await expect(promise).resolves.toEqual({ ok: false, reason: 'no-speech' });
  });
});

describe('hanziOf', () => {
  it('keeps the ideographs and drops punctuation and latin letters', () => {
    expect(hanziOf('学生。ok!')).toEqual(['学', '生']);
  });

  it('keeps extension-A characters the dictionary serves', () => {
    expect(hanziOf('㐀学')).toEqual(['㐀', '学']);
  });

  it('returns an empty list for text with no ideographs', () => {
    expect(hanziOf('nothing here')).toEqual([]);
  });
});

describe('FAILURE_MESSAGES', () => {
  it('has a readable message for every failure', () => {
    // Every failure must say what to DO, not just that something broke.
    for (const message of Object.values(FAILURE_MESSAGES)) {
      expect(message.length).toBeGreaterThan(10);
    }
    expect(FAILURE_MESSAGES['not-allowed']).toContain('麦克风');
    expect(FAILURE_MESSAGES.unsupported).toContain('Edge');
  });
});
