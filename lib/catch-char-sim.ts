/**
 * The simulation of 听音接字 — the movement, the collision and the round's
 * bookkeeping, with no canvas and no React.
 *
 * WHY THE SIMULATION IS SEPARATE FROM THE COMPONENT
 * The game is real-time: characters fall, the basket slides, and a catch
 * has to be judged in the frame it happens. Testing that through the DOM
 * means waiting in real time — a single character takes six seconds to
 * fall, so a round of ten would take a minute of wall clock, and a unit
 * test that takes a minute is a unit test nobody runs.
 *
 * So the movement lives here, as a pure function of (state, dt). The
 * component drives it from `requestAnimationFrame`; a test drives it from
 * a loop of fixed steps. Both see exactly the same behaviour, and the test
 * runs in milliseconds.
 */

import {
  CATCH_CANVAS_HEIGHT,
  CATCH_CANVAS_WIDTH,
  classifyCatch,
  type CatchBubble,
} from './catch-char-rules';

/** How fast a bubble falls, in canvas px per second. */
export const FALL_SPEED = 78;

/** How fast the basket travels towards its target, in canvas px per second. */
export const BASKET_SPEED = 520;

/** The basket's half-width, in canvas px. */
export const BASKET_HALF_WIDTH = 52;

/** The basket's half-height, in canvas px. */
export const BASKET_HALF_HEIGHT = 26;

/** Where the basket sits, in canvas px from the top. */
export const BASKET_Y = CATCH_CANVAS_HEIGHT - 48;

/** The whole mutable state of a running round. */
export interface CatchSim {
  /** The bubbles that are falling. */
  bubbles: CatchBubble[];
  /** The basket's centre x, in canvas px. */
  basketX: number;
  /** Where the basket is heading, in canvas px. */
  basketTargetX: number;
}

/** What one step of the simulation did. */
export interface CatchStep {
  /** The bubble that was caught, if one was. */
  caught: CatchBubble | null;
  /** Whether the catch was the target (true) or a distractor (false). */
  ok: boolean;
  /** Whether the target fell past the basket without being caught. */
  dropped: boolean;
}

/** Builds the initial state of a wave. */
export function initSim(bubbles: readonly CatchBubble[]): CatchSim {
  return {
    bubbles: [...bubbles],
    basketX: CATCH_CANVAS_WIDTH / 2,
    basketTargetX: CATCH_CANVAS_WIDTH / 2,
  };
}

/**
 * Advances the simulation by `dt` seconds.
 *
 * The state is MUTATED in place — the animation loop runs this sixty
 * times a second and a copy would be pure waste — so the caller owns the
 * object and reads the results out of the return value.
 */
export function stepSim(sim: CatchSim, dt: number): CatchStep {
  // The basket eases towards its target, so it has weight and cannot be
  // teleported across the screen.
  const dx = sim.basketTargetX - sim.basketX;
  const stepDistance = BASKET_SPEED * dt;
  if (Math.abs(dx) <= stepDistance) {
    sim.basketX = sim.basketTargetX;
  } else {
    sim.basketX += Math.sign(dx) * stepDistance;
  }
  sim.basketX = Math.max(
    BASKET_HALF_WIDTH,
    Math.min(CATCH_CANVAS_WIDTH - BASKET_HALF_WIDTH, sim.basketX),
  );

  // The bubbles fall.
  // A bubble that has been judged is REMOVED from the array, so it can
  // never be judged twice — there is no second book-keeping to keep in
  // step with the array.
  for (const bubble of sim.bubbles) {
    bubble.y += FALL_SPEED * dt;

    const verdict = classifyCatch(
      bubble,
      sim.basketX,
      BASKET_Y,
      BASKET_HALF_WIDTH,
      BASKET_HALF_HEIGHT,
    );
    if (verdict.kind === 'hit' || verdict.kind === 'wrong') {
      removeBubble(sim, bubble.char);
      return { caught: bubble, ok: verdict.kind === 'hit', dropped: false };
    }

    if (bubble.y - bubble.radius > CATCH_CANVAS_HEIGHT) {
      // The bubble fell past the basket. A DISTRACTOR falling is nothing
      // to report — but the TARGET falling is a miss, and the round has to
      // move on.
      removeBubble(sim, bubble.char);
      if (bubble.isTarget) {
        return { caught: bubble, ok: false, dropped: true };
      }
    }
  }

  return { caught: null, ok: false, dropped: false };
}

/** Takes a bubble out of the falling set. */
function removeBubble(sim: CatchSim, char: string): void {
  const index = sim.bubbles.findIndex((b) => b.char === char);
  if (index >= 0) sim.bubbles.splice(index, 1);
}

/**
 * Moves the basket's target.
 *
 * The position is clamped to the canvas, so a pointer outside the canvas
 * cannot send the basket off the paper.
 */
export function aimBasket(sim: CatchSim, x: number): void {
  sim.basketTargetX = Math.max(
    BASKET_HALF_WIDTH,
    Math.min(CATCH_CANVAS_WIDTH - BASKET_HALF_WIDTH, x),
  );
}
