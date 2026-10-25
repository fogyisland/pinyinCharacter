'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { QuestCharPayload, QuestLevelPayload } from '@/lib/game-quest-types';
import {
  collectChar,
  loadProgress,
  markLevelPassed,
  recordMiss,
  saveProgress,
} from '@/lib/game-progress';
import type { CollectedSnapshot } from '@/lib/game-progress';
import { charSnapshot, revealedFacets } from '@/lib/game-quest-reveal';
import type { QuestRevealRound } from '@/lib/game-quest-reveal';
import { isSoundMuted, playChime, playFanfare, playStamp, playThud } from '@/lib/game-sound';
import { speak, stopSpeaking } from '@/lib/tts';
import { prefetchTts } from '@/lib/tts-cache';
import { QuestCharCard } from './QuestCharCard';
import { LEVEL_MISSING, LOAD_FAILED, QuestErrorState } from './QuestErrorState';
import { QuestQuestionCard } from './QuestQuestionCard';
import { QuestSealRow } from './QuestSealRow';
import { QuestSummary } from './QuestSummary';

/**
 * The quest runner - the flow engine of the 闯关 mode.
 *
 * Every char of the level is asked all four questions in the fixed order
 * 读音 → 声调 → 部首 → 词义, and the runner owns two writes: the miss and
 * the pass. The level pointer only advances on a pass - abandoning an
 * attempt leaves it where it is.
 */
export interface QuestRunnerProps {
  tier: number;
  level: number;
  onExit: () => void;
  onPassed: (level: number) => void;
  /** The summary's 「下一关」 button - only the parent knows the next level. */
  onNextLevel: () => void;
  /** The sound is muted - the ② audio button says 「🔇 已静音」 instead of lying. */
  muted?: boolean;
}

type Phase = 'loading' | 'playing' | 'summary';
type AudioState = 'idle' | 'loading' | 'playing' | 'unavailable';

interface Attempt {
  selected: number | null;
  answered: boolean;
  correct: boolean;
  hinted: boolean;
}

interface RoundState extends QuestRevealRound {
  chars: QuestCharPayload[];
}

interface QuestResponse {
  ok: boolean;
  data?: QuestLevelPayload;
  error?: { code?: string; message?: string };
}

const EMPTY_ATTEMPT: Attempt = { selected: null, answered: false, correct: false, hinted: false };

/** The audio is a progressive enhancement - it is given up after 3 s (spec §5.2). */
const AUDIO_TIMEOUT_MS = 3000;

/** The holder of the audio timeout id - the effect cleanup clears it. */
interface AudioTimerRef {
  current: ReturnType<typeof setTimeout> | null;
}

/** Clear the pending audio timeout - a dangling timer would outlive the question. */
function clearAudioTimer(timerRef: AudioTimerRef): void {
  if (timerRef.current === null) return;
  clearTimeout(timerRef.current);
  timerRef.current = null;
}

/**
 * Play the character.
 *
 * The mute switch silences the character audio too (§9), so the call is
 * skipped when the player muted the sound. The audio never blocks the
 * question (spec §5.2): if the request fails **or has not produced audio
 * within ~3 s**, the 🔊 button reports 「🔊 暂时不可用」 and the question stays
 * fully answerable.
 */
async function playCharacterAudio(
  text: string,
  setAudio: (state: AudioState) => void,
  timerRef: AudioTimerRef,
): Promise<void> {
  if (isSoundMuted()) return;
  setAudio('loading');
  clearAudioTimer(timerRef);
  let playingTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    const pending = speak(text, { voice: 'male' });
    playingTimer = setTimeout(() => setAudio('playing'), 400);
    const timeout = new Promise<never>((_, reject) => {
      timerRef.current = setTimeout(() => {
        reject(new Error('the character audio did not arrive in time'));
      }, AUDIO_TIMEOUT_MS);
    });
    await Promise.race([pending, timeout]);
    setAudio('idle');
  } catch (failure) {
    console.warn('[quest] the character audio is not available', failure);
    setAudio('unavailable');
  } finally {
    if (playingTimer !== null) clearTimeout(playingTimer);
    clearAudioTimer(timerRef);
  }
}

