/**
 * Fisher-Yates shuffle utilities. Shared between server (buildRound) and
 * client (ToneRadicalGame) so both use the SAME correct swap.
 *
 * Regression note (2026-07-03): both prior copies inlined had
 * `[a[i], a[j]] = [a[j]!, a[j]!]` — duplicating a[j] into a[i] without
 * preserving a[i]. This dropped/duplicated elements, which leaked into
 * `/api/game/round` `pinyinChoices` and triggered React duplicate-key
 * warnings in `<PinyinToken key={p}>`.
 */

export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}