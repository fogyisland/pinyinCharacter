/**
 * The review curve of the 生字本 (the wrong book).
 *
 * ## Why this module exists
 *
 * The wrong book collected characters and never asked about them again. A
 * character you missed once and never revisit is not learned — the book was
 * a record, not a plan. This is the classroom's spaced-repetition curve,
 * kept deliberately simple:
 *
 *     level 0 → review today       (the miss itself)
 *     level 1 → in 1 day
 *     level 2 → in 2 days
 *     level 3 → in 4 days
 *     level 4 → in 7 days
 *     level 5 → in 15 days, then "learned" (stops asking)
 *
 * A success moves one level out; a miss drops straight back to level 1 —
 * not to level 0, because the card is due NOW either way and level 1 keeps
 * the sequence short when the learner gets it right next time.
 *
 * ## Why the intervals are what they are
 *
 * They are the gaps teachers actually use for a class's weekly rhythm
 * (tomorrow, this week, next week, in two weeks), not an optimised SRS
 * ladder. A learner sees at most six encounters per character, and every
 * one of them lands on a date they can plan around.
 *
 * ## What it is not
 *
 * Not a scheduler. There is no per-user tuning, no ease factor, no
 * interleaving. If the site ever needs real SRS, this module is the seam to
 * replace — the rest of the code only asks "which characters are due?" and
 * "what is the next schedule?".
 */

/** The day gaps of each level. Level 0 is "today". */
export const REVIEW_INTERVALS_DAYS = [0, 1, 2, 4, 7, 15] as const;

/** The level a missed character enters. */
export const FIRST_REVIEW = 0;

/** The last level; reaching it means the character is learned. */
export const MAX_REVIEW_LEVEL = 5;

/** One character's review state, as stored in the progress payload. */
export interface ReviewSchedule {
  /** 0..MAX_REVIEW_LEVEL. A larger or non-finite value is clamped. */
  level: number;
  /** Local midnight of the day it becomes due, in epoch ms. */
  dueAt: number;
  /** Local midnight of the last review, in epoch ms. 0 = never reviewed. */
  lastReviewedAt: number;
}

/**
 * Local midnight of the day `date` falls on.
 *
 * The curve is measured in DAYS, so every timestamp is floored to local
 * midnight — otherwise a card reviewed at 23:50 would be "due" ten minutes
 * later, and a learner would see the same character twice in one evening.
 *
 * @param date any moment.
 * @returns that day's local midnight.
 */
export function startOfLocalDay(date: Date): Date {
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return midnight;
}

/** Clamp a stored level into the curve's range. */
function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return FIRST_REVIEW;
  if (level < FIRST_REVIEW) return FIRST_REVIEW;
  if (level > MAX_REVIEW_LEVEL) return MAX_REVIEW_LEVEL;
  return Math.floor(level);
}

/**
 * The schedule for a character after a review.
 *
 * A success moves the character one level out; a miss drops it back to
 * level 1. Either way the new due date is `intervals[level]` days from
 * today's local midnight, so the comparison is a whole-day comparison.
 *
 * A character at the last level stays there: the card exists (the learner
 * can still see it in the book and print it), it just stops asking.
 *
 * @param previous the stored schedule, or undefined for a new card.
 * @param now when the review happened.
 * @param isRight false when the learner missed it.
 * @returns the new schedule.
 */
export function nextReview(
  previous: ReviewSchedule | undefined,
  now: Date,
  isRight = true,
): ReviewSchedule {
  // A brand-new card is the miss that put it in the book: level 0, due today.
  // The `isRight` flag only matters for a card that is already scheduled —
  // "I just failed it" and "it just entered the book" are the same state.
  const level =
    previous === undefined ? FIRST_REVIEW : isRight ? clampLevel(previous.level + 1) : FIRST_REVIEW;
  const interval = REVIEW_INTERVALS_DAYS[level] ?? REVIEW_INTERVALS_DAYS[0];
  const today = startOfLocalDay(now);
  const due = new Date(today.getFullYear(), today.getMonth(), today.getDate() + interval);
  return {
    level,
    dueAt: due.getTime(),
    lastReviewedAt: today.getTime(),
  };
}

/**
 * Is the character due for a review on `now`'s day?
 *
 * A corrupt schedule (NaN fields, a missing level) counts as due: the card
 * must be reviewable rather than invisible, and asking for a review of a
 * card with a nonsense date is harmless.
 *
 * @param schedule the stored schedule.
 * @param now the moment to test.
 */
export function isDue(schedule: ReviewSchedule | undefined, now: Date): boolean {
  if (!schedule) return true;
  const dueAt = schedule.dueAt;
  if (typeof dueAt !== 'number' || !Number.isFinite(dueAt)) return true;
  return startOfLocalDay(now).getTime() >= startOfLocalDay(new Date(dueAt)).getTime();
}

/** The minimum shape `dueChars` needs from a wrong-book entry. */
export interface WrongEntryLike {
  count?: number;
  lastAt?: number;
  review?: ReviewSchedule;
}

/**
 * The characters due for review, hardest first.
 *
 * "Hardest" is the miss count, then the oldest miss: a character missed
 * five times matters more than one missed once, and among equals the one
 * that has waited longest goes first. Characters with no schedule at all
 * (everything collected before this feature existed) are due immediately —
 * that is what makes the backlog reviewable instead of invisible.
 *
 * @param wrong the wrong book.
 * @param now the moment to test.
 * @returns the characters, most urgent first.
 */
export function dueChars(wrong: Record<string, WrongEntryLike>, now: Date): string[] {
  const due: Array<{ char: string; count: number; lastAt: number }> = [];
  for (const [char, entry] of Object.entries(wrong)) {
    if (!isDue(entry.review, now)) continue;
    due.push({
      char,
      count: Number.isFinite(entry.count) ? (entry.count ?? 0) : 0,
      lastAt: Number.isFinite(entry.lastAt) ? (entry.lastAt ?? 0) : 0,
    });
  }
  due.sort((a, b) => b.count - a.count || a.lastAt - b.lastAt);
  return due.map((entry) => entry.char);
}

/**
 * How many days until the next review, for a label like 「3 天后复习」.
 *
 * @param schedule the stored schedule.
 * @param now the moment to test.
 * @returns 0 when it is due today or overdue.
 */
export function daysUntilDue(schedule: ReviewSchedule | undefined, now: Date): number {
  if (!schedule) return 0;
  const dueAt = schedule.dueAt;
  if (typeof dueAt !== 'number' || !Number.isFinite(dueAt)) return 0;
  const diff = startOfLocalDay(new Date(dueAt)).getTime() - startOfLocalDay(now).getTime();
  return Math.max(0, Math.round(diff / 86_400_000));
}
