'use client';

/**
 * 变字魔术 — the magic-character game.
 *
 * One character on the left, four on the right. Pick the one that is one
 * stroke away.
 *
 * The RULES live in `lib/magic-char-rules.ts` — what "one stroke away"
 * means, and how a question is built from the relation table. This file
 * is the rendering: the panels, the options, the clock and the round
 * lifecycle.
 *
 * ## The character pool
 *
 * The pool is the site's own HSK-graded character list, intersected with
 * the relation table. A character that has no relation to anything cannot
 * be a base, so it is not offered.
 *
 * ## The clock
 *
 * A round is 60 seconds. A wrong answer costs 5 seconds AND 20 points; a
 * right answer costs 10 points. The clock lives in a REF, because the
 * interval callback reads it: a state value would be a tick behind, and
 * the round would never end on time.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMagicTable } from '@/lib/api-magic';
import { fetchChainChars } from '@/lib/api-chain';
import { CHAIN_GAME_CONFIG } from '@/lib/difficulty';
import { useDifficulty } from '@/lib/use-difficulty';
import { DifficultyPicker } from '@/components/common/DifficultyPicker';
import { FallbackBanner } from '@/components/game/FallbackBanner';
import { MagicCharGlyph } from '@/components/game/MagicCharGlyph';
import { playChime, playFanfare, playThud } from '@/lib/game-sound';
import {
  buildQuestion,
  type MagicQuestion,
  type MagicRelation,
} from '@/lib/magic-char-rules';

type Phase = 'loading' | 'ready' | 'playing' | 'finished' | 'error';

/** How many questions one round holds. */
const MAGIC_ROUND_CHARS = 10;

/** How long a round lasts, in seconds. */
const MAGIC_ROUND_SECONDS = 60;

/** How many seconds a wrong answer costs. */
const WRONG_TIME_PENALTY = 5;

/** How many points a right answer costs. */
const RIGHT_POINT_PENALTY = 10;

/** How many points a wrong answer costs. */
const WRONG_POINT_PENALTY = 20;

/** What a relation is called, in the player's language. */
const RELATION_LABEL: Record<MagicRelation, string> = {
  add: '加一笔',
  remove: '减一笔',
  modify: '改一笔',
};