export function QuestRunner(props: QuestRunnerProps) {
  const { tier, level, onExit, onPassed, onNextLevel, muted } = props;
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<{ message: string; canRetry: boolean } | null>(null);
  const [levelData, setLevelData] = useState<QuestLevelPayload | null>(null);
  const [round, setRound] = useState<RoundState | null>(null);
  const [charIndex, setCharIndex] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [attempt, setAttempt] = useState<Attempt>(EMPTY_ATTEMPT);
  const [combo, setCombo] = useState(0);
  const [audio, setAudio] = useState<AudioState>('idle');
  const [missed, setMissed] = useState<string[]>([]);
  const [stampedChars, setStampedChars] = useState<Record<string, boolean>>({});
  const [hintedChars, setHintedChars] = useState<Record<string, boolean>>({});
  /** The chars whose four questions are all correct - they enter the 字卡册. */
  const [masteredChars, setMasteredChars] = useState<Record<string, boolean>>({});
  const [notedChar, setNotedChar] = useState<string | null>(null);
  /** The remediation is offered once - a second failure ends the attempt (§5.6). */
  const [remediationUsed, setRemediationUsed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  /** The per-char correctness of the four questions - `null` means unanswered. */
  const answersRef = useRef<Record<string, (boolean | null)[]>>({});
  const collectedRef = useRef<Set<string>>(new Set());
  const passedRef = useRef(false);
  const audioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/game/quest?hsk=${tier}&level=${level}`);
        const body = (await res.json()) as QuestResponse;
        if (!res.ok || !body.ok || !body.data) {
          // The tier is built once per process - a missing level cannot come back.
          if (body.error?.code === 'level_not_found') {
            if (cancelled) return;
            setError(LEVEL_MISSING);
            return;
          }
          throw new Error(body.error?.code ?? `http_${res.status}`);
        }
        if (cancelled) return;
        const payload = body.data;
        answersRef.current = {};
        collectedRef.current = new Set();
        passedRef.current = false;
        setLevelData(payload);
        setRound({
          kind: 'main',
          chars: payload.chars,
          questionIndices: payload.chars.map((char) => char.questions.map((_, index) => index)),
          answeredCounts: payload.chars.map(() => 0),
        });
        setCharIndex(0);
        setQuestionIndex(0);
        setAttempt(EMPTY_ATTEMPT);
        setCombo(0);
        setMissed([]);
        setStampedChars({});
        setHintedChars({});
        setMasteredChars({});
        setNotedChar(null);
        // A new level is a new attempt.
        setRemediationUsed(false);
        setPhase('playing');
        for (const char of payload.chars) {
          void prefetchTts('male', char.char).catch((failure) => {
            console.warn('[quest] the character audio could not be prefetched', failure);
          });
        }
      } catch (failure) {
        if (cancelled) return;
        console.warn('[quest] the level could not be loaded', failure);
        setError(LOAD_FAILED);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tier, level, retryToken]);

  const current = useMemo(() => {
    const char = round?.chars[charIndex] ?? null;
    const indices = round?.questionIndices[charIndex] ?? [];
    const questionPosition = indices[questionIndex] ?? null;
    const question =
      char && questionPosition !== null ? (char.questions[questionPosition] ?? null) : null;
    return { char, question, questionPosition, total: indices.length };
  }, [round, charIndex, questionIndex]);

  const audioChar = current.char?.char ?? '';
  const audioKind = current.question?.kind ?? '';

  useEffect(() => {
    if (phase !== 'playing' || audioChar === '') return;
    if (audioKind !== 'tone') {
      setAudio('idle');
      return;
    }
    // The character is played once when the ② question appears. The first
    // one of a fresh visit is blocked by the browser, which is why the 🔊
    // button is the primary path.
    void playCharacterAudio(audioChar, setAudio, audioTimerRef);
    return () => {
      stopSpeaking();
      // A question that is left behind must not keep a timer alive.
      clearAudioTimer(audioTimerRef);
    };
  }, [phase, audioChar, audioKind]);

  function isMastered(char: QuestCharPayload): boolean {
    return masteredChars[char.char] === true;
  }

  function collect(char: QuestCharPayload): void {
    if (collectedRef.current.has(char.char)) return;
    collectedRef.current.add(char.char);
    setMasteredChars((previous) => ({ ...previous, [char.char]: true }));
    const snapshot: CollectedSnapshot = { ...charSnapshot(char), hasStory: char.hasStory };
    saveProgress(collectChar(loadProgress(), char.char, snapshot, tier, level));
    playStamp();
  }

  function addToWrongBook(char: QuestCharPayload): void {
    saveProgress(recordMiss(loadProgress(), char.char, charSnapshot(char), tier, level));
  }

  function applyAnswer(char: QuestCharPayload, questionPosition: number, isCorrect: boolean): void {
    const previous =
      answersRef.current[char.char] ?? Array.from({ length: char.questions.length }, () => null);
    const next = [...previous];
    next[questionPosition] = isCorrect;
    answersRef.current = { ...answersRef.current, [char.char]: next };
    setRound((previousRound) =>
      previousRound
        ? {
            ...previousRound,
            answeredCounts: previousRound.answeredCounts.map((count, index) =>
              index === charIndex ? count + 1 : count,
            ),
          }
        : previousRound,
    );
    // A char is 认会 when all of its questions are correct.
    if (next.length === char.questions.length && next.every((value) => value === true)) {
      collect(char);
    }
  }

  function handleSelect(optionIndex: number): void {
    const { char, question, questionPosition } = current;
    if (!char || !question || questionPosition === null || attempt.answered) return;
    const isCorrect = optionIndex === question.answerIndex;
    setAttempt({
      selected: optionIndex,
      answered: true,
      correct: isCorrect,
      hinted: attempt.hinted,
    });
    if (isCorrect) {
      playChime();
      setCombo((value) => value + 1);
      setStampedChars((previous) => ({ ...previous, [char.char]: true }));
    } else {
      playThud();
      setCombo(0);
      addToWrongBook(char);
    }
    applyAnswer(char, questionPosition, isCorrect);
  }

  function handleHint(): void {
    const { char } = current;
    if (!char || attempt.answered || attempt.hinted) return;
    setAttempt((previous) => ({ ...previous, hinted: true }));
    setHintedChars((previous) => ({ ...previous, [char.char]: true }));
    // The hint breaks the combo.
    setCombo(0);
  }

  function handlePlayAudio(): void {
    const { char } = current;
    if (!char) return;
    void playCharacterAudio(char.char, setAudio, audioTimerRef);
  }

  function finishRound(): void {
    if (!round) return;
    const missedChars = round.chars.filter((char) => !isMastered(char)).map((char) => char.char);
    setMissed(missedChars);
    setPhase('summary');
    if (missedChars.length === 0 && !passedRef.current) {
      passedRef.current = true;
      saveProgress(markLevelPassed(loadProgress(), tier, level));
      playFanfare();
      onPassed(level);
    }
  }

  function handleAdvance(): void {
    const indices = round?.questionIndices[charIndex] ?? [];
    setAttempt(EMPTY_ATTEMPT);
    if (questionIndex < indices.length - 1) {
      setQuestionIndex(questionIndex + 1);
      return;
    }
    if (round && charIndex < round.chars.length - 1) {
      setCharIndex(charIndex + 1);
      setQuestionIndex(0);
      return;
    }
    finishRound();
  }

  /**
   * The remediation round (§5.6): it re-asks only the missed questions of the
   * missed chars, entirely from the payload that is already in memory - there
   * is no second API call. It is offered once: a second failure ends the
   * attempt.
   */
  function handleRemediate(): void {
    if (remediationUsed) return;
    if (!levelData) return;
    const chars = levelData.chars.filter((char) => !isMastered(char));
    if (chars.length === 0) return;
    const questionIndices = chars.map((char) => {
      const answers = answersRef.current[char.char] ?? [];
      const indices: number[] = [];
      char.questions.forEach((_, index) => {
        if (answers[index] !== true) indices.push(index);
      });
      return indices;
    });
    setRemediationUsed(true);
    setRound({
      kind: 'remediation',
      chars,
      questionIndices,
      answeredCounts: chars.map(() => 0),
    });
    setCharIndex(0);
    setQuestionIndex(0);
    setAttempt(EMPTY_ATTEMPT);
    setCombo(0);
    setMissed([]);
    setNotedChar(null);
    setPhase('playing');
  }

  /** The 「重试」 handler - it re-runs the load effect. */
  const handleRetry = (): void => setRetryToken((token) => token + 1);

  if (error) {
    return <QuestErrorState {...error} onRetry={handleRetry} onExit={onExit} />;
  }

  if (phase === 'loading') {
    return <p className="py-12 text-center text-ink-faint">正在打开这一关…</p>;
  }

  if (phase === 'summary' && levelData) {
    return (
      <QuestSummary
        tier={tier}
        level={level}
        chars={levelData.chars}
        missed={missed}
        passed={missed.length === 0}
        onNext={onNextLevel}
        onRemediate={remediationUsed ? undefined : handleRemediate}
        onExit={onExit}
      />
    );
  }

  if (
    !round ||
    !levelData ||
    !current.char ||
    !current.question ||
    current.questionPosition === null
  ) {
    return <QuestErrorState {...LOAD_FAILED} onRetry={handleRetry} onExit={onExit} />;
  }

  const facets = revealedFacets(charIndex, questionIndex, round);
  // The narrowed char, so the closures below do not have to re-check it.
  const activeChar = current.char;
  const advanceLabel =
    questionIndex < current.total - 1
      ? '下一题'
      : charIndex < round.chars.length - 1
        ? '下一个字'
        : '看结果';

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-sm text-ink-soft">
        <span>
          第 {level} 关 · 本关 {levelData.chars.length} 字
        </span>
        <span data-combo={combo}>连击 {combo}</span>
        <button type="button" onClick={onExit} className="text-ink-faint hover:text-ink">
          返回关卡地图
        </button>
      </div>

      <QuestSealRow chars={levelData.chars} mastered={masteredChars} />

      <QuestCharCard
        char={activeChar}
        showPinyin={facets.pinyin}
        showRadical={facets.radical}
        showMeaning={facets.meaning}
        stamped={stampedChars[current.char.char] === true}
        hinted={hintedChars[current.char.char] === true}
        wrong={attempt.answered && !attempt.correct}
      />

      <div className="mt-4">
        <QuestQuestionCard
          question={current.question}
          plainPinyin={activeChar.plainPinyin}
          index={questionIndex}
          total={current.total}
          selected={attempt.selected}
          answered={attempt.answered}
          correct={attempt.correct}
          hinted={attempt.hinted}
          onSelect={handleSelect}
          onHint={handleHint}
          audio={audio}
          onPlayAudio={handlePlayAudio}
          muted={muted}
        />
      </div>

      {attempt.answered ? (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            data-action="advance"
            onClick={handleAdvance}
            className="rounded border border-seal bg-seal px-5 py-2 text-paper-soft hover:opacity-90"
          >
            {advanceLabel}
          </button>
          {attempt.correct ? null : (
            <>
              <button
                type="button"
                onClick={() => setNotedChar(activeChar.char)}
                className="rounded border border-ink/20 bg-paper px-4 py-2 text-sm text-ink-soft hover:bg-paper-deep"
              >
                记一笔
              </button>
              {notedChar === activeChar.char ? (
                <span className="text-xs text-ink-faint">已记入生字本</span>
              ) : null}
              <a
                href="/game?tab=wrong"
                data-action="note"
                className="text-xs text-seal hover:underline"
              >
                生字本
              </a>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
