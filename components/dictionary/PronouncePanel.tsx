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
import { recordOnce, RECORD_FAILURE_MESSAGES } from '@/lib/pronunciation-recorder';
import { assessWithAzure, fetchAssessStatus, type SpeechAvailability } from '@/lib/api-speech';
import type { Assessment } from '@/lib/speech-types';

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
  /** Azure's syllable scores, when the paid path answered. */
  assessment?: Assessment;
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
  /**
   * Whether the site has an Azure key — the PAID path.
   *
   * `null` until the probe runs, for the same hydration reason as
   * `supported`. It starts hidden on purpose: a button that uploads a
   * learner's voice must not appear just because the code could do it.
   */
  const [azure, setAzure] = useState<SpeechAvailability | null>(null);
  const [assessing, setAssessing] = useState(false);

  useEffect(() => {
    setSupported(isSpeechSupported());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchAssessStatus()
      .then((availability) => {
        if (!cancelled) setAzure(availability);
      })
      .catch((failure: unknown) => {
        console.warn('[pronounce] could not read the assessment status', failure);
        if (!cancelled) setAzure({ configured: false, loggedIn: false });
      });
    return () => {
      cancelled = true;
    };
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

  /**
   * Record the word and have Azure score it.
   *
   * This is the ONLY path that sends audio anywhere: the recording goes to
   * our own route, which forwards it to Azure and drops it. The browser-only
   * path above never leaves the machine, which is why the two are separate
   * buttons rather than one button with a hidden upgrade.
   */
  const assess = useCallback(async () => {
    setAssessing(true);
    setError(null);
    setAttempt(null);
    setHasTried(true);
    const recorded = await recordOnce();
    if (!recorded.ok) {
      setAssessing(false);
      setError(RECORD_FAILURE_MESSAGES[recorded.reason]);
      return;
    }
    const result = await assessWithAzure(recorded.wav, word);
    setAssessing(false);
    if (!result.ok) {
      // A broken paid path must not take the free one down with it: the
      // error is shown and the local button stays available.
      setError(result.message);
      return;
    }
    // Turn Azure's per-syllable scores into the same per-character marks the
    // local path produces, so the learner reads one interface.
    const assessments = result.assessment.syllables;
    const graded: Comparison['verdicts'] = assessments
      .slice(0, chars.length)
      .map((syllable) => {
        if (syllable.accuracy >= 80) return 'exact';
        if (syllable.accuracy >= 50) return 'tone';
        return 'wrong';
      });
    // Azure returns one syllable per character it heard. A skipped character
    // is a miscue with no syllable, so the marks must be PADDED to the
    // target's length — otherwise a char with no mark would show as wrong by
    // accident of an undefined class rather than because it was missing.
    while (graded.length < chars.length) graded.push('missing');
    const heardScore = result.assessment.pronunciation;
    setAttempt({
      heard: Array.from(result.assessment.recognised),
      comparison: {
        verdicts: graded,
        score: Math.round(heardScore),
        advice:
          heardScore >= 90
            ? 'perfect'
            : assessments.some((s) => s.accuracy < 50)
              ? 'sounds'
              : 'tones',
      },
      offset: 0,
      assessment: result.assessment,
    });
    setPhase('result');
  }, [chars.length, word]);

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
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void listen()}
              disabled={phase === 'listening' || assessing}
              className="rounded bg-seal px-3 py-1.5 text-sm text-white hover:bg-seal/80 disabled:bg-ink/20"
            >
              {phase === 'listening' ? '正在听…' : hasTried ? '再读一遍' : '跟读（点一下开始）'}
            </button>
            {azure?.configured && azure.loggedIn ? (
              <button
                type="button"
                onClick={() => void assess()}
                disabled={phase === 'listening' || assessing}
                className="rounded border border-seal px-3 py-1.5 text-sm text-seal hover:bg-seal/10 disabled:opacity-50"
              >
                {assessing ? '正在评测…' : '精评（Azure 音素打分）'}
              </button>
            ) : null}
            {phase === 'listening' || assessing ? (
              <span className="text-xs text-ink-faint">请读完整个词，然后等一下。</span>
            ) : null}
          </div>
          {/* Two different reasons the 精评 button is missing, and two
              different sentences: a visitor needs to log in, while everyone
              needs the operator to configure a key. Showing one message for
              both is how a visitor waits for an admin who already did the
              work. */}
          {azure?.configured && azure.loggedIn === false ? (
            <p className="text-xs text-ink-faint">
              精评（Azure 音素打分）需要登录后使用。跟读不用登录，现在就能用。
            </p>
          ) : null}
          {/* The paid button uploads audio; saying so BEFORE the click is the
              honest thing to do, not a footnote after it. */}
          {azure?.configured && azure.loggedIn ? (
            <p className="text-xs text-ink-faint">
              精评会把这段录音传给 Azure 语音服务打分（录音不留在本站）。
            </p>
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

          {/* Azure's per-syllable scores are the whole reason for the paid
              call: 88 vs 96 tells the learner WHICH syllable to fix, which
              the local comparison can only guess at. */}
          {attempt.assessment ? (
            <ul
              data-testid="pronounce-syllables"
              className="flex flex-wrap gap-2 text-xs text-ink-soft"
            >
              {attempt.assessment.syllables.map((syllable) => (
                <li
                  key={syllable.syllable}
                  className="rounded bg-paper px-2 py-0.5"
                  title={`准确 ${syllable.accuracy} · 流利 ${syllable.fluency} · 完整 ${syllable.completeness}`}
                >
                  <span className="font-kai">{syllable.syllable}</span>
                  <span className="ml-1 tabular-nums">{Math.round(syllable.accuracy)}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {/* The phonemes are what justifies 「音素级」 rather than 「音节级」:
              a syllable can score 88 while one sound inside it scored 60, and
              THAT sound is what the learner has to fix. Only the weakest few
              are shown — a full phoneme table is noise for a two-syllable
              word, and the learner acts on one thing at a time. */}
          {attempt.assessment && weakestPhonemes(attempt.assessment.phonemes).length > 0 ? (
            <p data-testid="pronounce-phonemes" className="text-xs text-ink-soft">
              最弱的音：
              {weakestPhonemes(attempt.assessment.phonemes).map((phoneme, index) => (
                <span key={`${phoneme.phoneme}-${index}`} className="ml-1">
                  <span className="font-kai">{phoneme.phoneme}</span>
                  <span
                    className={
                      'ml-0.5 tabular-nums ' +
                      (phoneme.accuracy < 60 ? 'text-amber-700' : 'text-ink-faint')
                    }
                  >
                    {Math.round(phoneme.accuracy)}
                  </span>
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** How many phonemes the panel names when several are weak. */
const MAX_WEAK_PHONEMES = 3;

/**
 * The lowest-scoring phonemes worth mentioning.
 *
 * Azure scores every phoneme of the word. A learner reading 「学生」 sees
 * `x`, `ue`, `sh`, `eng` — listing all four is a grade sheet, not advice.
 * The panel names the worst few, and only when they are actually weak: at
 * 92+ there is nothing to fix, and a list of high scores reads as a scolding
 * of a learner who read well.
 *
 * @param phonemes what Azure scored, possibly empty.
 * @returns at most {@link MAX_WEAK_PHONEMES} entries, worst first; `[]` when
 *          nothing is weak enough to name.
 */
function weakestPhonemes(
  phonemes: ReadonlyArray<{ phoneme: string; accuracy: number }>,
): Array<{ phoneme: string; accuracy: number }> {
  const WEAK_BELOW = 90;
  return phonemes
    .filter((phoneme) => phoneme.phoneme !== '' && phoneme.accuracy < WEAK_BELOW)
    .slice()
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, MAX_WEAK_PHONEMES);
}
