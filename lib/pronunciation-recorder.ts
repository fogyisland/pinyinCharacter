/**
 * 录音器 —— the browser side of the Azure path.
 *
 * ## Why hand-rolled and not `MediaRecorder`
 *
 * Azure's short-audio endpoint takes WAV/PCM. `MediaRecorder` in Chrome and
 * Edge produces WebM/Opus, so its output would be refused. The browser can
 * still hand us raw PCM through the Web Audio API, and the two conversions it
 * needs are mine: mix down to mono, resample to 16 kHz, and write a WAV.
 *
 * ## The privacy line
 *
 * This records locally and hands the bytes to the caller, which posts them to
 * OUR server (`/api/speech/assess`). The recording reaches Azure from the
 * server, never from the browser, and only when the operator configured a
 * key. With no key the panel never calls this at all — it uses the browser's
 * own recognition instead.
 */

/** Why recording produced nothing usable. */
export type RecordFailure = 'unsupported' | 'not-allowed' | 'no-audio';

/** The outcome of one recording. */
export type RecordResult = { ok: true; wav: ArrayBuffer } | { ok: false; reason: RecordFailure };

/** The sample rate Azure's short-audio endpoint expects. */
const TARGET_RATE = 16000;

/** Bytes per sample in a 16-bit WAV. */
const BYTES_PER_SAMPLE = 2;

/** The WAV header is 44 bytes. */
const WAV_HEADER_BYTES = 44;

/** The window fields browsers define. */
interface RecordingWindow {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

/**
 * True when this browser can record at all.
 *
 * Both pieces are required: the microphone (`mediaDevices`) and the audio
 * graph (`AudioContext`).
 */
export function isRecordingSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return false;
  }
  const w = window as unknown as RecordingWindow;
  return Boolean(w.AudioContext ?? w.webkitAudioContext);
}

/**
 * Average the input down to the target rate.
 *
 * Averaging rather than picking one sample in three: decimation without a
 * filter aliases background noise down into the speech band, and Azure scores
 * the noise as part of the word.
 *
 * @param input the recorded samples.
 * @param inputRate the rate they were recorded at.
 * @param targetRate the rate wanted; 16 kHz by default.
 */
export function downsample(input: Float32Array, inputRate: number, targetRate = TARGET_RATE): Float32Array {
  if (targetRate >= inputRate) return input;
  const ratio = inputRate / targetRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

/**
 * Write a 16-bit mono WAV around the samples.
 *
 * Samples are clipped to [-1, 1] rather than wrapped: a wrapped overshoot is
 * a loud click in the middle of the word, and Azure would score it.
 *
 * @param samples mono PCM in [-1, 1].
 * @param sampleRate the rate those samples are at.
 * @returns the WAV bytes, ready to POST.
 */
export function encodeWav(samples: Float32Array, sampleRate = TARGET_RATE): Uint8Array {
  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataBytes, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"

  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true); // byte rate
  view.setUint16(32, BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataBytes, true);
  let offset = WAV_HEADER_BYTES;
  for (const sample of samples) {
    const clipped = Math.max(-1, Math.min(1, sample));
    // 16-bit signed: 1.0 → 32767, -1.0 → -32768.
    view.setInt16(offset, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
    offset += BYTES_PER_SAMPLE;
  }
  return new Uint8Array(buffer);
}

/**
 * Record once and return the WAV.
 *
 * @param timeoutMs how long to listen for the word. Default 3 seconds: a
 *        two-syllable word takes about one, and a longer window only picks
 *        up the room and scores it.
 */
export async function recordOnce(timeoutMs = 3000): Promise<RecordResult> {
  if (!isRecordingSupported()) return { ok: false, reason: 'unsupported' };

  const w = window as unknown as RecordingWindow;
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return { ok: false, reason: 'unsupported' };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (error) {
    const name = (error as { name?: string }).name ?? '';
    // A refused permission is something the learner can fix; a missing
    // device is not.
    const reason: RecordFailure = name === 'NotAllowedError' ? 'not-allowed' : 'unsupported';
    console.warn('[pronunciation] could not open the microphone', name || error);
    return { ok: false, reason };
  }

  const context = new Ctor();
  try {
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    // 1 channel: Azure's short-audio endpoint takes mono, and a stereo
    // recording would be interleaved wrongly if it were treated as mono.
    const processor = context.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    processor.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    // A ScriptProcessor only runs while it is connected to the destination;
    // a zero-gain node keeps it running without echoing the microphone.
    const silence = context.createGain();
    silence.gain.value = 0;
    source.connect(processor);
    processor.connect(silence);
    silence.connect(context.destination);

    await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));

    source.disconnect();
    processor.disconnect();
    silence.disconnect();

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (total === 0) {
      // No frames at all: the microphone opened but delivered nothing.
      return { ok: false, reason: 'no-audio' };
    }
    const samples = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    const mono = downsample(samples, context.sampleRate, TARGET_RATE);
    const wav = encodeWav(mono, TARGET_RATE);
    return { ok: true, wav: wav.buffer as ArrayBuffer };
  } catch (error) {
    console.error('[pronunciation] recording failed', error);
    return { ok: false, reason: 'unsupported' };
  } finally {
    // The microphone light must go off, and the graph must be released.
    for (const track of stream.getTracks()) track.stop();
    await context.close().catch(() => undefined);
  }
}

/** A message per failure, written for a learner. */
export const RECORD_FAILURE_MESSAGES: Record<RecordFailure, string> = {
  unsupported: '这个浏览器录不了音。请用 Edge 或 Chrome 打开本页。',
  'not-allowed': '需要麦克风权限。请在地址栏的权限设置里允许麦克风，然后重试。',
  'no-audio': '麦克风没有收到声音。请靠近一点，读得慢一点。',
};
