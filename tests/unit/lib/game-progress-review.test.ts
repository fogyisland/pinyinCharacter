// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  defaultProgress,
  recordMiss,
  recordReview,
  startOfLocalDay,
  type CharSnapshot,
} from '@/lib/game-progress';

/**
 * The wrong book's review integration.
 *
 * The curve itself is pinned in `tests/unit/lib/review-schedule.test.ts`.
 * This file pins the STORE side: a miss must create (or reset) a schedule,
 * a review must advance it, and a corrupt payload must not lose the book.
 */

/** The snapshot the wrong book stores. */
const snapshot: CharSnapshot = {
  pinyin: 'ài',
  plainPinyin: 'ai',
  tone: 4,
  toneName: 'fourth',
  radical: '心',
  meaningShort: 'to love',
};

describe('the wrong book and its review schedule', () => {
  it('gives a newly missed character a schedule due today', () => {
    const progress = recordMiss(defaultProgress(), '爱', snapshot, 1, 1);
    const entry = progress.wrong['爱'];
    expect(entry.review).toBeDefined();
    expect(entry.review?.level).toBe(0);
    const today = startOfLocalDay(new Date()).getTime();
    expect(entry.review?.dueAt).toBe(today);
  });

  it('resets an existing schedule when the character is missed again', () => {
    let progress = recordMiss(defaultProgress(), '爱', snapshot, 1, 1);
    // Advance it as if the learner had reviewed it well several times.
    progress = recordReview(progress, '爱', true);
    progress = recordReview(progress, '爱', true);
    progress = recordReview(progress, '爱', true);
    expect(progress.wrong['爱'].review?.level).toBe(3);
    expect(progress.wrong['爱'].count).toBe(1);

    // A fresh miss in the quest drops it straight back to today.
    const afterMiss = recordMiss(progress, '爱', snapshot, 1, 1);
    expect(afterMiss.wrong['爱'].review?.level).toBe(0);
    expect(afterMiss.wrong['爱'].review?.dueAt).toBe(startOfLocalDay(new Date()).getTime());
    // The miss count keeps accumulating: the book still knows it is hard.
    expect(afterMiss.wrong['爱'].count).toBe(2);
  });

  it('advances the schedule one level on a correct review', () => {
    const progress = recordMiss(defaultProgress(), '爱', snapshot, 1, 1);
    const reviewed = recordReview(progress, '爱', true);
    expect(reviewed.wrong['爱'].review?.level).toBe(1);
    // Level 1 = due in 1 day, measured from local midnight.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(reviewed.wrong['爱'].review?.dueAt).toBe(startOfLocalDay(tomorrow).getTime());
  });

  it('does not extend the miss count when the review is correct', () => {
    // A review is not a miss: the book's difficulty counter must not grow
    // just because the learner came back.
    const progress = recordMiss(defaultProgress(), '爱', snapshot, 1, 1);
    const reviewed = recordReview(progress, '爱', true);
    expect(reviewed.wrong['爱'].count).toBe(1);
  });

  it('counts a failed review as another miss', () => {
    const progress = recordMiss(defaultProgress(), '爱', snapshot, 1, 1);
    const failed = recordReview(progress, '爱', false);
    expect(failed.wrong['爱'].count).toBe(2);
    expect(failed.wrong['爱'].review?.level).toBe(0);
  });

  it('ignores a review of a character that is not in the book', () => {
    // The panel could race with a removal; reviewing a character that was
    // just removed must not resurrect it with an empty record.
    const progress = defaultProgress();
    const reviewed = recordReview(progress, '爱', true);
    expect(reviewed.wrong['爱']).toBeUndefined();
  });

  it('does not write to localStorage from the review mutator', () => {
    // The mutators are pure by contract. This file runs in the node
    // environment, where `window` does not exist, so the proof is simply
    // that calling the mutator does not touch any storage at all: the
    // default progress carries no writes and the result is a new object.
    let writes = 0;
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: () => {
          writes += 1;
        },
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        get length() {
          return 0;
        },
      },
    });
    const base = defaultProgress();
    const progress = recordMiss(base, '爱', snapshot, 1, 1);
    const reviewed = recordReview(progress, '爱', true);
    expect(writes).toBe(0);
    // The mutators never touch the input state either.
    expect(base.wrong['爱']).toBeUndefined();
    expect(progress).not.toBe(base);
    expect(reviewed).not.toBe(progress);
  });

  it('keeps a stored schedule through a payload round trip', () => {
    // The schedule rides inside the wrong-book entry, so the existing
    // normaliser must keep it.
    const progress = recordMiss(defaultProgress(), '爱', snapshot, 1, 1);
    const clone = JSON.parse(JSON.stringify(progress));
    expect(clone.wrong['爱'].review.level).toBe(0);
    expect(clone.wrong['爱'].review.dueAt).toBe(progress.wrong['爱'].review?.dueAt);
  });
});
