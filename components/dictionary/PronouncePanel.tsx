'use client';

import { useCallback, useEffect, useState } from 'react';
import { ReadAloudButton } from '@/components/ReadAloudButton';
import { textToPinyin } from '@/lib/pinyin-client';
import {
  FAILURE_MESSAGES,
  hanziOf,
  isSpeechSupported,
  recogniseOnce,
} from '@/lib/pronunciation-client';
import {
  bestAlignment,
  compareReadings,
  type Advice,
  type CharReading,
  type Comparison,
} from '@/lib/pronunciation';

/**
 * 跟读 —— read the word back and see how it compared.
 *
 * The panel ties three things together: the browser's recognition (listen),
 * our own comparison (`lib/pronunciation`), and the model reading (listen
 * again). No audio reaches the server: the browser recognises on its own and
 * this site only receives the TEXT.
 *
 * The feedback is deliberately specific. 「读错了」 teaches nothing; 「第二个
 * 字声调不对」 tells the learner which sound to fix. That is why every
 * character carries its own verdict and the panel names the failing ones.
 */
export interface PronouncePanelProps {
  /** The word being practised. */
  word: string;
  /** Its reading, for the model button. */
  pinyin: string;
  /** The word's characters and readings, for the comparison. */
  chars: CharReading[];
}

/** What the panel is doing. */
type Phase = 'idle' | 'listening' | 'result';

/** A finished attempt. */
interface Attempt {
  /** What the recogniser heard, as ideographs. */
  heard: string[];
  /** The comparison of the best window. */
  comparison: Comparison;
  /** Where the window started in `heard`. */
  offset: number;
}

/** Advice → the sentence the learner reads. */
const ADVICE_TEXT: Record<Advice, string> = {
  perfect: '读对了，就是这个音。',
  tones: '声调不对 —— 再听一遍范读，注意那个字的调。',
  sounds: '这个字读得不像 —— 再听一遍范读，跟着读。',
  nothing: '没有听到声音，请靠近麦克风再读一遍。',
};

/**
 * The 跟读 panel.
 *
 * @param props the word, its reading and its characters.
 */
export function PronouncePanel({ word, pinyin, chars }: PronouncePanelProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  // After the first attempt the button says 「再读一遍」 rather than
  // 「点一下开始」: the learner has already understood what the button does,
  // and a failure should lead straight back into another try.
  const [hasTried, setHasTried] = useState(false);
  /**
   * Whether this browser can listen.
   *
   * `null` until the effect below runs. It MUST start as null: the server has
   * no `window`, so a `useState(() => isSpeechSupported())` renders the
   * "unsupported" branch on the server and the "button" branch on the
   * client — a hydration mismatch that React repairs by throwing away the
   * tree. Starting from null means both sides render the same placeholder,
   * and the probe happens after mount where it belongs.
   */
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(isSpeechSupported());
  }, []);

  const listen = useCallback(async () => {
    setPhase('listening');
    setError(null);
    setAttempt(null);
    setHasTried(true);
    const outcome = await recogniseOnce();
    if (!outcome.ok) {
      setPhase('idle');
      setError(FAILURE_MESSAGES[outcome.reason]);
      return;
    }
    const heard = hanziOf(outcome.transcript);
    if (heard.length === 0) {
      // The recogniser returned punctuation only — nothing to compare.
      setPhase('idle');
      setError(FAILURE_MESSAGES['no-speech']);
      return;
    }
    // The recogniser returns characters without readings, but the comparison
    // needs the syllables: 「学生」 heard as 「雪生」 is a tone mistake only
    // if 雪's reading is known. pinyin-pro supplies it, lazily (the same
    // dictionary the pinyin tool already loads).
    const tokens = await textToPinyin(heard.join('')).catch((failure: unknown) => {
      console.warn('[pronounce] could not read the recognised characters', failure);
      return null;
    });
    const spoken: CharReading[] = heard.map((char, index) => ({
      char,
      // Without readings the comparison falls back to comparing characters;
      // an empty pinyin is exactly the "cannot judge the tone" signal.
      pinyin: tokens?.[index]?.readings[0] ?? '',
    }));
    // A window of the larger sentence, so 「我是学生」 still scores 学生.
    const alignment = bestAlignment(chars, spoken);
    const comparison = alignment?.comparison ?? compareReadings(chars, spoken);
    setAttempt({ heard, comparison, offset: alignment?.offset ?? 0 });
    setPhase('result');
  }, [chars]);

  if (chars.length === 0) return null;

  return (
    <section className="mt-6 rounded border border-ink/15 bg-paper-soft p-4" data-pronounce>
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm text-ink-soft">跟读</h3>
        <span className="font-kai text-lg text-ink">{word}</span>
        <span className="text-xs text-ink-faint">{pinyin}</span>
        <ReadAloudButton text={word} label="听范读" size="sm" variant="paper" />
      </div>

      {/* `supported === null` renders NOTHING: the server cannot answer the
          question, so a placeholder keeps both sides identical until the
          probe has run on the client. */}
      {supported === false ? (
        <p className="mt-3 text-xs text-ink-faint">{FAILURE_MESSAGES.unsupported}</p>
      ) : supported === true ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void listen()}
            disabled={phase === 'listening'}
            className="rounded bg-seal px-3 py-1.5 text-sm text-white hover:bg-seal/80 disabled:bg-ink/20"
          >
            {phase === 'listening' ? '正在听…' : hasTried ? '再读一遍' : '跟读（点一下开始）'}
          </button>
          {phase === 'listening' ? (
            <span className="text-xs text-ink-faint">请读完整个词，然后等一下。</span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 rounded bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      ) : null}

      {attempt ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span data-testid="pronounce-score" className="font-medium text-ink">
              {attempt.comparison.score} 分
            </span>
            <span data-testid="pronounce-advice" className="text-ink-soft">
              {ADVICE_TEXT[attempt.comparison.advice]}
            </span>
          </div>

          {/* One mark per target character, so the learner sees WHICH one
              failed instead of only how many. */}
          <ul className="flex flex-wrap gap-2">
            {chars.map((entry, index) => (
              <li
                key={`${entry.char}-${index}`}
                data-testid="pronounce-char-mark"
                data-verdict={attempt.comparison.verdicts[index]}
                className={
                  'rounded px-2 py-0.5 text-sm ' +
                  (attempt.comparison.verdicts[index] === 'exact'
                    ? 'bg-emerald-50 text-emerald-800'
                    : attempt.comparison.verdicts[index] === 'tone'
                      ? 'bg-amber-50 text-amber-800'
                      : 'bg-rose-50 text-rose-700')
                }
              >
                <span className="font-kai text-base">{entry.char}</span>
                <span className="ml-1 text-xs">{entry.pinyin}</span>
              </li>
            ))}
          </ul>

          <p className="text-xs text-ink-faint">
            听到的：<span data-testid="pronounce-heard">{attempt.heard.join('')}</span>
          </p>
        </div>
      ) : null}
    </section>
  );
}