export function MagicCharGame() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [table, setTable] = useState<Record<string, Record<string, MagicRelation>>>({});
  const [pool, setPool] = useState<string[]>([]);
  const [hskFallback, setHskFallback] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // The question on screen.
  const [question, setQuestion] = useState<MagicQuestion | null>(null);
  // The seed of the question on screen — it is what the next question's
  // seed is derived from, so a replay of the same round is the same game.
  const [seed, setSeed] = useState(1);

  // The counters.
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [score, setScore] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(MAGIC_ROUND_SECONDS);
  /** Which question is on screen — the first is 1. */
  const [round, setRound] = useState(1);

  /**
   * The clock, in seconds.
   *
   * A REF, not state: the interval callback reads it every tick, and a
   * state value would be a tick behind.
   */
  const secondsRef = useRef(MAGIC_ROUND_SECONDS);

  /**
   * How many questions have been answered.
   *
   * A REF: the answer handler is a callback captured when the round
   * started, and a state value would be a step behind — the round would
   * never reach its end. The REF is what decides when the round ends;
   * the state above is what the player sees.
   */
  const answeredRef = useRef(0);

  /**
   * The question the answer handler belongs to.
   *
   * The options are buttons, and a click can land on the NEXT question's
   * button if the round moved on under the player's finger. The handler
   * checks the question it was given, so a late click cannot score
   * against a question it was not shown with.
   */
  const questionRef = useRef<MagicQuestion | null>(null);

  const { difficulty, setDifficulty, hskLevel, ready } = useDifficulty();

  /* ---------------------------------------------------------------- pool */

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    void (async () => {
      setPhase('loading');
      try {
        const [relationTable, chars] = await Promise.all([
          fetchMagicTable(),
          fetchChainChars(CHAIN_GAME_CONFIG[difficulty].source, hskLevel),
        ]);
        if (controller.signal.aborted) return;
        setTable(relationTable);
        setHskFallback(chars.hskFallback);
        // Only characters that have a relation can be a base.
        const usable = chars.chars
          .map((c) => c.char)
          .filter((char) => Object.keys(relationTable[char] ?? {}).length > 0);
        setPool(usable);
        setPhase('ready');
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('magic-char pool failed', error);
        setPhase('error');
      }
    })();
    return () => controller.abort();
  }, [ready, difficulty, hskLevel, reloadToken]);

  /* --------------------------------------------------------------- round */

  /** Starts a round: the first question, the counters and the clock. */
  const startRound = useCallback(() => {
    setCorrect(0);
    setWrong(0);
    setScore(0);
    secondsRef.current = MAGIC_ROUND_SECONDS;
    setSecondsLeft(MAGIC_ROUND_SECONDS);
    answeredRef.current = 0;
    setRound(1);
    const first = buildQuestion(table, pool, 1);
    if (!first) {
      setPhase('ready');
      return;
    }
    questionRef.current = first;
    setQuestion(first);
    setSeed(1);
    setPhase('playing');
  }, [table, pool]);

  /* -------------------------------------------------------------- answer */

  /** Records an answer and moves the round on. */
  const answer = useCallback(
    (chosen: string) => {
      const current = questionRef.current;
      if (!current) return;
      const ok = chosen === current.answer;

      if (ok) {
        playChime();
        setCorrect((n) => n + 1);
        setScore((n) => n - RIGHT_POINT_PENALTY);
      } else {
        playThud();
        setWrong((n) => n + 1);
        setScore((n) => n - WRONG_POINT_PENALTY);
        const left = secondsRef.current - WRONG_TIME_PENALTY;
        secondsRef.current = Math.max(0, left);
        setSecondsLeft(secondsRef.current);
        if (left <= 0) {
          setPhase('finished');
          playFanfare();
          return;
        }
      }

      answeredRef.current += 1;
      if (answeredRef.current >= MAGIC_ROUND_CHARS) {
        setPhase('finished');
        playFanfare();
        return;
      }

      // The next question's seed is derived from the round's seed, so the
      // round is reproducible but the questions differ.
      const nextSeed = seed + 1;
      const next = buildQuestion(table, pool, nextSeed);
      if (!next) {
        setPhase('finished');
        playFanfare();
        return;
      }
      questionRef.current = next;
      setQuestion(next);
      setSeed(nextSeed);
      setRound((n) => n + 1);
    },
    [table, pool, seed],
  );

  /* --------------------------------------------------------------- clock */

  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = setInterval(() => {
      const left = secondsRef.current - 1;
      secondsRef.current = Math.max(0, left);
      setSecondsLeft(secondsRef.current);
      if (left <= 0) {
        setPhase('finished');
        playFanfare();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  /* -------------------------------------------------------------- render */

  const attempts = correct + wrong;
  const summary = useMemo(() => {
    const ratio = attempts === 0 ? 0 : Math.round((correct / attempts) * 100);
    return { ratio };
  }, [attempts, correct]);

  if (phase === 'loading') {
    return <div className="py-12 text-center text-ink-faint">加载中...</div>;
  }

  if (phase === 'error') {
    return (
      <div className="py-12 text-center">
        <p className="text-seal">变字关系表暂时读不到，请稍后再试。</p>
        <button
          type="button"
          onClick={() => setReloadToken((token) => token + 1)}
          className="mt-4 rounded-md bg-seal px-4 py-2 text-white"
        >
          重试
        </button>
      </div>
    );
  }

  if (phase === 'ready') {
    return (
      <div className="space-y-6">
        <DifficultyPicker value={difficulty} onChange={setDifficulty} />
        <FallbackBanner hskLevel={hskLevel} available={!hskFallback} />
        <div className="card-paper p-6 text-center">
          <h3 className="mb-2 text-lg text-ink">变字魔术</h3>
          <p className="mb-4 text-sm text-ink-soft">
            左边那个字，加一笔、减一笔或改一笔，能变成哪个字？
          </p>
          <p className="mb-4 text-xs text-ink-faint">
            共 {MAGIC_ROUND_CHARS} 题，{MAGIC_ROUND_SECONDS} 秒。答错扣 {WRONG_TIME_PENALTY} 秒。
          </p>
          <button
            type="button"
            onClick={startRound}
            className="rounded-md bg-seal px-6 py-2 text-white"
          >
            开始
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'finished') {
    return (
      <div className="space-y-6">
        <div className="card-paper p-6">
          <h3 className="mb-3 text-lg text-ink">本局结束</h3>
          <div className="mb-4 flex gap-6 text-sm">
            <span className="text-success">
              答对{' '}
              <strong data-testid="magic-final-correct" className="text-success">
                {correct}
              </strong>
            </span>
            <span className="text-seal">
              答错{' '}
              <strong data-testid="magic-final-wrong" className="text-seal">
                {wrong}
              </strong>
            </span>
            <span className="text-ink-soft">正确率 {summary.ratio}%</span>
          </div>
          <button
            type="button"
            onClick={startRound}
            className="rounded-md bg-seal px-6 py-2 text-white"
          >
            再来一局
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <DifficultyPicker value={difficulty} onChange={setDifficulty} />
        <div className="flex items-center gap-4 text-xs text-ink-faint">
          <span data-testid="magic-round">
            第 {round} / {MAGIC_ROUND_CHARS} 题
          </span>
          <span data-testid="magic-timer">还剩 {secondsLeft} 秒</span>
          <span data-testid="magic-score">得分 {score}</span>
        </div>
      </div>
      <FallbackBanner hskLevel={hskLevel} available={!hskFallback} />

      <div className="flex flex-col gap-4 md:flex-row">
        {/* The left panel: the character to change. */}
        <div className="md:w-56 md:shrink-0">
          <div className="card-paper p-4 text-center">
            <div className="mb-1 text-xs text-ink-faint">这个字</div>
            <div
              data-testid="magic-base-char"
              className="mb-2 flex min-h-[120px] items-center justify-center font-kai text-6xl text-ink"
            >
              {question?.base ?? ''}
            </div>
            <div className="mb-3 text-xs text-ink-faint">
              {question ? RELATION_LABEL[question.relation] : ''}
            </div>
            <div className="flex justify-around text-sm">
              <span>
                答对{' '}
                <strong data-testid="magic-correct-count" className="text-success">
                  {correct}
                </strong>
              </span>
              <span>
                答错{' '}
                <strong data-testid="magic-wrong-count" className="text-seal">
                  {wrong}
                </strong>
              </span>
            </div>
          </div>
        </div>

        {/* The right panel: the four options. */}
        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(question?.options ?? []).map((option) => (
              <button
                key={option}
                type="button"
                data-testid="magic-option"
                onClick={() => answer(option)}
                className="card-paper flex min-h-[120px] items-center justify-center p-2 transition hover:border-seal"
              >
                <MagicCharGlyph char={option} />
              </button>
            ))}
          </div>
          <p className="mt-3 text-center text-xs text-ink-faint">
            选出那个和左边只差一笔的字。
          </p>
        </div>
      </div>
    </div>
  );
}
