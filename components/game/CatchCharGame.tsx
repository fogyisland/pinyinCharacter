'use client';

/**
 * 听音接字 — catch the character you hear.
 *
 * A character's reading is spoken and its pinyin is shown on the left. Three
 * characters fall: the target and two distractors that sound like it. The
 * player slides the basket under the one they heard.
 *
 * The RULES live in `lib/catch-char-rules.ts` — the wave builder, the
 * similarity scoring and the collision test. This file is the rendering:
 * the canvas, the input, the panels and the round lifecycle.
 *
 * THE CANVAS
 * The canvas is 624×604 (the width the layout maths assumes) and is scaled
 * by CSS to fit the column. Every coordinate in the game — the bubble
 * positions, the basket, the collision test — is in that fixed space, so
 * the physics never depends on the device's pixel ratio.
 *
 * THE INPUT
 * The basket follows the arrow keys and the mouse. Both write the same
 * value: the basket's centre x. The mouse does not move it directly — it
 * sets a TARGET the basket eases towards, so the basket still has weight
 * and the player cannot teleport it across the screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchChainChars } from '@/lib/api-chain';
import type { CharInfo } from '@/lib/chain-types';
import { CHAIN_GAME_CONFIG } from '@/lib/difficulty';
import { useDifficulty } from '@/lib/use-difficulty';
import { DifficultyPicker } from '@/components/common/DifficultyPicker';
import { FallbackBanner } from '@/components/game/FallbackBanner';
import { playChime, playFanfare, playThud } from '@/lib/game-sound';
import { speak } from '@/lib/tts';
import {
  CATCH_CANVAS_HEIGHT,
  CATCH_CANVAS_WIDTH,
  CATCH_ROUND_CHARS,
  buildWave,
  normalizePool,
  pickTarget,
  type CatchBubble,
  type CatchChar,
} from '@/lib/catch-char-rules';
import {
  BASKET_HALF_HEIGHT,
  BASKET_HALF_WIDTH,
  BASKET_Y,
  aimBasket,
  initSim,
  stepSim,
  type CatchSim,
} from '@/lib/catch-char-sim';

type Phase = 'loading' | 'ready' | 'playing' | 'finished' | 'error';

/** How long a particle burst lives, in ms. */
const PARTICLE_LIFE = 700;

/** One star of the burst that a catch throws off. */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
}

/** What the round remembers about a finished attempt. */
interface CaughtRecord {
  char: string;
  pinyin: string;
  meaning: string;
  radical: string;
  ok: boolean;
}

/** The pool arrives from /api/chain/chars as CharInfo; the game wants this. */
function toCatchChar(c: CharInfo): CatchChar {
  return {
    char: c.char,
    pinyin: c.pinyin,
    tone: c.tone,
    meaning: c.meaning,
    radical: c.radical,
  };
}

/**
 * Draws the paper, the bubbles, the basket and the particles.
 *
 * The palette is the site's 宣纸 (rice-paper) one: warm paper, ink-brown
 * strokes and a seal-red accent. A canvas game that ignores the site's
 * palette looks like a foreign widget pasted into the page.
 */
