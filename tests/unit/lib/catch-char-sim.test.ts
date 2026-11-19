// @vitest-environment happy-dom
/**
 * The simulation of 听音接字 — the movement, the collision and the round's
 * bookkeeping, with no canvas and no React.
 *
 * The simulation is driven by fixed steps of `dt`, so the whole thing runs
 * in milliseconds — the same behaviour the animation loop produces, but
 * without waiting for real time to pass.
 */
import { describe, it, expect } from 'vitest';

import {
  BASKET_HALF_WIDTH,
  BASKET_Y,
  FALL_SPEED,
  aimBasket,
  initSim,
  stepSim,
  type CatchSim,
  type CatchStep,
} from '@/lib/catch-char-sim';
import { CATCH_CANVAS_WIDTH, type CatchBubble } from '@/lib/catch-char-rules';

const bubble = (char: string, x: number, isTarget: boolean, y = 0): CatchBubble => ({
  char,
  isTarget,
  x,
  y,
  radius: 30,
  pinyin: 'mā',
  tone: 1,
});

/** Runs the simulation for `seconds` of game time, in 1/60s steps. */
function run(sim: CatchSim, seconds: number): CatchStep {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  let last: CatchStep = { caught: null, ok: false, dropped: false };
  for (let i = 0; i < steps; i++) {
    last = stepSim(sim, dt);
    if (last.caught || last.dropped) return last;
  }
  return last;
}

describe('the simulation', () => {
  it('catches a bubble that falls into the basket', () => {
    const sim = initSim([bubble('妈', 300, true, 0)]);
    const result = run(sim, 20);
    expect(result.caught?.char).toBe('妈');
    expect(result.ok).toBe(true);
  });

  it('reports a distractor caught as a wrong catch', () => {
    const sim = initSim([bubble('麻', 300, false, 0)]);
    const result = run(sim, 20);
    expect(result.caught?.char).toBe('麻');
    expect(result.ok).toBe(false);
    expect(result.dropped).toBe(false);
  });

  it('reports the target falling past the basket as a drop', () => {
    const sim = initSim([bubble('妈', 50, true, 0)]);
    const result = run(sim, 20);
    expect(result.dropped).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('does not report a distractor falling past the basket', () => {
    // A distractor that falls is nothing — the round continues, waiting
    // for the target.
    const sim = initSim([bubble('麻', 50, false, 0)]);
    const result = run(sim, 20);
    expect(result.dropped).toBe(false);
    expect(result.caught).toBeNull();
  });

  it('makes the bubbles fall at the fall speed', () => {
    const sim = initSim([bubble('妈', 50, true, 0)]);
    stepSim(sim, 1);
    expect(sim.bubbles[0]!.y).toBeCloseTo(FALL_SPEED, 5);
  });

  it('moves the basket towards its target', () => {
    const sim = initSim([]);
    aimBasket(sim, 200);
    stepSim(sim, 0.1);
    expect(sim.basketX).toBeLessThan(CATCH_CANVAS_WIDTH / 2);
    expect(sim.basketX).toBeGreaterThan(CATCH_CANVAS_WIDTH / 2 - 60);
  });

  it('keeps the basket on the canvas', () => {
    const sim = initSim([]);
    aimBasket(sim, -500);
    stepSim(sim, 1);
    expect(sim.basketX).toBeGreaterThanOrEqual(BASKET_HALF_WIDTH);

    aimBasket(sim, 5000);
    stepSim(sim, 1);
    expect(sim.basketX).toBeLessThanOrEqual(CATCH_CANVAS_WIDTH - BASKET_HALF_WIDTH);
  });

  it('pulls the basket back onto the canvas', () => {
    // The target is clamped, so the position alone cannot leave the
    // canvas — but the position is a public field of a mutable struct,
    // and a caller (or a future edit) could set it directly. The step
    // clamps it back, so the basket can never be drawn off the paper.
    const sim = initSim([]);
    sim.basketX = -400;
    sim.basketTargetX = -400;
    stepSim(sim, 1 / 60);
    expect(sim.basketX).toBeGreaterThanOrEqual(BASKET_HALF_WIDTH);

    const other = initSim([]);
    other.basketX = 4000;
    other.basketTargetX = 4000;
    stepSim(other, 1 / 60);
    expect(other.basketX).toBeLessThanOrEqual(CATCH_CANVAS_WIDTH - BASKET_HALF_WIDTH);
  });

  it('clamps the basket target to the canvas', () => {
    // The target is clamped as well as the position: the clamp on the
    // position alone would let the target sit outside the canvas, and the
    // basket would creep towards it and stick at the edge.
    const sim = initSim([]);
    aimBasket(sim, -500);
    expect(sim.basketTargetX).toBe(BASKET_HALF_WIDTH);

    aimBasket(sim, 5000);
    expect(sim.basketTargetX).toBe(CATCH_CANVAS_WIDTH - BASKET_HALF_WIDTH);
  });

  it('does not let a bubble be judged twice', () => {
    // A judged bubble is taken out of the falling set, so the second
    // step cannot report it again.
    const sim = initSim([bubble('妈', 300, true, 0)]);
    const first = run(sim, 20);
    expect(first.caught?.char).toBe('妈');
    expect(sim.bubbles.find((b) => b.char === '妈')).toBeUndefined();

    const second = stepSim(sim, 1 / 60);
    expect(second.caught).toBeNull();
    expect(second.dropped).toBe(false);
  });

  it('catches the target that is under the basket', () => {
    // The basket starts in the middle of the canvas, so a bubble in the
    // middle is caught and one at the edge is not.
    const sim = initSim([bubble('妈', CATCH_CANVAS_WIDTH / 2, true, 0)]);
    const result = run(sim, 20);
    expect(result.ok).toBe(true);
  });

  it('puts the basket at the bottom of the canvas', () => {
    // The basket has to be near the bottom — a bubble that reaches it
    // has nearly fallen off the screen, which is what makes the game a
    // race.
    expect(BASKET_Y).toBeGreaterThan(500);
  });
});
