/**
 * 2026-10-25 (Task 7): the shared result type of the three legacy games.
 *
 * The games used to expose no completion signal at all, so a caller (the
 * daily-challenge card) could not tell whether a round had been played to
 * the end. Each game now takes an optional `onComplete` prop and reports
 * the finished round through it.
 *
 * This module is TYPE-ONLY — it holds no runtime code, so the three games
 * import it with `import type`.
 */

/** The score of one finished round. */
export interface LegacyGameResult {
  /** matches / pairs / chain length */
  correct: number;
  /** mismatches */
  wrong: number;
  /** optional — the daily card shows the score, the duration is only a stat */
  durationMs?: number;
}

/** The prop every legacy game accepts. */
export interface LegacyGameProps {
  /**
   * Called once when a round ends. Abandoning a round does NOT complete it:
   * an abandoned round never calls this.
   */
  onComplete?: (result: LegacyGameResult) => void;
}
