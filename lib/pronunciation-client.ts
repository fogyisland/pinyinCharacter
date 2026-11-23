/**
 * 跟读 —— browser side of pronunciation practice.
 *
 * ## Why the browser's Speech API, not a server call
 *
 * The request was 「用 Edge 的 Speech API」. Probing Microsoft's endpoints
 * settled which of the two things that name covers (see
 * `.tmp/probe-speech-api*.mjs`):
 *
 *   api.msedgeservices.com/tts/...  — the read-aloud host this site already
 *     uses. It is OUTPUT only: text in, audio out. Every recognition path on
 *     that host answered 404.
 *
 *   <region>.stt.speech.microsoft.com — Azure AI Speech. It exists (401
 *     without a key) and its Pronunciation Assessment would grade at phoneme
 *     level, but it needs a subscription and sends the learner's recording to
 *     a paid service.
 *
 * So recognition comes from the BROWSER's `SpeechRecognition` — which on Edge
 * IS Microsoft's speech service, reached through the browser with no key and
 * no billing on this site. The scoring is our own (`lib/pronunciation.ts`),
 * which runs locally and is honest about what it can and cannot judge.
 *
 * ## What this module does NOT do
 *
 * It does not send audio anywhere. The browser does its own thing with the
 * microphone; this site only receives the recognised TEXT. That is a privacy
 * property worth naming: the recording never reaches our server.
 */

/** The subset of `SpeechRecognition` this module uses. */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechResultEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

/** The constructors browsers expose under different names. */
interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike;
}

/** The window fields Chrome/Edge define. */
interface SpeechWindow {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
}

/** Why a recognition attempt produced nothing usable. */
export type SpeechFailure = 'unsupported' | 'not-allowed' | 'no-speech' | 'network' | 'unknown';

/** The result of one attempt. */
export type SpeechOutcome =
  | { ok: true; transcript: string }
  | { ok: false; reason: SpeechFailure };

/**
 * True when the browser can recognise speech at all.
 *
 * Firefox has no implementation; Safari calls it `webkitSpeechRecognition`
 * and supports it. The dictionary page hides the microphone when this is
 * false rather than showing a button that cannot work.
 */
export function isSpeechSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as SpeechWindow;
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

/** Map a browser error code onto something the learner can read. */
function toFailure(code: string): SpeechFailure {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'not-allowed';
    case 'no-speech':
      return 'no-speech';
    case 'network':
      return 'network';
    default:
      return 'unknown';
  }
}

/**
 * Record once and return the recognised text for Mandarin.
 *
 * `lang: 'zh-CN'` is what makes the recogniser score Mandarin syllables; with
 * any other language the transcript would be Latin letters and the
 * comparison would have nothing to compare.
 *
 * @param timeoutMs how long to listen before giving up. Default 8 seconds:
 *        a learner reading a two-character word finishes well inside it, and
 *        a longer window only records the room.
 * @returns the transcript, or a reason it failed.
 */
export function recogniseOnce(timeoutMs = 8000): Promise<SpeechOutcome> {
  if (!isSpeechSupported()) return Promise.resolve({ ok: false, reason: 'unsupported' });

  const w = window as unknown as SpeechWindow;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return Promise.resolve({ ok: false, reason: 'unsupported' });

  return new Promise<SpeechOutcome>((resolve) => {
    const recognition = new Ctor();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    let settled = false;
    const settle = (outcome: SpeechOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    // A recogniser that never fires `onend` (some Edge builds) would leave
    // the promise pending forever and the panel stuck on 「正在听…」.
    const timer = setTimeout(() => {
      recognition.abort();
      settle({ ok: false, reason: 'no-speech' });
    }, timeoutMs);

    recognition.onresult = (event) => {
      const transcript = String(event.results?.[0]?.[0]?.transcript ?? '').trim();
      if (transcript === '') {
        settle({ ok: false, reason: 'no-speech' });
        return;
      }
      settle({ ok: true, transcript });
    };
    recognition.onerror = (event) => settle({ ok: false, reason: toFailure(event.error) });
    recognition.onend = () => settle({ ok: false, reason: 'no-speech' });

    try {
      recognition.start();
    } catch (error) {
      // `start()` throws when a previous recognition is still running.
      console.warn('[pronunciation] could not start recognition', error);
      settle({ ok: false, reason: 'unknown' });
    }
  });
}

/**
 * The Chinese characters in a transcript.
 *
 * The recogniser returns punctuation and possibly Latin letters; only the
 * ideographs are compared. Extension A is included because the dictionary
 * itself serves those characters.
 *
 * @param transcript what the recogniser heard.
 */
export function hanziOf(transcript: string): string[] {
  const out: string[] = [];
  for (const char of Array.from(transcript)) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) {
      out.push(char);
    }
  }
  return out;
}

/** A message per failure, written for a learner rather than a developer. */
export const FAILURE_MESSAGES: Record<SpeechFailure, string> = {
  unsupported: '这个浏览器不支持语音识别。请用 Edge 或 Chrome 打开本页。',
  'not-allowed': '需要麦克风权限。请在地址栏的权限设置里允许麦克风，然后重试。',
  'no-speech': '没有听到声音。请靠近麦克风，读得慢一点。',
  network: '语音识别服务连接不上。请检查网络后重试。',
  unknown: '这次没能识别。请再读一遍。',
};
