// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  FIRST_REVIEW,
  MAX_REVIEW_LEVEL,
  REVIEW_INTERVALS_DAYS,
  dueChars,
  isDue,
  nextReview,
  startOfLocalDay,
} from '@/lib/review-schedule';

/**
 * The 生字本's review curve.
 *
 * The wrong book used to be a dead list: a learner saw the characters they
 * had missed, could print a worksheet, and never came back on a schedule.
 * A character you missed once and never revisit is not learned.
 *
 * The curve is the classroom's: missed today → review today, then 1, 2, 4,
 * 7 and 15 days as each review succeeds. Getting it right again pushes the
 * date out; getting it wrong drops it back to the start. Six levels, and
 * level 5 means "learned" — the card still exists in the book, it just
 * stops asking.
 */

describe('the review curve', () => {
  it('has six levels with growing gaps', () => {
    expect(REVIEW_INTERVALS_DAYS).toEqual([0, 1, 2, 4, 7, 15]);
    expect(FIRST_REVIEW).toBe(0);
    expect(MAX_REVIEW_LEVEL).toBe(5);
  });

  it('schedules the first review for today', () => {
    const now = new Date(2026, 10, 21, 15, 30);
    const schedule = nextReview(undefined, now);
    // A brand-new card is at level 0, whose gap is 0 days: due today.
    expect(schedule.level).toBe(FIRST_REVIEW);
    expect(isDue(schedule, now)).toBe(true);
  });

  it('pushes the date out one level after a successful review', () => {
    const now = new Date(2026, 10, 21, 9, 0);
    const first = nextReview(undefined, now);
    const afterSuccess = nextReview({ ...first, level: 1 }, now);
    // Level 1 means "review again in 2 days" (the gap of the NEXT level).
    expect(afterSuccess.level).toBe(2);
    expect(afterSuccess.dueAt).toBe(startOfLocalDay(new Date(2026, 10, 23)).getTime());
  });

  it('drops back to the start after a miss', () => {
    const now = new Date(2026, 10, 21, 9, 0);
    const far = { level: 5, dueAt: 0, lastReviewedAt: 0 };
    const afterMiss = nextReview(far, now, false);
    expect(afterMiss.level).toBe(FIRST_REVIEW);
    expect(isDue(afterMiss, now)).toBe(true);
  });

  it('stops asking once the last level is reached', () => {
    const now = new Date(2026, 10, 21, 9, 0);
    const learned = nextReview({ level: 5, dueAt: 0, lastReviewedAt: 0 }, now);
    expect(learned.level).toBe(MAX_REVIEW_LEVEL);
    // A learned card is not due: its date is 15 days out, not in the past.
    expect(isDue(learned, now)).toBe(false);
    expect(isDue(learned, new Date(2026, 11, 6, 9, 0))).toBe(true);
  });

  it('compares whole days, not times of day', () => {
    // A card due tomorrow at 00:00 must not be due at 23:59 tonight.
    const dueTomorrow = startOfLocalDay(new Date(2026, 10, 22)).getTime();
    expect(isDue({ level: 1, dueAt: dueTomorrow, lastReviewedAt: 0 }, new Date(2026, 10, 21, 23, 59))).toBe(false);
    expect(isDue({ level: 1, dueAt: dueTomorrow, lastReviewedAt: 0 }, new Date(2026, 10, 22, 0, 1))).toBe(true);
  });

  it('ignores nonsense in a stored schedule instead of throwing', () => {
    // The payload can be hand-edited; a NaN level must not break the panel.
    const corrupt = { level: Number.NaN, dueAt: Number.NaN, lastReviewedAt: Number.NaN };
    const now = new Date(2026, 10, 21, 9, 0);
    expect(() => isDue(corrupt, now)).not.toThrow();
    expect(isDue(corrupt, now)).toBe(true);
    expect(() => nextReview(corrupt, now)).not.toThrow();
  });
});

describe('dueChars', () => {
  const now = new Date(2026, 10, 21, 9, 0);

  it('lists the characters whose review date has arrived', () => {
    const wrong = {
      甲: { count: 1, lastAt: 0, review: { level: 1, dueAt: startOfLocalDay(now).getTime(), lastReviewedAt: 0 } },
      乙: { count: 1, lastAt: 0, review: { level: 1, dueAt: startOfLocalDay(new Date(2026, 10, 25)).getTime(), lastReviewedAt: 0 } },
    };
    expect(dueChars(wrong, now)).toEqual(['甲']);
  });

  it('treats a character with no schedule as due today', () => {
    // Every character already in the book before this feature existed has
    // no schedule; they must be reviewable, not invisible.
    const wrong = { 丙: { count: 2, lastAt: 0 } };
    expect(dueChars(wrong, now)).toEqual(['丙']);
  });

  it('puts the most-missed characters first', () => {
    const wrong = {
      丁: { count: 1, lastAt: 0 },
      戊: { count: 5, lastAt: 0 },
    };
    expect(dueChars(wrong, now)).toEqual(['戊', '丁']);
  });

  it('returns an empty list when nothing is due', () => {
    expect(dueChars({}, now)).toEqual([]);
    const learned = {
      己: { count: 1, lastAt: 0, review: { level: 5, dueAt: startOfLocalDay(new Date(2026, 11, 6)).getTime(), lastReviewedAt: 0 } },
    };
    expect(dueChars(learned, now)).toEqual([]);
  });
});
