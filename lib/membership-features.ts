/**
 * Client-safe membership feature metadata.
 *
 * Lives in its own file (separate from lib/membership.ts) so it has no
 * server-only imports (mysql2, lib/db) and can be imported from both server
 * and client components.
 *
 * ⚠️ EVERY KEY IN THIS LIST MUST BE ENFORCED SOMEWHERE.
 *
 * A feature that is listed here but never checked by `hasFeature()` is a
 * promise the buyer pays for and does not receive. Three keys used to be
 * in this list — `unlimited_history`, `download_pdf` and `priority_tts` —
 * and none of them was ever enforced: the history list is capped at 200
 * rows for everybody, the PDF download is open to anonymous visitors, and
 * the TTS pipeline has no priority branch. They were seeded onto every
 * plan and rendered to buyers as Chinese labels. On 2026-11-18 they were
 * removed rather than left as an unfulfilled promise.
 *
 * Before adding a key here, write the code that checks it.
 *
 * This list is the SINGLE SOURCE OF TRUTH for the key set. The admin plan
 * picker, the public plan card and the admin PATCH schema all derive from
 * it — they used to carry their own copies and drifted: the PATCH schema
 * was missing `multi_worksheet_print`, so ticking "批量 / 多页打印" in the
 * admin UI and saving failed with a validation error, and the one feature
 * that IS enforced could not be granted at all.
 */

export const MEMBERSHIP_FEATURES = ['ai_calls', 'multi_worksheet_print'] as const;

export type MembershipFeature = (typeof MEMBERSHIP_FEATURES)[number];

/** The Chinese label the admin picker shows for each feature. */
export const MEMBERSHIP_FEATURE_LABELS: Record<MembershipFeature, string> = {
  ai_calls: 'AI 调用',
  multi_worksheet_print: '批量 / 多页打印',
};

/** The Chinese label the public plan card shows for each feature. */
export const MEMBERSHIP_FEATURE_PUBLIC_LABELS: Record<MembershipFeature, string> = {
  ai_calls: 'AI 释义',
  multi_worksheet_print: '批量 / 多页打印',
};