function drawScene(
  ctx: CanvasRenderingContext2D,
  bubbles: readonly CatchBubble[],
  basketX: number,
  particles: readonly Particle[],
  now: number,
): void {
  const ctx2d = ctx as CanvasRenderingContext2D & { roundRect?: unknown };
  ctx.clearRect(0, 0, CATCH_CANVAS_WIDTH, CATCH_CANVAS_HEIGHT);

  // The paper.
  ctx.fillStyle = '#fffaee';
  ctx.fillRect(0, 0, CATCH_CANVAS_WIDTH, CATCH_CANVAS_HEIGHT);

  // A faint ruled grid, so the falling characters have a sense of motion.
  ctx.strokeStyle = 'rgba(58, 42, 20, 0.06)';
  ctx.lineWidth = 1;
  for (let y = 40; y < CATCH_CANVAS_HEIGHT; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CATCH_CANVAS_WIDTH, y);
    ctx.stroke();
  }

  // The characters.
  for (const bubble of bubbles) {
    ctx.beginPath();
    ctx.arc(bubble.x, bubble.y, bubble.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#f4ecd8';
    ctx.fill();
    ctx.strokeStyle = '#b22b2b';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#3a2a14';
    ctx.font = '30px "LXGW WenKai", "Kaiti SC", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(bubble.char, bubble.x, bubble.y + 1);
  }

  // The basket — a bowl with a smile.
  ctx.beginPath();
  ctx.moveTo(basketX - BASKET_HALF_WIDTH, BASKET_Y - BASKET_HALF_HEIGHT);
  ctx.lineTo(basketX + BASKET_HALF_WIDTH, BASKET_Y - BASKET_HALF_HEIGHT);
  ctx.lineTo(basketX + BASKET_HALF_WIDTH * 0.62, BASKET_Y + BASKET_HALF_HEIGHT);
  ctx.lineTo(basketX - BASKET_HALF_WIDTH * 0.62, BASKET_Y + BASKET_HALF_HEIGHT);
  ctx.closePath();
  ctx.fillStyle = '#c99a3e';
  ctx.fill();
  ctx.strokeStyle = '#8b6f3a';
  ctx.lineWidth = 2;
  ctx.stroke();

  // The eyes and the mouth of the smiley basket.
  ctx.fillStyle = '#3a2a14';
  ctx.beginPath();
  ctx.arc(basketX - 12, BASKET_Y - 4, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(basketX + 12, BASKET_Y - 4, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(basketX, BASKET_Y - 2, 12, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  // The burst of stars from a catch.
  for (const particle of particles) {
    const age = now - particle.born;
    if (age > PARTICLE_LIFE) continue;
    const fade = 1 - age / PARTICLE_LIFE;
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#c99a3e';
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  void ctx2d;
}

export interface CatchCharGameProps {
  /**
   * How fast the game runs, as a multiple of real time.
   *
   * 1 is the normal speed. A higher value makes the characters fall
   * faster and the basket quicker — the same game, played at a different
   * pace. It is what a test uses to play a whole round in milliseconds
   * instead of a minute of wall clock.
   */
  timeScale?: number;
}

export function CatchCharGame({ timeScale = 1 }: CatchCharGameProps = {}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [pool, setPool] = useState<CatchChar[]>([]);
  const [hskFallback, setHskFallback] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // The target of the current wave.
  const [target, setTarget] = useState<CatchChar | null>(null);
  /**
   * The running simulation.
   *
   * It lives in a ref so the animation loop can move the bubbles sixty
   * times a second without re-rendering the component on every frame.
   */
  const simRef = useRef<CatchSim | null>(null);
  const [waveSeed, setWaveSeed] = useState(1);

  // The counters.
  const [caught, setCaught] = useState(0);
  const [missed, setMissed] = useState(0);
  const [round, setRound] = useState(1);
  const [records, setRecords] = useState<CaughtRecord[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  /** The round the wave belongs to — a wave from a finished round must not count. */
  const roundRef = useRef(1);
  /**
   * How many attempts the round has seen.
   *
   * A REF, not state: the animation loop holds the handler that reads it,
   * and a state value would be a frame behind — the round would never
   * reach its end.
   */
  const attemptsRef = useRef(0);

  const { difficulty, setDifficulty, hskLevel, ready } = useDifficulty();

  /* ---------------------------------------------------------------- pool */

  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    void (async () => {
      setPhase('loading');
      try {
        const source = CHAIN_GAME_CONFIG[difficulty].source;
        const result = await fetchChainChars(source, hskLevel);
        if (ctrl.signal.aborted) return;
        const normalized = normalizePool(result.chars.map(toCatchChar));
        setPool(normalized);
        setHskFallback(result.hskFallback);
        setPhase('ready');
      } catch (e) {
        if (ctrl.signal.aborted) return;
        console.error('catch-char pool failed', e);
        setPhase('error');
      }
    })();
    return () => ctrl.abort();
  }, [ready, difficulty, hskLevel, reloadToken]);

  /* --------------------------------------------------------------- wave */

  /** Starts a new wave: a fresh target, a fresh set of bubbles. */
  const startWave = useCallback(
    (seed: number) => {
      const chosen = pickTarget(pool, seed);
      if (!chosen) return;
      setTarget(chosen);
      simRef.current = initSim(buildWave(pool, chosen, seed));
      setWaveSeed(seed);
    },
    [pool],
  );
  /** Starts the round: the first wave, the counters and the clock. */
  const startRound = useCallback(() => {
    setCaught(0);
    setMissed(0);
    setRound(1);
    setRecords([]);
    roundRef.current = 1;
    attemptsRef.current = 0;
    particlesRef.current = [];
    startWave(1);
    setPhase('playing');
  }, [startWave]);

  /**
   * Speaks the target's reading.
   *
   * The site's own TTS is used (Edge TTS, cached), not the browser's
   * speechSynthesis: the site's voices are consistent across platforms
   * and the audio is cached, so a repeated word costs nothing.
   */
  const speakTarget = useCallback(
    (char: CatchChar | null) => {
      if (!char) return;
      void speak(char.char).catch((e) => {
        // A failed pronunciation must not break the round — the pinyin is
        // on screen anyway.
        console.warn('catch-char pronunciation failed', e);
      });
    },
    [],
  );

  // The target is spoken when the wave changes.
  useEffect(() => {
    if (phase !== 'playing') return;
    speakTarget(target);
  }, [phase, target, speakTarget]);

  /* ------------------------------------------------------------ verdict */

  /** Records a catch or a miss and moves the round on. */
  const resolveAttempt = useCallback(
    (ok: boolean, bubble: CatchBubble) => {
      if (ok) {
        playChime();
        setCaught((n) => n + 1);
        setRecords((prev) => [
          ...prev,
          {
            char: bubble.char,
            pinyin: bubble.pinyin,
            meaning: '',
            radical: '',
            ok: true,
          },
        ]);
      } else {
        playThud();
        setMissed((n) => n + 1);
        setRecords((prev) => [
          ...prev,
          {
            char: bubble.char,
            pinyin: bubble.pinyin,
            meaning: '',
            radical: '',
            ok: false,
          },
        ]);
      }

      // The attempt counter lives in a REF, not in the state: the loop
      // calls this handler with the counters it captured when the loop
      // started, and a state value would be a frame behind — the round
      // would never end, because the counter would be compared against
      // a stale value.
      attemptsRef.current += 1;

      if (attemptsRef.current >= CATCH_ROUND_CHARS) {
        // The round is over.
        setPhase('finished');
        playFanfare();
        return;
      }

      const nextRound = roundRef.current + 1;
      roundRef.current = nextRound;
      setRound(nextRound);
      startWave(nextRound * 1000 + 7);
    },
    [startWave],
  );

  /* ---------------------------------------------------------- the loop */

  useEffect(() => {
    if (phase !== 'playing') return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      // No canvas (an ancient browser, or a test without the stub): the
      // round still runs, it just is not drawn.
      return;
    }

    let last = lastFrameRef.current || 0;

    const step = (now: number) => {
      if (!last) last = now;
      const dt = Math.min((now - last) / 1000, 0.05) * timeScale;
      last = now;

      const sim = simRef.current;
      if (!sim) {
        frameRef.current = requestAnimationFrame(step);
        return;
      }

      // The movement, the collision and the judgement all live in the
      // simulation module, so the component and the unit tests drive
      // exactly the same behaviour.
      const result = stepSim(sim, dt);

      drawScene(ctx, sim.bubbles, sim.basketX, particlesRef.current, now);

      // The basket's position is published onto the canvas element, so
      // the position is observable from the outside. React renders the
      // attribute only when the component re-renders, and the animation
      // loop deliberately does NOT re-render — writing the attribute
      // directly is what keeps the frame rate at the display's rate.
      canvas.setAttribute('data-basket-x', String(Math.round(sim.basketX)));

      // The bubbles publish their positions too, so the state of the
      // falling characters is observable without instrumenting the
      // drawing code.
      for (const bubble of sim.bubbles) {
        canvas.setAttribute(
          `data-bubble-${bubble.char}`,
          `${Math.round(bubble.x)},${Math.round(bubble.y)}`,
        );
      }

      if (result.caught) {
        const bubble = result.caught;
        // The burst of stars.
        for (let i = 0; i < 10; i++) {
          const angle = (Math.PI * 2 * i) / 10;
          particlesRef.current.push({
            x: bubble.x,
            y: bubble.y,
            vx: Math.cos(angle) * 120,
            vy: Math.sin(angle) * 120,
            born: now,
          });
        }
        resolveAttempt(result.ok, bubble);
        // The next frame is scheduled BELOW, not here: returning early
        // would end the loop after the first catch, and the round would
        // freeze with one character caught.
      }

      frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      lastFrameRef.current = 0;
    };
  }, [phase, resolveAttempt, timeScale]);

  /* ------------------------------------------------------------- input */

  useEffect(() => {
    if (phase !== 'playing') return;

    const onKeyDown = (event: KeyboardEvent) => {
      const move = event.key === 'ArrowLeft' ? -40 : event.key === 'ArrowRight' ? 40 : 0;
      if (move === 0) return;
      event.preventDefault();
      const sim = simRef.current;
      if (!sim) return;
      aimBasket(sim, sim.basketTargetX + move);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase]);

  const onCanvasMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    // The canvas is scaled by CSS, so the pointer's position has to be
    // mapped back into the canvas's own coordinate space.
    const ratio = CATCH_CANVAS_WIDTH / rect.width;
    const sim = simRef.current;
    if (!sim) return;
    aimBasket(sim, (event.clientX - rect.left) * ratio);
  }, []);

  /* ------------------------------------------------------------ render */

  const attempts = caught + missed;

  const summary = useMemo(() => {
    const total = attempts;
    const ratio = total === 0 ? 0 : Math.round((caught / total) * 100);
    return { total, ratio };
  }, [attempts, caught]);

  if (phase === 'loading') {
    return <div className="py-12 text-center text-ink-faint">加载中...</div>;
  }

  if (phase === 'error') {
    return (
      <div className="py-12 text-center">
        <p className="text-seal">字库加载失败</p>
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
          <h3 className="mb-2 text-lg text-ink">听音接字</h3>
          <p className="mb-4 text-sm text-ink-soft">
            听发音，接住那个字。用 ← → 或鼠标移动篮子。
          </p>
          <p className="mb-4 text-xs text-ink-faint">
            共 {CATCH_ROUND_CHARS} 个字，每题三个字同时落下。
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
              接住{' '}
              <strong data-testid="catch-final-count" className="text-success">
                {caught}
              </strong>
            </span>
            <span className="text-seal">
              错过{' '}
              <strong data-testid="catch-final-miss-count" className="text-seal">
                {missed}
              </strong>
            </span>
            <span className="text-ink-soft">正确率 {summary.ratio}%</span>
          </div>
          {records.length > 0 && (
            <ul className="mb-4 space-y-1 text-sm">
              {records.map((record, index) => (
                <li
                  key={`${record.char}-${index}`}
                  className={record.ok ? 'text-ink' : 'text-seal'}
                >
                  {record.ok ? '✓' : '✗'} {record.char} {record.pinyin}
                </li>
              ))}
            </ul>
          )}
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
        <div className="text-xs text-ink-faint">第 {round} / {CATCH_ROUND_CHARS} 题</div>
      </div>
      <FallbackBanner hskLevel={hskLevel} available={!hskFallback} />

      <div className="flex flex-col gap-4 md:flex-row">
        {/* The left panel: the target, the counters and the replay button. */}
        <div className="md:w-48 md:shrink-0">
          <div className="card-paper p-4 text-center">
            <div className="mb-1 text-xs text-ink-faint">听这个音</div>
            <div
              data-testid="catch-target-pinyin"
              className="mb-3 font-kai text-3xl text-seal"
            >
              {target?.pinyin ?? ''}
            </div>
            <button
              type="button"
              onClick={() => speakTarget(target)}
              className="mb-4 rounded-md border border-seal px-3 py-1 text-sm text-seal hover:bg-seal hover:text-white"
            >
              再听一遍
            </button>
            <div className="flex justify-around text-sm">
              <span>
                接住{' '}
                <strong data-testid="catch-count" className="text-success">
                  {caught}
                </strong>
              </span>
              <span>
                错过{' '}
                <strong data-testid="catch-miss-count" className="text-seal">
                  {missed}
                </strong>
              </span>
            </div>
          </div>
        </div>

        {/* The right panel: the canvas. */}
        <div className="min-w-0 flex-1">
          <canvas
            ref={canvasRef}
            width={CATCH_CANVAS_WIDTH}
            height={CATCH_CANVAS_HEIGHT}
            data-basket-x={Math.round(simRef.current?.basketX ?? CATCH_CANVAS_WIDTH / 2)}
            data-wave-seed={waveSeed}
            data-target-char={target?.char ?? ''}
            onMouseMove={onCanvasMove}
            className="w-full cursor-pointer rounded-md border border-paper-warm"
            aria-label="接字游戏区域"
          />
          <p className="mt-2 text-center text-xs text-ink-faint">
            用 ← → 键或鼠标移动篮子，接住听到的那个字。
          </p>
        </div>
      </div>
    </div>
  );
}
