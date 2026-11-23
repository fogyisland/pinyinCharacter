// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 录音器 —— 把麦克风的声音变成 Azure 能吃的 16 kHz 单声道 WAV。
 *
 * ## 为什么要自己编码
 *
 * `MediaRecorder` 在 Chrome/Edge 上产出的是 WebM/Opus，而 Azure 的短音频
 * 接口只收 WAV/PCM。所以这里用 Web Audio 的 `AudioContext` 拿到 PCM，
 * 降采样到 16 kHz，再写成 WAV。
 *
 * ## 测试怎么不碰麦克风
 *
 * `AudioContext` 与 `navigator.mediaDevices` 都是假的：测试喂进一段已知的
 * PCM，断言 WAV 的头字段与采样率降得对。真实麦克风由真机走查覆盖 ——
 * 无头 Chrome 没有麦克风，这正是它测不到的部分。
 */

const { getUserMediaMock } = vi.hoisted(() => ({ getUserMediaMock: vi.fn() }));

beforeEach(() => {
  getUserMediaMock.mockReset();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: getUserMediaMock },
  });
});

afterEach(() => {
  vi.useRealTimers();
  // @ts-expect-error -- removing the fake between cases
  delete window.AudioContext;
});

import { encodeWav, downsample, isRecordingSupported, recordOnce } from '@/lib/pronunciation-recorder';

describe('downsample', () => {
  it('averages each output sample over its window', () => {
    // 48 kHz → 16 kHz is exactly 3:1; each output sample is the mean of three.
    const input = new Float32Array([1, 1, 1, 3, 3, 3, 0, 0, 0]);
    const output = downsample(input, 48000, 16000);
    expect(output.length).toBe(3);
    expect(output[0]).toBeCloseTo(1, 5);
    expect(output[1]).toBeCloseTo(3, 5);
    expect(output[2]).toBeCloseTo(0, 5);
  });

  it('keeps the input when the rates already match', () => {
    const input = new Float32Array([0.5, -0.5]);
    expect(downsample(input, 16000, 16000)).toEqual(input);
  });

  it('returns an empty array for empty input', () => {
    expect(downsample(new Float32Array([]), 48000, 16000)).toEqual(new Float32Array([]));
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit mono 16 kHz WAV header', () => {
    const pcm = new Float32Array([0, 0.5, -0.5]);
    const wav = encodeWav(pcm, 16000);
    // "RIFF" .... "WAVE"
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE');
    // fmt chunk: PCM(1), mono(1), sample rate 16000, 16 bits
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    // 3 samples × 2 bytes + 44-byte header
    expect(wav.byteLength).toBe(44 + 6);
  });

  it('clips samples outside [-1, 1] instead of wrapping them', () => {
    // A wrapped overshoot would be a loud click in the middle of a word.
    const loud = encodeWav(new Float32Array([2, -2]), 16000);
    const view = new DataView(loud.buffer, loud.byteOffset, loud.byteLength);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
});

describe('isRecordingSupported', () => {
  it('is false without mediaDevices', () => {
    // @ts-expect-error -- the property is being removed deliberately
    delete navigator.mediaDevices;
    expect(isRecordingSupported()).toBe(false);
  });

  it('needs both the microphone and the audio context', () => {
    expect(isRecordingSupported()).toBe(false);
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: function Fake() {} as unknown,
    });
    expect(isRecordingSupported()).toBe(true);
  });
});

describe('recordOnce', () => {
  it('reports a microphone refusal without throwing', async () => {
    // A refusal is only reachable when recording IS supported: without an
    // AudioContext the module answers 'unsupported' before asking for the
    // microphone at all.
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: function Fake() {} as unknown,
    });
    getUserMediaMock.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const result = await recordOnce(1000);
    expect(result).toEqual({ ok: false, reason: 'not-allowed' });
  });

  it('reports unsupported when the browser cannot record', async () => {
    const result = await recordOnce(1000);
    expect(result).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('reports a missing microphone as unsupported as well', async () => {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: function Fake() {} as unknown,
    });
    getUserMediaMock.mockRejectedValue(Object.assign(new Error('none'), { name: 'NotFoundError' }));
    const result = await recordOnce(1000);
    expect(result).toEqual({ ok: false, reason: 'unsupported' });
  });
});
