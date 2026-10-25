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
import type { CharSnapshot, CollectedSnapshot } from '@/lib/game-progress';
import { isSoundMuted, playChime, playFanfare, playStamp, playThud } from '@/lib/game-sound';
import { speak, stopSpeaking } from '@/lib/tts';
import { prefetchTts } from '@/lib/tts-cache';
import { QuestCharCard } from './QuestCharCard';
import { QuestQuestionCard } from './QuestQuestionCard';
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
}

type Phase = 'loading' | 'playing' | 'summary';
type RoundKind = 'main' | 'remediation';
type AudioState = 'idle' | 'loading' | 'playing' | 'unavailable';

interface Attempt {
  selected: number | null;
  answered: boolean;
  correct: boolean;
  hinted: boolean;
}

interface RoundState {
  kind: RoundKind;
  chars: QuestCharPayload[];
  /** For each char: the original question indices this round asks, in order. */
  questionIndices: number[][];
  /** For each char: how many of its round questions are already answered. */
  answeredCounts: number[];
}

interface Facets {
  pinyin: boolean;
  radical: boolean;
  meaning: boolean;
}

interface QuestResponse {
  ok: boolean;
  data?: QuestLevelPayload;
  error?: { code?: string; message?: string };
}

const EMPTY_ATTEMPT: Attempt = { selected: null, answered: false, correct: false, hinted: false };

/** The fields a char contributes to both books - the collection book adds the story flag. */
function charSnapshot(char: QuestCharPayload): CharSnapshot {
  return {
    pinyin: char.pinyin,
    plainPinyin: char.plainPinyin,
    tone: char.tone,
    toneName: char.toneName,
    radical: char.radical,
    meaningShort: char.meaningShort,
  };
}

/** ① and ② both test the pinyin - ②'s options are the four tone forms of that syllable. */
function testsPinyin(questionIndex: number): boolean {
  return questionIndex === 0 || questionIndex === 1;
}

function testsRadical(questionIndex: number): boolean {
  return questionIndex === 2;
}

function testsMeaning(questionIndex: number): boolean {
  return questionIndex === 3;
}

/**
 * The reveal rule (§7.2) - a facet is hidden while a pending question in the
 * current round tests it.
 */
function revealedFacets(charIndex: number, questionIndex: number, round: RoundState): Facets {
  const indices = round.questionIndices[charIndex] ?? [];
  // Everything before the current question is answered; the current one
  // counts as pending until the learner has answered it.
  const answeredCount = Math.max(round.answeredCounts[charIndex] ?? 0, questionIndex);
  const pending = indices.slice(answeredCount);
  let pinyin = !pending.some(testsPinyin);
  const radical = !pending.some(testsRadical);
  const meaning = !pending.some(testsMeaning);
  if (round.kind === 'remediation' && indices.some(testsPinyin)) {
    // A remediation round re-hides the facet it re-tests.
    pinyin = false;
  }
  return { pinyin, radical, meaning };
}

/**
 * Play the character.
 *
 * The mute switch silences the character audio too (§9), so the call is
 * skipped when the player muted the sound. A rejected playback leaves the
 * question fully answerable - the 🔊 button simply reports that the audio is
 * not available.
 */
async function playCharacterAudio(
  text: string,
  setAudio: (state: AudioState) => void,
): Promise<void> {
  if (isSoundMuted()) return;
  setAudio('loading');
  let timer = 0;
  try {
    const pending = speak(text, { voice: 'male' });
    timer = window.setTimeout(() => setAudio('playing'), 400);
    await pending;
    setAudio('idle');
  } catch (failure) {
    console.warn('[quest] the character audio is not available', failure);
    setAudio('unavailable');
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

export function QuestRunner({ tier, level, onExit, onPassed }: QuestRunnerProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
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
  const [retryToken, setRetryToken] = useState(0);

  /** The per-char correctness of the four questions - `null` means unanswered. */
  const answersRef = useRef<Record<string, (boolean | null)[]>>({});
  const collectedRef = useRef<Set<string>>(new Set());
  const passedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/game/quest?hsk=${tier}&level=${level}`);
        const body = (await res.json()) as QuestResponse;
        if (!res.ok || !body.ok || !body.data) {
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
        setPhase('playing');
        for (const char of payload.chars) {
          void prefetchTts('male', char.char).catch((failure) => {
            console.warn('[quest] the character audio could not be prefetched', failure);
          });
        }
      } catch (failure) {
        if (cancelled) return;
        console.warn('[quest] the level could not be loaded', failure);
        setError('这一关暂时打不开');
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
    void playCharacterAudio(audioChar, setAudio);
    return () => {
      stopSpeaking();
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
    const previous = answersRef.current[char.char] ?? [null, null, null, null];
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
    // A char is 认会 when all four of its questions are correct.
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
    void playCharacterAudio(char.char, setAudio);
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
   * is no second API call.
   */
  function handleRemediate(): void {
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

  if (error) {
    return (
      <div className="py-12 text-center">
        <p className="text-ink-soft">{error}</p>
        <button
          type="button"
          onClick={() => setRetryToken((token) => token + 1)}
          className="mt-3 rounded border border-seal bg-seal px-4 py-2 text-paper-soft hover:opacity-90"
        >
          重试
        </button>
      </div>
    );
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
        onNext={onExit}
        onRemediate={handleRemediate}
        onExit={onExit}
      />
    );
  }

  if (!round || !current.char || !current.question || current.questionPosition === null) {
    return <p className="py-12 text-center text-ink-faint">这一关暂时打不开</p>;
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
          第 {level} 关 · 本关 {round.chars.length} 字
        </span>
        <span data-combo={combo}>连击 {combo}</span>
        <button type="button" onClick={onExit} className="text-ink-faint hover:text-ink">
          返回关卡地图
        </button>
      </div>

      <div className="mb-3 flex gap-1" aria-label="本关进度">
        {round.chars.map((char) => (
          <span
            key={char.char}
            className={`h-2 w-2 rounded-full ${isMastered(char) ? 'bg-seal' : 'bg-ink/15'}`}
          />
        ))}
      </div>

      <QuestCharCard
        char={activeChar}
        showPinyin={facets.pinyin}
        showRadical={facets.radical}
        showMeaning={facets.meaning}
        stamped={stampedChars[current.char.char] === true}
        hinted={hintedChars[current.char.char] === true}
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
              <a
                href="/game?tab=wrong"
                data-action="note"
                onClick={() => setNotedChar(activeChar.char)}
                className="rounded border border-ink/20 bg-paper px-4 py-2 text-sm text-ink-soft hover:bg-paper-deep"
              >
                记一笔
              </a>
              {notedChar === activeChar.char ? (
                <span className="text-xs text-ink-faint">已记入生字本</span>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
